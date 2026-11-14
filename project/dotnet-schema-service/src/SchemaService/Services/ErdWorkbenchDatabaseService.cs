using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class SqliteSchemaCompatibilityException(string message) : InvalidOperationException(message)
{
}

public sealed class ErdWorkbenchDatabaseService(string databaseDirectory)
{
    private const int MaximumIdentifierLength = 256;

    public async Task<ErdWorkbenchSnapshot> SyncAsync(
        GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken)
    {
        SqliteSchemaGenerator.ValidateRequest(request);
        var path = GetDatabasePath(request.WorkbenchId);
        Directory.CreateDirectory(databaseDirectory);
        var previousSchema = await ReadStoredSchemaAsync(request.WorkbenchId, cancellationToken);

        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        if (previousSchema is not null)
            await ValidateCompatibleSchemaAsync(connection, transaction, previousSchema, request, cancellationToken);

        var tablesById = request.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal);
        var previousTablesById = previousSchema?.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal)
            ?? new Dictionary<string, SqliteSchemaTable>(StringComparer.Ordinal);

        foreach (var table in request.Tables)
        {
            if (await TableExistsAsync(connection, transaction, table.Name, cancellationToken))
            {
                await AddNullableColumnsAsync(connection, transaction, table, request.Relationships, cancellationToken);
                continue;
            }

            if (previousTablesById.TryGetValue(table.Id, out var previousTable) &&
                await TableExistsAsync(connection, transaction, previousTable.Name, cancellationToken))
                throw new SqliteSchemaCompatibilityException(
                    $"Renaming table \"{previousTable.Name}\" to \"{table.Name}\" is not supported; existing data was preserved.");

            await ExecuteAsync(
                connection,
                transaction,
                SqliteSchemaGenerator.CreateTableSql(table, request.Relationships, tablesById),
                cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        await WriteStoredSchemaAsync(request.WorkbenchId, request, cancellationToken);
        return await ReadSnapshotAsync(connection, request, cancellationToken);
    }

    public async Task<ErdWorkbenchSnapshot> GetSnapshotAsync(string workbenchId, CancellationToken cancellationToken)
    {
        var path = GetDatabasePath(workbenchId);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before loading entity records.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        return await ReadSnapshotAsync(connection, schema, cancellationToken);
    }

    public async Task<ErdWorkbenchRecord> SaveRecordAsync(
        string workbenchId,
        SaveErdWorkbenchRecordRequest request,
        CancellationToken cancellationToken)
    {
        var path = GetDatabasePath(workbenchId);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before saving entity records.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var table = schema.Tables.SingleOrDefault(candidate => candidate.Id == request.TableId)
            ?? throw new InvalidOperationException("The selected entity does not exist in this ERD database.");
        if (request.Values is null)
            throw new InvalidOperationException("Entity values are required.");

        var values = new List<(SqliteSchemaColumn Column, object Value)>();
        foreach (var (name, value) in request.Values)
        {
            var column = table.Columns.SingleOrDefault(candidate => string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Column \"{name}\" does not exist in entity \"{table.Name}\".");
            if (request.RowId is not null && column.IsPrimaryKey)
                continue;
            values.Add((column, ToDatabaseValue(value, column)));
        }

        long rowId;
        if (request.RowId is null)
        {
            var columnNames = string.Join(", ", values.Select(value => SqliteSchemaGenerator.QuoteIdentifier(value.Column.Name)));
            var parameterNames = string.Join(", ", values.Select((_, index) => $"$value{index}"));
            await using var insert = connection.CreateCommand();
            insert.Transaction = (SqliteTransaction)transaction;
            insert.CommandText = values.Count == 0
                ? $"INSERT INTO {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} DEFAULT VALUES;"
                : $"INSERT INTO {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} ({columnNames}) VALUES ({parameterNames});";
            AddValueParameters(insert, values);
            await insert.ExecuteNonQueryAsync(cancellationToken);

            await using var lastId = connection.CreateCommand();
            lastId.Transaction = (SqliteTransaction)transaction;
            lastId.CommandText = "SELECT last_insert_rowid();";
            rowId = (long)(await lastId.ExecuteScalarAsync(cancellationToken))!;
        }
        else
        {
            var rowIdColumn = GetRowIdColumn(table);
            if (values.Count > 0)
            {
                var assignments = string.Join(", ", values.Select((value, index) =>
                    $"{SqliteSchemaGenerator.QuoteIdentifier(value.Column.Name)} = $value{index}"));
                await using var update = connection.CreateCommand();
                update.Transaction = (SqliteTransaction)transaction;
                update.CommandText = $"UPDATE {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} SET {assignments} WHERE {rowIdColumn} = $rowId;";
                update.Parameters.AddWithValue("$rowId", request.RowId.Value);
                AddValueParameters(update, values);
                if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                    throw new InvalidOperationException("The selected entity record no longer exists.");
            }
            rowId = request.RowId.Value;
        }

        var savedRecord = await ReadRecordAsync(connection, transaction, table, rowId, cancellationToken)
            ?? throw new InvalidOperationException("The entity record could not be read after saving.");
        await transaction.CommitAsync(cancellationToken);
        return savedRecord;
    }

    public async Task<byte[]> ExportAsync(string workbenchId, CancellationToken cancellationToken)
    {
        var path = GetDatabasePath(workbenchId);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before downloading it.");
        return await File.ReadAllBytesAsync(path, cancellationToken);
    }

    private string GetDatabasePath(string workbenchId)
    {
        if (string.IsNullOrWhiteSpace(workbenchId) || workbenchId.Length > MaximumIdentifierLength)
            throw new InvalidOperationException("A valid ERD workbench ID is required.");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(workbenchId))).ToLowerInvariant();
        return Path.Combine(databaseDirectory, $"{hash}.sqlite");
    }

    private static async Task<SqliteConnection> OpenConnectionAsync(string path, CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = 10,
        }.ToString());
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static async Task ValidateCompatibleSchemaAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        GenerateSqliteSchemaRequest previous,
        GenerateSqliteSchemaRequest current,
        CancellationToken cancellationToken)
    {
        var currentIds = current.Tables.Select(table => table.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var oldTable in previous.Tables.Where(table => !currentIds.Contains(table.Id)))
            throw new SqliteSchemaCompatibilityException(
                $"Entity \"{oldTable.Name}\" was removed from the ERD. Its database table and data were preserved; restore the entity before editing records.");

        var previousById = previous.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal);
        foreach (var table in current.Tables)
        {
            var oldNameOwner = previous.Tables.FirstOrDefault(old =>
                old.Id != table.Id && string.Equals(old.Name, table.Name, StringComparison.OrdinalIgnoreCase));
            if (oldNameOwner is not null)
                throw new SqliteSchemaCompatibilityException(
                    $"Table name \"{table.Name}\" was previously used by another entity; existing data was preserved.");

            if (!previousById.TryGetValue(table.Id, out var oldTable))
                continue;
            if (!string.Equals(oldTable.Name, table.Name, StringComparison.Ordinal))
                throw new SqliteSchemaCompatibilityException(
                    $"Renaming entity \"{oldTable.Name}\" is not supported; existing data was preserved.");

            var currentColumnNames = table.Columns.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var oldColumn in oldTable.Columns.Where(column => !currentColumnNames.Contains(column.Name)))
                throw new SqliteSchemaCompatibilityException(
                    $"Column \"{oldColumn.Name}\" was removed from \"{table.Name}\". Its database data was preserved; restore the column before editing records.");
        }

        foreach (var table in current.Tables)
        {
            if (!await TableExistsAsync(connection, transaction, table.Name, cancellationToken))
            {
                var oldNameOwner = previous.Tables.FirstOrDefault(old =>
                    string.Equals(old.Name, table.Name, StringComparison.OrdinalIgnoreCase) && old.Id != table.Id);
                if (oldNameOwner is not null)
                    throw new SqliteSchemaCompatibilityException(
                        $"Table name \"{table.Name}\" was previously used by another entity; existing data was preserved.");
                continue;
            }

            var actualColumns = await ReadColumnsAsync(connection, transaction, table.Name, cancellationToken);
            var desiredPrimaryKeys = table.Columns.Where(column => column.IsPrimaryKey).Select(column => column.Name).ToList();
            var actualPrimaryKeys = actualColumns.Values.Where(column => column.PrimaryKeyOrder > 0)
                .OrderBy(column => column.PrimaryKeyOrder).Select(column => column.Name).ToList();
            if (!desiredPrimaryKeys.SequenceEqual(actualPrimaryKeys, StringComparer.OrdinalIgnoreCase))
                throw new SqliteSchemaCompatibilityException(
                    $"Primary key changes for \"{table.Name}\" are not supported; existing data was preserved.");

            foreach (var column in table.Columns)
            {
                if (!actualColumns.TryGetValue(column.Name, out var actual))
                    continue;
                var expectedType = SqliteSchemaGenerator.SqliteType(column.Type);
                var expectedNotNull = !column.IsNullable || column.IsPrimaryKey;
                var expectedDefault = column.DefaultGeneration == "current-timestamp" ? "CURRENT_TIMESTAMP" : null;
                if (!string.Equals(actual.Type, expectedType, StringComparison.OrdinalIgnoreCase) ||
                    (actual.PrimaryKeyOrder == 0 && actual.NotNull != expectedNotNull) ||
                    !string.Equals(NormalizeDefault(actual.DefaultValue), expectedDefault, StringComparison.OrdinalIgnoreCase))
                    throw new SqliteSchemaCompatibilityException(
                        $"Changing column \"{column.Name}\" in \"{table.Name}\" is not supported; existing data was preserved.");
            }

            await ValidateForeignKeysAsync(connection, transaction, table, current, cancellationToken);
        }
    }

    private static async Task AddNullableColumnsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        IReadOnlyList<SqliteSchemaRelationship> relationships,
        CancellationToken cancellationToken)
    {
        var existingColumns = await ReadColumnsAsync(connection, transaction, table.Name, cancellationToken);
        foreach (var column in table.Columns.Where(column => !existingColumns.ContainsKey(column.Name)))
        {
            var isForeignKey = relationships.Any(relationship =>
                relationship.DependentTable == table.Id &&
                relationship.ForeignKeyColumns.Contains(column.Name, StringComparer.OrdinalIgnoreCase));
            if (!column.IsNullable || column.IsPrimaryKey || isForeignKey || column.DefaultGeneration is not null)
                throw new SqliteSchemaCompatibilityException(
                    $"Adding required, primary key, foreign key, or defaulted column \"{column.Name}\" to existing entity \"{table.Name}\" is not supported; existing data was preserved.");

            await ExecuteAsync(connection, transaction,
                $"ALTER TABLE {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} ADD COLUMN " +
                $"{SqliteSchemaGenerator.QuoteIdentifier(column.Name)} {SqliteSchemaGenerator.SqliteType(column.Type)} NULL;",
                cancellationToken);
        }
    }

    private static async Task ValidateForeignKeysAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        GenerateSqliteSchemaRequest schema,
        CancellationToken cancellationToken)
    {
        var expected = schema.Relationships
            .Where(relationship => relationship.DependentTable == table.Id)
            .Select(relationship =>
            {
                var principal = schema.Tables.Single(item => item.Id == relationship.PrincipalTable);
                var principalKeys = principal.Columns.Where(column => column.IsPrimaryKey).Select(column => column.Name);
                return $"{principal.Name}|{string.Join(",", relationship.ForeignKeyColumns.Zip(principalKeys, (from, to) => $"{from}>{to}"))}|CASCADE";
            })
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var actualGroups = new Dictionary<long, List<(long Sequence, string Table, string From, string To, string OnDelete)>>();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"PRAGMA foreign_key_list({SqliteSchemaGenerator.QuoteIdentifier(table.Name)});";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetInt64(reader.GetOrdinal("id"));
            if (!actualGroups.TryGetValue(id, out var group))
                actualGroups[id] = group = [];
            group.Add((
                reader.GetInt64(reader.GetOrdinal("seq")),
                reader.GetString(reader.GetOrdinal("table")),
                reader.GetString(reader.GetOrdinal("from")),
                reader.GetString(reader.GetOrdinal("to")),
                reader.GetString(reader.GetOrdinal("on_delete"))));
        }

        var actual = actualGroups.Values
            .Select(group => group.OrderBy(part => part.Sequence).ToList())
            .Select(group => $"{group[0].Table}|{string.Join(",", group.Select(part => $"{part.From}>{part.To}"))}|{group[0].OnDelete}")
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (!expected.SequenceEqual(actual, StringComparer.OrdinalIgnoreCase))
            throw new SqliteSchemaCompatibilityException(
                $"Relationship changes for \"{table.Name}\" are not supported; existing data was preserved.");
    }

    private static async Task<ErdWorkbenchSnapshot> ReadSnapshotAsync(
        SqliteConnection connection,
        GenerateSqliteSchemaRequest schema,
        CancellationToken cancellationToken)
    {
        var snapshot = new ErdWorkbenchSnapshot { Relationships = schema.Relationships };
        foreach (var table in schema.Tables)
        {
            var tableSnapshot = new ErdWorkbenchTableSnapshot
            {
                Id = table.Id,
                Name = table.Name,
                Columns = table.Columns,
                Records = await ReadRecordsAsync(connection, null, table, cancellationToken),
            };
            snapshot.Tables.Add(tableSnapshot);
        }
        return snapshot;
    }

    private static async Task<List<ErdWorkbenchRecord>> ReadRecordsAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        SqliteSchemaTable table,
        CancellationToken cancellationToken)
    {
        var rowIdColumn = GetRowIdColumn(table);
        var columns = string.Join(", ", table.Columns.Select(column => SqliteSchemaGenerator.QuoteIdentifier(column.Name)));
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"SELECT {rowIdColumn}, {columns} FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} ORDER BY {rowIdColumn};";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var records = new List<ErdWorkbenchRecord>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var record = new ErdWorkbenchRecord { RowId = reader.GetInt64(0) };
            for (var index = 0; index < table.Columns.Count; index++)
                record.Values[table.Columns[index].Name] = reader.IsDBNull(index + 1) ? null : reader.GetValue(index + 1);
            records.Add(record);
        }
        return records;
    }

    private static async Task<ErdWorkbenchRecord?> ReadRecordAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        long rowId,
        CancellationToken cancellationToken)
    {
        var rowIdColumn = GetRowIdColumn(table);
        var columns = string.Join(", ", table.Columns.Select(column => SqliteSchemaGenerator.QuoteIdentifier(column.Name)));
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"SELECT {columns} FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} WHERE {rowIdColumn} = $rowId;";
        command.Parameters.AddWithValue("$rowId", rowId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        var record = new ErdWorkbenchRecord { RowId = rowId };
        for (var index = 0; index < table.Columns.Count; index++)
            record.Values[table.Columns[index].Name] = reader.IsDBNull(index) ? null : reader.GetValue(index);
        return record;
    }

    private static string GetRowIdColumn(SqliteSchemaTable table)
    {
        var names = table.Columns.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return new[] { "rowid", "_rowid_", "oid" }.FirstOrDefault(name => !names.Contains(name))
            ?? throw new InvalidOperationException($"Entity \"{table.Name}\" uses all SQLite row ID aliases and cannot be edited.");
    }

    private static async Task<Dictionary<string, SqliteColumnInfo>> ReadColumnsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string tableName,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"PRAGMA table_info({SqliteSchemaGenerator.QuoteIdentifier(tableName)});";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var columns = new Dictionary<string, SqliteColumnInfo>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync(cancellationToken))
        {
            var defaultValueOrdinal = reader.GetOrdinal("dflt_value");
            columns.Add(reader.GetString(reader.GetOrdinal("name")), new SqliteColumnInfo(
                reader.GetString(reader.GetOrdinal("name")),
                reader.GetString(reader.GetOrdinal("type")),
                reader.GetInt64(reader.GetOrdinal("notnull")) != 0,
                reader.IsDBNull(defaultValueOrdinal) ? null : reader.GetString(defaultValueOrdinal),
                reader.GetInt64(reader.GetOrdinal("pk"))));
        }
        return columns;
    }

    private static async Task<bool> TableExistsAsync(
        SqliteConnection connection,
        SqliteTransaction? transaction,
        string tableName,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name);";
        command.Parameters.AddWithValue("$name", tableName);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) != 0;
    }

    private async Task<GenerateSqliteSchemaRequest?> ReadStoredSchemaAsync(
        string workbenchId,
        CancellationToken cancellationToken)
    {
        var path = GetMetadataPath(workbenchId);
        if (!File.Exists(path))
            return null;
        try
        {
            return JsonSerializer.Deserialize<GenerateSqliteSchemaRequest>(
                await File.ReadAllTextAsync(path, cancellationToken));
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException("The ERD SQLite schema metadata is invalid.", ex);
        }
    }

    private async Task WriteStoredSchemaAsync(
        string workbenchId,
        GenerateSqliteSchemaRequest schema,
        CancellationToken cancellationToken)
    {
        var path = GetMetadataPath(workbenchId);
        var temporaryPath = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await File.WriteAllTextAsync(temporaryPath, JsonSerializer.Serialize(schema), cancellationToken);
            File.Move(temporaryPath, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
                File.Delete(temporaryPath);
        }
    }

    private string GetMetadataPath(string workbenchId) =>
        Path.ChangeExtension(GetDatabasePath(workbenchId), ".schema.json");

    private static object ToDatabaseValue(JsonElement value, SqliteSchemaColumn column)
    {
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            if (!column.IsNullable)
                throw new InvalidOperationException($"Column \"{column.Name}\" cannot be null.");
            return DBNull.Value;
        }

        var type = (column.Type ?? "string").Trim().TrimEnd('?').ToLowerInvariant();
        if (value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString() ?? "";
            if (text.Length == 0 && column.IsNullable)
                return DBNull.Value;
            if (type is "int" or "long" or "short")
                return long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integer)
                    ? integer : throw new InvalidOperationException($"Column \"{column.Name}\" must contain an integer.");
            if (type == "decimal")
                return decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var decimalValue)
                    ? decimalValue : throw new InvalidOperationException($"Column \"{column.Name}\" must contain a decimal number.");
            if (type is "double" or "float")
                return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var floatingPoint)
                    ? floatingPoint : throw new InvalidOperationException($"Column \"{column.Name}\" must contain a number.");
            if (type == "bool")
                return bool.TryParse(text, out var boolean)
                    ? boolean : throw new InvalidOperationException($"Column \"{column.Name}\" must be true or false.");
            if (type == "byte[]")
                return Convert.FromBase64String(text);
            return text;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => type == "bool" ? true : throw new InvalidOperationException($"Column \"{column.Name}\" must be a string or number."),
            JsonValueKind.False => type == "bool" ? false : throw new InvalidOperationException($"Column \"{column.Name}\" must be a string or number."),
            JsonValueKind.Number when type is "int" or "long" or "short" => value.GetInt64(),
            JsonValueKind.Number when type == "decimal" => value.GetDecimal(),
            JsonValueKind.Number when type is "double" or "float" => value.GetDouble(),
            _ => throw new InvalidOperationException($"Column \"{column.Name}\" contains an unsupported value."),
        };
    }

    private static void AddValueParameters(SqliteCommand command, IReadOnlyList<(SqliteSchemaColumn Column, object Value)> values)
    {
        for (var index = 0; index < values.Count; index++)
            command.Parameters.AddWithValue($"$value{index}", values[index].Value);
    }

    private static string? NormalizeDefault(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim().Trim('(', ')', '\'').ToUpperInvariant();

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

    private sealed record SqliteColumnInfo(string Name, string Type, bool NotNull, string? DefaultValue, long PrimaryKeyOrder);
}
