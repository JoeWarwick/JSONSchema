using Microsoft.Data.Sqlite;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class SqliteSchemaGenerator
{
    public async Task<byte[]> GenerateAsync(GenerateSqliteSchemaRequest request, CancellationToken cancellationToken)
    {
        ValidateRequest(request);

        var databasePath = Path.Combine(Path.GetTempPath(), $"schema-sculptor-{Guid.NewGuid():N}.sqlite");
        try
        {
            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = databasePath,
                Mode = SqliteOpenMode.ReadWriteCreate,
                Pooling = false,
            }.ToString();

            await using (var connection = new SqliteConnection(connectionString))
            {
                await connection.OpenAsync(cancellationToken);
                await using (var pragma = connection.CreateCommand())
                {
                    pragma.CommandText = "PRAGMA foreign_keys = ON;";
                    await pragma.ExecuteNonQueryAsync(cancellationToken);
                }

                var tablesById = request.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal);
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                foreach (var table in request.Tables)
                {
                    await ExecuteAsync(connection, transaction, CreateTableSql(table, request.Relationships, tablesById), cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);
            }

            return await File.ReadAllBytesAsync(databasePath, cancellationToken);
        }
        finally
        {
            if (File.Exists(databasePath))
                File.Delete(databasePath);
        }
    }

    private static async Task ExecuteAsync(
        SqliteConnection connection,
        System.Data.Common.DbTransaction transaction,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    internal static void ValidateRequest(GenerateSqliteSchemaRequest request)
    {
        if (request.Tables is null || request.Tables.Count == 0)
            throw new InvalidOperationException("The ERD must contain at least one table.");
        if (request.Relationships is null)
            throw new InvalidOperationException("The ERD relationships are invalid.");

        var tablesById = new Dictionary<string, SqliteSchemaTable>(StringComparer.Ordinal);
        var tableNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var table in request.Tables)
        {
            if (table is null)
                throw new InvalidOperationException("The ERD contains an invalid table.");
            if (string.IsNullOrWhiteSpace(table.Id) || string.IsNullOrWhiteSpace(table.Name))
                throw new InvalidOperationException("Every table must have an ID and a name.");
            if (table.Name.StartsWith("__schema_sculptor_", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Table name \"{table.Name}\" is reserved.");
            if (!tablesById.TryAdd(table.Id, table))
                throw new InvalidOperationException($"Duplicate table ID \"{table.Id}\".");
            if (!tableNames.Add(table.Name))
                throw new InvalidOperationException($"Duplicate table name \"{table.Name}\".");
            if (table.Columns is null || table.Columns.Count == 0)
                throw new InvalidOperationException($"Table \"{table.Name}\" must contain at least one column.");

            var columnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var column in table.Columns)
            {
                if (column is null)
                    throw new InvalidOperationException($"Table \"{table.Name}\" contains an invalid column.");
                if (string.IsNullOrWhiteSpace(column.Name))
                    throw new InvalidOperationException($"Table \"{table.Name}\" contains a column without a name.");
                if (!columnNames.Add(column.Name))
                    throw new InvalidOperationException($"Table \"{table.Name}\" contains duplicate column name \"{column.Name}\".");
            }
        }

        foreach (var relationship in request.Relationships)
        {
            if (relationship is null ||
                string.IsNullOrWhiteSpace(relationship.DependentTable) ||
                string.IsNullOrWhiteSpace(relationship.PrincipalTable) ||
                !tablesById.ContainsKey(relationship.DependentTable) ||
                !tablesById.TryGetValue(relationship.PrincipalTable, out var principalTable))
                throw new InvalidOperationException("The ERD contains a relationship with an unknown table.");

            var dependentTable = tablesById[relationship.DependentTable];
            var foreignKeyColumns = relationship.ForeignKeyColumns;
            if (foreignKeyColumns is null || foreignKeyColumns.Count == 0)
                throw new InvalidOperationException($"Relationship from \"{dependentTable.Name}\" must specify at least one foreign key column.");

            var primaryKeys = principalTable.Columns.Where(column => column.IsPrimaryKey).ToList();
            if (primaryKeys.Count != foreignKeyColumns.Count)
                throw new InvalidOperationException($"Relationship from \"{dependentTable.Name}\" to \"{principalTable.Name}\" must match the principal primary key columns.");

            if (foreignKeyColumns.Distinct(StringComparer.OrdinalIgnoreCase).Count() != foreignKeyColumns.Count ||
                foreignKeyColumns.Any(name => !dependentTable.Columns.Any(column => string.Equals(column.Name, name, StringComparison.OrdinalIgnoreCase))))
                throw new InvalidOperationException($"Relationship from \"{dependentTable.Name}\" references invalid foreign key columns.");
        }
    }

    internal static string CreateTableSql(
        SqliteSchemaTable table,
        IReadOnlyList<SqliteSchemaRelationship> relationships,
        IReadOnlyDictionary<string, SqliteSchemaTable> tablesById)
    {
        var primaryKeys = table.Columns.Where(column => column.IsPrimaryKey).ToList();
        var autoIncrementColumn = primaryKeys.Count == 1 && IsIntegerType(primaryKeys[0].Type)
            ? primaryKeys[0]
            : null;
        var definitions = new List<string>();

        foreach (var column in table.Columns)
        {
            var definition = $"{QuoteIdentifier(column.Name)} {SqliteType(column.Type)}";
            if (ReferenceEquals(column, autoIncrementColumn))
                definition += " PRIMARY KEY AUTOINCREMENT";
            else if (!column.IsNullable || column.IsPrimaryKey)
                definition += " NOT NULL";
            if (column.DefaultGeneration == "current-timestamp")
                definition += " DEFAULT CURRENT_TIMESTAMP";
            definitions.Add(definition);
        }

        if (primaryKeys.Count > 0 && autoIncrementColumn is null)
            definitions.Add($"PRIMARY KEY ({string.Join(", ", primaryKeys.Select(column => QuoteIdentifier(column.Name)))})");

        foreach (var relationship in relationships)
        {
            if (!string.Equals(relationship.DependentTable, table.Id, StringComparison.Ordinal))
                continue;
            if (!tablesById.TryGetValue(relationship.PrincipalTable, out var principalTable))
                throw new InvalidOperationException($"Relationship in table \"{table.Name}\" references an unknown principal table.");

            var foreignKeyColumns = relationship.ForeignKeyColumns;
            if (foreignKeyColumns is null || foreignKeyColumns.Count == 0)
                throw new InvalidOperationException($"Relationship from \"{table.Name}\" must specify at least one foreign key column.");

            var principalKeys = principalTable.Columns.Where(column => column.IsPrimaryKey).ToList();
            if (principalKeys.Count != foreignKeyColumns.Count)
                throw new InvalidOperationException($"Relationship from \"{table.Name}\" to \"{principalTable.Name}\" must match the principal primary key columns.");

            if (foreignKeyColumns.Any(name => !table.Columns.Any(column => string.Equals(column.Name, name, StringComparison.OrdinalIgnoreCase))))
                throw new InvalidOperationException($"Relationship from \"{table.Name}\" references a missing foreign key column.");

            definitions.Add(
                $"FOREIGN KEY ({string.Join(", ", foreignKeyColumns.Select(QuoteIdentifier))}) " +
                $"REFERENCES {QuoteIdentifier(principalTable.Name)} ({string.Join(", ", principalKeys.Select(column => QuoteIdentifier(column.Name)))}) " +
                "ON DELETE CASCADE");
        }

        return $"CREATE TABLE {QuoteIdentifier(table.Name)} ({string.Join(", ", definitions)});";
    }

    internal static string SqliteType(string type)
    {
        var normalized = (type ?? "string").Trim().TrimEnd('?');
        return normalized.ToLowerInvariant() switch
        {
            "int" or "long" or "short" => "INTEGER",
            "decimal" => "NUMERIC",
            "double" or "float" => "REAL",
            "bool" => "INTEGER",
            "byte[]" => "BLOB",
            _ => "TEXT",
        };
    }

    internal static bool IsIntegerType(string type) =>
        (type ?? "").Trim().TrimEnd('?').ToLowerInvariant() is "int" or "long" or "short";

    internal static string QuoteIdentifier(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"")}\"";
}
