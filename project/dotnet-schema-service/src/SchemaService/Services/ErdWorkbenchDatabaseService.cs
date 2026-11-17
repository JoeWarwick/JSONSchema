using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class SqliteSchemaCompatibilityException(string message) : InvalidOperationException(message)
{
}

public sealed class ErdWorkbenchDatabaseService(string databaseDirectory)
{
    private const int MaximumIdentifierLength = 256;
    private const int MaximumImageBytes = 5 * 1024 * 1024;

    public async Task<ErdWorkbenchSnapshot> SyncAsync(
        GenerateSqliteSchemaRequest request,
        CancellationToken cancellationToken,
        string? ownerId = null)
    {
        SqliteSchemaGenerator.ValidateRequest(request);
        var path = GetDatabasePath(request.WorkbenchId);
        Directory.CreateDirectory(databaseDirectory);
        if (!string.IsNullOrWhiteSpace(ownerId))
            await EnsureOwnerAsync(request.WorkbenchId, ownerId, cancellationToken);
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

    public async Task<ErdWorkbenchSnapshot> GetSnapshotAsync(
        string workbenchId,
        CancellationToken cancellationToken,
        string? ownerId = null)
    {
        var path = GetDatabasePath(workbenchId);
        if (!string.IsNullOrWhiteSpace(ownerId))
            await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before loading entity records.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        return await ReadSnapshotAsync(connection, schema, cancellationToken);
    }

    public async Task<string> ReadXmlRecordAsync(
        string workbenchId,
        string rootTableId,
        long rowId,
        string ownerId,
        CancellationToken cancellationToken)
    {
        await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
        var path = GetDatabasePath(workbenchId);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before loading XML records.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        var tablesById = schema.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal);
        var root = tablesById.GetValueOrDefault(rootTableId)
            ?? throw new InvalidOperationException("The selected XML root entity does not exist in this ERD database.");
        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        var record = await ReadRecordAsync(connection, null, root, rowId, cancellationToken)
            ?? throw new InvalidOperationException("The selected XML root record does not exist.");

        var xmlRoot = await BuildXmlEntityAsync(
            connection,
            schema,
            tablesById,
            root,
            record,
            XmlName(root.Name),
            new HashSet<string>(StringComparer.Ordinal) { root.Id },
            cancellationToken);
        return new System.Xml.Linq.XDocument(new System.Xml.Linq.XDeclaration("1.0", "utf-8", null), xmlRoot)
            .ToString(System.Xml.Linq.SaveOptions.DisableFormatting);
    }

    public async Task<(string Xml, long RowId)> SaveXmlRecordAsync(
        string workbenchId,
        string rootTableId,
        long? rowId,
        string xml,
        string ownerId,
        CancellationToken cancellationToken)
    {
        await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
        if (string.IsNullOrWhiteSpace(xml) || xml.Length > 10 * 1024 * 1024)
            throw new InvalidOperationException("The XML document must contain no more than 10 MB of content.");
        var path = GetDatabasePath(workbenchId);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before saving XML records.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        var tablesById = schema.Tables.ToDictionary(table => table.Id, StringComparer.Ordinal);
        var rootTable = tablesById.GetValueOrDefault(rootTableId)
            ?? throw new InvalidOperationException("The selected XML root entity does not exist in this ERD database.");
        var settings = new System.Xml.XmlReaderSettings
        {
            DtdProcessing = System.Xml.DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 10 * 1024 * 1024,
        };
        System.Xml.Linq.XDocument document;
        try
        {
            using var textReader = new StringReader(xml);
            using var xmlReader = System.Xml.XmlReader.Create(textReader, settings);
            document = System.Xml.Linq.XDocument.Load(xmlReader);
        }
        catch (System.Xml.XmlException ex)
        {
            throw new InvalidOperationException($"The XML document is invalid: {ex.Message}", ex);
        }

        var rootElement = document.Root;
        if (rootElement is null || rootElement.Name.NamespaceName.Length != 0 ||
            rootElement.Name.LocalName != XmlName(rootTable.Name))
            throw new InvalidOperationException($"The XML document root must be \"{XmlName(rootTable.Name)}\".");

        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var activeAncestors = new Dictionary<string, ErdWorkbenchRecord>(StringComparer.Ordinal);

        async Task<ErdWorkbenchRecord> PersistEntityAsync(
            System.Xml.Linq.XElement entityElement,
            SqliteSchemaTable table,
            long? requestedRowId,
            HashSet<string> ancestors,
            IReadOnlyDictionary<string, JsonElement>? inheritedForeignKeys)
        {
            if (entityElement.Name.NamespaceName.Length != 0)
                throw new InvalidOperationException("XML entity elements must not use a namespace.");
            if (ancestors.Contains(table.Id))
                return await ResolveXmlReferenceAsync(
                    connection,
                    transaction,
                    entityElement,
                    table,
                    activeAncestors,
                    cancellationToken);

            var relationships = GetRelationshipViews(schema, table, tablesById);
            var navigationNames = GetUniqueNavigationNames(table, relationships);
            var navigationByName = navigationNames
                .Select((name, index) => (name, view: relationships[index]))
                .ToDictionary(item => item.name, item => item.view, StringComparer.Ordinal);
            var foreignKeys = schema.Relationships
                .Where(relationship => relationship.DependentTable == table.Id)
                .SelectMany(relationship => relationship.ForeignKeyColumns)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var values = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            foreach (var child in entityElement.Elements())
            {
                if (navigationByName.ContainsKey(child.Name.LocalName))
                    continue;
                var column = table.Columns.SingleOrDefault(candidate =>
                    string.Equals(XmlName(candidate.Name), child.Name.LocalName, StringComparison.Ordinal));
                if (column is null || foreignKeys.Contains(column.Name))
                    throw new InvalidOperationException(
                        $"Element \"{child.Name.LocalName}\" is not an editable field or relationship of entity \"{table.Name}\".");
                if (child.Name.NamespaceName.Length != 0 || child.HasElements)
                    throw new InvalidOperationException($"Field \"{child.Name.LocalName}\" must contain text only.");
                if (values.ContainsKey(column.Name))
                    throw new InvalidOperationException($"Field \"{child.Name.LocalName}\" appears more than once.");
                values[column.Name] = JsonSerializer.SerializeToElement(child.Value);
            }

            if (inheritedForeignKeys is not null)
            {
                foreach (var (name, value) in inheritedForeignKeys)
                    values[name] = value;
            }

            foreach (var (name, view) in navigationByName.Where(item => !item.Value.FromPrincipal))
            {
                var parentElements = entityElement.Elements(XmlName(name)).ToList();
                if (view.Cardinality != "many" && parentElements.Count > 1)
                    throw new InvalidOperationException($"Relationship \"{name}\" accepts at most one entity.");
                foreach (var parentElement in parentElements)
                {
                    var parent = await PersistEntityAsync(
                        parentElement,
                        view.Target,
                        null,
                        new HashSet<string>(ancestors, StringComparer.Ordinal) { table.Id },
                        null);
                    ApplyForeignKeys(values, view.Relationship, parent, view.Target, table);
                }
            }

            await ApplyGeneratedSlugAsync(connection, transaction, table, values, cancellationToken);
            var saved = await UpsertXmlRecordAsync(
                connection,
                transaction,
                table,
                values,
                requestedRowId,
                cancellationToken);
            activeAncestors[table.Id] = saved;

            foreach (var (name, view) in navigationByName.Where(item => item.Value.FromPrincipal))
            {
                var dependentElements = entityElement.Elements(XmlName(name)).ToList();
                if (view.Cardinality != "many" && dependentElements.Count > 1)
                    throw new InvalidOperationException($"Relationship \"{name}\" accepts at most one entity.");
                foreach (var dependentElement in dependentElements)
                {
                    var dependentValues = CreateForeignKeyValues(view.Relationship, saved, tablesById);
                    await PersistEntityAsync(
                        dependentElement,
                        view.Target,
                        null,
                        new HashSet<string>(ancestors, StringComparer.Ordinal) { table.Id },
                        dependentValues);
                }
            }
            return saved;
        }

        var savedRoot = await PersistEntityAsync(
            rootElement,
            rootTable,
            rowId,
            new HashSet<string>(StringComparer.Ordinal),
            null);
        await transaction.CommitAsync(cancellationToken);
        var savedXml = await ReadXmlRecordAsync(workbenchId, rootTableId, savedRoot.RowId, ownerId, cancellationToken);
        return (savedXml, savedRoot.RowId);
    }

    public async Task<ErdWorkbenchRecord> SaveRecordAsync(
        string workbenchId,
        SaveErdWorkbenchRecordRequest request,
        CancellationToken cancellationToken,
        string? ownerId = null)
    {
        var path = GetDatabasePath(workbenchId);
        if (!string.IsNullOrWhiteSpace(ownerId))
            await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
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

    public async Task DeleteJunctionRecordAsync(
        string workbenchId,
        DeleteErdWorkbenchJunctionRecordRequest request,
        CancellationToken cancellationToken,
        string? ownerId = null)
    {
        if (request.RowId <= 0)
            throw new InvalidOperationException("A valid junction record ID is required.");

        var path = GetDatabasePath(workbenchId);
        if (!string.IsNullOrWhiteSpace(ownerId))
            await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
        if (!File.Exists(path))
            throw new InvalidOperationException("Generate the ERD SQLite database before unlinking related entities.");

        var schema = await ReadStoredSchemaAsync(workbenchId, cancellationToken)
            ?? throw new InvalidOperationException("The ERD SQLite database has not been initialized.");
        var table = schema.Tables.SingleOrDefault(candidate => candidate.Id == request.TableId)
            ?? throw new InvalidOperationException("The selected junction entity does not exist in this ERD database.");
        var relationships = schema.Relationships
            .Where(relationship => relationship.DependentTable == table.Id)
            .ToList();
        var foreignKeyColumns = relationships.SelectMany(relationship => relationship.ForeignKeyColumns).ToList();
        if (relationships.Count != 2 ||
            relationships.Any(relationship => relationship.ForeignKeyColumns.Count == 0) ||
            foreignKeyColumns.Distinct(StringComparer.OrdinalIgnoreCase).Count() != foreignKeyColumns.Count ||
            schema.Relationships.Any(relationship => relationship.PrincipalTable == table.Id))
            throw new InvalidOperationException("Unlinking is allowed only for an unreferenced junction entity with two distinct parent relationships.");

        await using var connection = await OpenConnectionAsync(path, cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = ON;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var rowIdColumn = GetRowIdColumn(table);
        await using var delete = connection.CreateCommand();
        delete.Transaction = transaction;
        delete.CommandText = $"DELETE FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} WHERE {rowIdColumn} = $rowId;";
        delete.Parameters.AddWithValue("$rowId", request.RowId);
        if (await delete.ExecuteNonQueryAsync(cancellationToken) == 0)
            throw new InvalidOperationException("The selected junction record no longer exists.");

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<byte[]> ExportAsync(
        string workbenchId,
        CancellationToken cancellationToken,
        string? ownerId = null)
    {
        var path = GetDatabasePath(workbenchId);
        if (!string.IsNullOrWhiteSpace(ownerId))
            await VerifyOwnerAsync(workbenchId, ownerId, cancellationToken);
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
        SqliteTransaction? transaction,
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

    private static async Task<System.Xml.Linq.XElement> BuildXmlEntityAsync(
        SqliteConnection connection,
        GenerateSqliteSchemaRequest schema,
        IReadOnlyDictionary<string, SqliteSchemaTable> tablesById,
        SqliteSchemaTable table,
        ErdWorkbenchRecord record,
        string elementName,
        HashSet<string> ancestors,
        CancellationToken cancellationToken)
    {
        var element = new System.Xml.Linq.XElement(XmlName(elementName));
        var foreignKeys = schema.Relationships
            .Where(relationship => relationship.DependentTable == table.Id)
            .SelectMany(relationship => relationship.ForeignKeyColumns)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var column in table.Columns.Where(column => !foreignKeys.Contains(column.Name)))
        {
            if (!record.Values.TryGetValue(column.Name, out var value) || value is null)
                continue;
            element.Add(new System.Xml.Linq.XElement(
                XmlName(column.Name),
                FormatXmlValue(value, column)));
        }

        var views = GetRelationshipViews(schema, table, tablesById);
        var navigationNames = GetUniqueNavigationNames(table, views);
        for (var index = 0; index < views.Count; index++)
        {
            var view = views[index];
            var relatedRecords = await ReadRelatedRecordsAsync(
                connection,
                record,
                view,
                tablesById,
                cancellationToken);
            if (view.Cardinality != "many" && relatedRecords.Count > 1)
                throw new InvalidOperationException(
                    $"Entity \"{table.Name}\" has multiple records for singular relationship \"{view.NavigationName}\".");
            foreach (var related in relatedRecords)
            {
                if (ancestors.Contains(view.Target.Id))
                {
                    element.Add(CreateXmlReference(view.Target, related, navigationNames[index]));
                }
                else
                {
                    element.Add(await BuildXmlEntityAsync(
                        connection,
                        schema,
                        tablesById,
                        view.Target,
                        related,
                        navigationNames[index],
                        new HashSet<string>(ancestors, StringComparer.Ordinal) { view.Target.Id },
                        cancellationToken));
                }
            }
        }
        return element;
    }

    private static List<EntityRelationshipView> GetRelationshipViews(
        GenerateSqliteSchemaRequest schema,
        SqliteSchemaTable table,
        IReadOnlyDictionary<string, SqliteSchemaTable> tablesById)
    {
        var views = new List<EntityRelationshipView>();
        foreach (var relationship in schema.Relationships)
        {
            if (relationship.PrincipalTable == table.Id &&
                tablesById.TryGetValue(relationship.DependentTable, out var dependent))
            {
                views.Add(new EntityRelationshipView(
                    relationship,
                    dependent,
                    relationship.PrincipalNavigation?.Trim() is { Length: > 0 } principalNavigation
                        ? principalNavigation
                        : Pluralize(dependent.Name),
                    relationship.DependentCardinality,
                    true));
            }
            if (relationship.DependentTable == table.Id &&
                tablesById.TryGetValue(relationship.PrincipalTable, out var principal))
            {
                views.Add(new EntityRelationshipView(
                    relationship,
                    principal,
                    relationship.DependentNavigation?.Trim() is { Length: > 0 } dependentNavigation
                        ? dependentNavigation
                        : principal.Name,
                    relationship.PrincipalCardinality,
                    false));
            }
        }
        return views;
    }

    private static List<string> GetUniqueNavigationNames(
        SqliteSchemaTable table,
        IReadOnlyList<EntityRelationshipView> views)
    {
        var names = table.Columns.Select(column => XmlName(column.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new List<string>(views.Count);
        foreach (var view in views)
        {
            var name = XmlName(view.NavigationName);
            if (names.Contains(name))
                name = XmlName($"{name}_{view.Target.Id}");
            if (!names.Add(name))
                throw new InvalidOperationException(
                    $"Entity \"{table.Name}\" has multiple relationships that produce the same XML element name \"{name}\".");
            result.Add(name);
        }
        return result;
    }

    private static async Task<List<ErdWorkbenchRecord>> ReadRelatedRecordsAsync(
        SqliteConnection connection,
        ErdWorkbenchRecord currentRecord,
        EntityRelationshipView view,
        IReadOnlyDictionary<string, SqliteSchemaTable> tablesById,
        CancellationToken cancellationToken)
    {
        var relationship = view.Relationship;
        var principal = tablesById[relationship.PrincipalTable];
        var principalKeys = principal.Columns.Where(column => column.IsPrimaryKey).ToList();
        var filters = view.FromPrincipal
            ? relationship.ForeignKeyColumns
                .Select((foreignKey, index) => (
                    Name: foreignKey,
                    Value: currentRecord.Values[principalKeys[index].Name]))
                .ToList()
            : relationship.ForeignKeyColumns
                .Select((foreignKey, index) => (
                    Name: principalKeys[index].Name,
                    Value: currentRecord.Values[foreignKey]))
                .ToList();
        return await ReadRecordsByValuesAsync(
            connection,
            view.Target,
            filters,
            cancellationToken);
    }

    private static async Task<List<ErdWorkbenchRecord>> ReadRecordsByValuesAsync(
        SqliteConnection connection,
        SqliteSchemaTable table,
        IReadOnlyList<(string Name, object? Value)> filters,
        CancellationToken cancellationToken)
    {
        if (filters.Count == 0 || filters.Any(filter => filter.Value is null))
            return [];
        var rowIdColumn = GetRowIdColumn(table);
        var columns = string.Join(", ", table.Columns.Select(column => SqliteSchemaGenerator.QuoteIdentifier(column.Name)));
        var predicates = string.Join(" AND ", filters.Select((filter, index) =>
            $"{SqliteSchemaGenerator.QuoteIdentifier(filter.Name)} = $key{index}"));
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"SELECT {rowIdColumn}, {columns} FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} " +
            $"WHERE {predicates} ORDER BY {rowIdColumn};";
        for (var index = 0; index < filters.Count; index++)
            command.Parameters.AddWithValue($"$key{index}", filters[index].Value!);
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

    private static async Task<ErdWorkbenchRecord> ResolveXmlReferenceAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        System.Xml.Linq.XElement referenceElement,
        SqliteSchemaTable table,
        IReadOnlyDictionary<string, ErdWorkbenchRecord> activeAncestors,
        CancellationToken cancellationToken)
    {
        var keyColumns = table.Columns.Where(column => column.IsPrimaryKey).ToList();
        var values = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        foreach (var child in referenceElement.Elements())
        {
            var column = keyColumns.SingleOrDefault(candidate =>
                string.Equals(XmlName(candidate.Name), child.Name.LocalName, StringComparison.Ordinal));
            if (column is null || child.Name.NamespaceName.Length != 0 || child.HasElements)
                throw new InvalidOperationException($"Element \"{child.Name.LocalName}\" is not a key of reference entity \"{table.Name}\".");
            if (!string.IsNullOrWhiteSpace(child.Value))
                values[column.Name] = JsonSerializer.SerializeToElement(child.Value);
        }

        if (activeAncestors.TryGetValue(table.Id, out var ancestor))
        {
            foreach (var (name, value) in values)
            {
                var column = keyColumns.Single(candidate => string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));
                if (!AreValuesEqual(ToDatabaseValue(value, column), ancestor.Values[name]))
                    throw new InvalidOperationException($"A cycle reference to \"{table.Name}\" does not match its ancestor entity.");
            }
            return ancestor;
        }

        if (keyColumns.Count == 0)
            throw new InvalidOperationException($"A cycle reference to \"{table.Name}\" requires an existing row ID.");
        if (keyColumns.Any(column => !values.ContainsKey(column.Name)))
            throw new InvalidOperationException($"A new required cycle through \"{table.Name}\" cannot be resolved without all primary key values.");
        var rowId = await FindRowIdByKeysAsync(connection, transaction, table, values, cancellationToken)
            ?? throw new InvalidOperationException($"The referenced \"{table.Name}\" entity does not exist.");
        return await ReadRecordAsync(connection, transaction, table, rowId, cancellationToken)
            ?? throw new InvalidOperationException($"The referenced \"{table.Name}\" entity does not exist.");
    }

    private static async Task<ErdWorkbenchRecord> UpsertXmlRecordAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        IReadOnlyDictionary<string, JsonElement> values,
        long? requestedRowId,
        CancellationToken cancellationToken)
    {
        var databaseValues = new List<(SqliteSchemaColumn Column, object Value)>();
        foreach (var (name, value) in values)
        {
            var column = table.Columns.SingleOrDefault(candidate =>
                string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Column \"{name}\" does not exist in entity \"{table.Name}\".");
            if (value.ValueKind == JsonValueKind.String && string.IsNullOrEmpty(value.GetString()) &&
                (IsIntegerIdentityColumn(column) || IsSlugKeyColumn(table, column)))
                continue;
            databaseValues.Add((column, ToDatabaseValue(value, column)));
        }

        var rowId = requestedRowId ?? await FindRowIdByKeysAsync(connection, transaction, table, values, cancellationToken);
        if (rowId is not null)
        {
            var updates = databaseValues.Where(value => !value.Column.IsPrimaryKey).ToList();
            if (updates.Count > 0)
            {
                var assignments = string.Join(", ", updates.Select((value, index) =>
                    $"{SqliteSchemaGenerator.QuoteIdentifier(value.Column.Name)} = $value{index}"));
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText =
                    $"UPDATE {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} SET {assignments} " +
                    $"WHERE {GetRowIdColumn(table)} = $rowId;";
                update.Parameters.AddWithValue("$rowId", rowId.Value);
                AddValueParameters(update, updates);
                if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                    throw new InvalidOperationException("The selected XML entity record no longer exists.");
            }
        }
        else
        {
            var columnNames = string.Join(", ", databaseValues.Select(value =>
                SqliteSchemaGenerator.QuoteIdentifier(value.Column.Name)));
            var parameterNames = string.Join(", ", databaseValues.Select((_, index) => $"$value{index}"));
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = databaseValues.Count == 0
                ? $"INSERT INTO {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} DEFAULT VALUES;"
                : $"INSERT INTO {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} ({columnNames}) VALUES ({parameterNames});";
            AddValueParameters(insert, databaseValues);
            await insert.ExecuteNonQueryAsync(cancellationToken);
            await using var lastId = connection.CreateCommand();
            lastId.Transaction = transaction;
            lastId.CommandText = "SELECT last_insert_rowid();";
            rowId = (long)(await lastId.ExecuteScalarAsync(cancellationToken))!;
        }

        return await ReadRecordAsync(connection, transaction, table, rowId.Value, cancellationToken)
            ?? throw new InvalidOperationException("The XML entity record could not be read after saving.");
    }

    private static async Task<long?> FindRowIdByKeysAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        IReadOnlyDictionary<string, JsonElement> values,
        CancellationToken cancellationToken)
    {
        var keyColumns = table.Columns.Where(column => column.IsPrimaryKey).ToList();
        if (keyColumns.Count == 0 || keyColumns.Any(column =>
            !values.TryGetValue(column.Name, out var value) ||
            value.ValueKind == JsonValueKind.String && string.IsNullOrEmpty(value.GetString())))
            return null;

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        var predicates = new List<string>();
        for (var index = 0; index < keyColumns.Count; index++)
        {
            var column = keyColumns[index];
            var parameterName = $"$key{index}";
            predicates.Add($"{SqliteSchemaGenerator.QuoteIdentifier(column.Name)} = {parameterName}");
            command.Parameters.AddWithValue(parameterName, ToDatabaseValue(values[column.Name], column));
        }
        command.CommandText =
            $"SELECT {GetRowIdColumn(table)} FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} " +
            $"WHERE {string.Join(" AND ", predicates)} LIMIT 1;";
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is null or DBNull ? null : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    private static void ApplyForeignKeys(
        IDictionary<string, JsonElement> values,
        SqliteSchemaRelationship relationship,
        ErdWorkbenchRecord principal,
        SqliteSchemaTable principalTable,
        SqliteSchemaTable dependentTable)
    {
        var principalKeys = principalTable.Columns.Where(column => column.IsPrimaryKey).ToList();
        for (var index = 0; index < relationship.ForeignKeyColumns.Count; index++)
        {
            var foreignKey = relationship.ForeignKeyColumns[index];
            var keyValue = principal.Values[principalKeys[index].Name];
            var jsonValue = JsonSerializer.SerializeToElement(keyValue);
            if (values.TryGetValue(foreignKey, out var existing))
            {
                var foreignKeyColumn = dependentTable.Columns.FirstOrDefault(column =>
                    string.Equals(column.Name, foreignKey, StringComparison.OrdinalIgnoreCase));
                if (foreignKeyColumn is not null &&
                    !AreValuesEqual(ToDatabaseValue(existing, foreignKeyColumn), keyValue))
                    throw new InvalidOperationException($"Relationship key \"{foreignKey}\" conflicts with its nested entity.");
            }
            values[foreignKey] = jsonValue;
        }
    }

    private static Dictionary<string, JsonElement> CreateForeignKeyValues(
        SqliteSchemaRelationship relationship,
        ErdWorkbenchRecord principal,
        IReadOnlyDictionary<string, SqliteSchemaTable> tablesById)
    {
        var principalTable = tablesById[relationship.PrincipalTable];
        var principalKeys = principalTable.Columns.Where(column => column.IsPrimaryKey).ToList();
        return relationship.ForeignKeyColumns
            .Select((foreignKey, index) => new
            {
                Name = foreignKey,
                Value = JsonSerializer.SerializeToElement(principal.Values[principalKeys[index].Name]),
            })
            .ToDictionary(item => item.Name, item => item.Value, StringComparer.OrdinalIgnoreCase);
    }

    private static async Task ApplyGeneratedSlugAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        IDictionary<string, JsonElement> values,
        CancellationToken cancellationToken)
    {
        var slugKey = table.Columns.FirstOrDefault(IsSlugKeyColumn);
        var source = table.Columns.FirstOrDefault(column =>
            !column.IsPrimaryKey && Regex.IsMatch(column.Name, "^(title|name|label)$", RegexOptions.IgnoreCase));
        if (slugKey is null || source is null ||
            values.TryGetValue(slugKey.Name, out var existingSlug) && !string.IsNullOrWhiteSpace(existingSlug.ToString()) ||
            !values.TryGetValue(source.Name, out var sourceValue) || sourceValue.ValueKind != JsonValueKind.String)
            return;

        var baseSlug = CreateSlug(sourceValue.GetString() ?? "");
        var slug = string.IsNullOrEmpty(baseSlug) ? "item" : baseSlug;
        for (var suffix = 2; await SlugExistsAsync(connection, transaction, table, slugKey, slug, cancellationToken); suffix++)
            slug = $"{(string.IsNullOrEmpty(baseSlug) ? "item" : baseSlug)}-{suffix}";
        values[slugKey.Name] = JsonSerializer.SerializeToElement(slug);
    }

    private static async Task<bool> SlugExistsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        SqliteSchemaTable table,
        SqliteSchemaColumn keyColumn,
        string value,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            $"SELECT EXISTS(SELECT 1 FROM {SqliteSchemaGenerator.QuoteIdentifier(table.Name)} " +
            $"WHERE {SqliteSchemaGenerator.QuoteIdentifier(keyColumn.Name)} = $slug);";
        command.Parameters.AddWithValue("$slug", value);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) != 0;
    }

    private static string CreateSlug(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormD);
        var withoutMarks = new string(normalized.Where(character =>
            CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark).ToArray());
        var slug = Regex.Replace(withoutMarks.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return slug;
    }

    private static bool IsIntegerIdentityColumn(SqliteSchemaColumn column) =>
        column.IsPrimaryKey && (column.Type ?? "").Trim().TrimEnd('?').ToLowerInvariant() is "int" or "long" or "short";

    private static bool IsSlugKeyColumn(SqliteSchemaTable table, SqliteSchemaColumn column) =>
        column.IsPrimaryKey &&
        column.Name is not null &&
        Regex.IsMatch(column.Name, "^(id|slug)$", RegexOptions.IgnoreCase) &&
        column.Type is not null &&
        SqliteSchemaGenerator.SqliteType(column.Type) == "TEXT" &&
        table.Columns.Any(candidate => !candidate.IsPrimaryKey &&
            Regex.IsMatch(candidate.Name, "^(title|name|label)$", RegexOptions.IgnoreCase));

    private static bool IsSlugKeyColumn(SqliteSchemaColumn column) =>
        column.IsPrimaryKey &&
        Regex.IsMatch(column.Name, "^(id|slug)$", RegexOptions.IgnoreCase) &&
        SqliteSchemaGenerator.SqliteType(column.Type) == "TEXT";

    private static bool AreValuesEqual(object? left, object? right) =>
        left is byte[] leftBytes && right is byte[] rightBytes
            ? leftBytes.AsSpan().SequenceEqual(rightBytes)
            : Equals(left, right);

    private static System.Xml.Linq.XElement CreateXmlReference(
        SqliteSchemaTable table,
        ErdWorkbenchRecord record,
        string elementName)
    {
        var reference = new System.Xml.Linq.XElement(XmlName(elementName));
        var keys = table.Columns.Where(column => column.IsPrimaryKey).ToList();
        if (keys.Count == 0)
        {
            reference.Add(new System.Xml.Linq.XElement("RowId", record.RowId.ToString(CultureInfo.InvariantCulture)));
            return reference;
        }
        foreach (var key in keys)
            reference.Add(new System.Xml.Linq.XElement(XmlName(key.Name), FormatXmlValue(record.Values[key.Name]!, key)));
        return reference;
    }

    private static string FormatXmlValue(object value, SqliteSchemaColumn column)
    {
        if (value is byte[] bytes)
        {
            var mimeType = DetectImageMimeType(bytes);
            return mimeType is null
                ? Convert.ToBase64String(bytes)
                : $"data:{mimeType};base64,{Convert.ToBase64String(bytes)}";
        }
        if (string.Equals(column.Type.Trim().TrimEnd('?'), "bool", StringComparison.OrdinalIgnoreCase))
            return Convert.ToInt64(value, CultureInfo.InvariantCulture) != 0 ? "true" : "false";
        return value is IFormattable formattable
            ? formattable.ToString(null, CultureInfo.InvariantCulture) ?? ""
            : value.ToString() ?? "";
    }

    private static string XmlName(string value)
    {
        var name = System.Text.RegularExpressions.Regex.Replace(value.Trim(), "[^A-Za-z0-9._-]", "_");
        if (string.IsNullOrEmpty(name))
            throw new InvalidOperationException("ERD names must not be empty.");
        return char.IsLetter(name[0]) || name[0] == '_' ? name : $"_{name}";
    }

    private static string Pluralize(string name)
    {
        if (name.EndsWith('y') && !System.Text.RegularExpressions.Regex.IsMatch(name, "[aeiou]y$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            return $"{name[..^1]}ies";
        if (name.EndsWith('s'))
            return $"{name}es";
        return $"{name}s";
    }

    private sealed record EntityRelationshipView(
        SqliteSchemaRelationship Relationship,
        SqliteSchemaTable Target,
        string NavigationName,
        string Cardinality,
        bool FromPrincipal);

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

    private string GetOwnerPath(string workbenchId) =>
        Path.ChangeExtension(GetDatabasePath(workbenchId), ".owner");

    private async Task EnsureOwnerAsync(string workbenchId, string ownerId, CancellationToken cancellationToken)
    {
        var ownerPath = GetOwnerPath(workbenchId);
        var ownerHash = HashOwner(ownerId);
        if (File.Exists(ownerPath))
        {
            await VerifyOwnerFileAsync(ownerPath, ownerHash, cancellationToken);
            return;
        }

        if (File.Exists(GetDatabasePath(workbenchId)))
            throw new UnauthorizedAccessException("This existing ERD workbench has no account owner and cannot be claimed.");

        try
        {
            await using var stream = new FileStream(ownerPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await stream.WriteAsync(Encoding.ASCII.GetBytes(ownerHash), cancellationToken);
        }
        catch (IOException) when (File.Exists(ownerPath))
        {
            await VerifyOwnerFileAsync(ownerPath, ownerHash, cancellationToken);
        }
    }

    private async Task VerifyOwnerAsync(string workbenchId, string ownerId, CancellationToken cancellationToken)
    {
        var ownerPath = GetOwnerPath(workbenchId);
        if (!File.Exists(ownerPath))
            throw new UnauthorizedAccessException("The ERD workbench does not exist or is not accessible.");
        await VerifyOwnerFileAsync(ownerPath, HashOwner(ownerId), cancellationToken);
    }

    private static async Task VerifyOwnerFileAsync(
        string ownerPath,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        var actualHash = await File.ReadAllTextAsync(ownerPath, cancellationToken);
        var actualBytes = Encoding.ASCII.GetBytes(actualHash);
        var expectedBytes = Encoding.ASCII.GetBytes(expectedHash);
        if (actualBytes.Length != expectedBytes.Length ||
            !CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes))
            throw new UnauthorizedAccessException("The ERD workbench does not exist or is not accessible.");
    }

    private static string HashOwner(string ownerId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ownerId)));

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
                return ParseBinaryValue(text, column.Name);
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

    private static byte[] ParseBinaryValue(string text, string columnName)
    {
        var data = text;
        string? declaredMimeType = null;
        if (text.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = text.IndexOf(',');
            if (comma < 0)
                throw new InvalidOperationException($"Column \"{columnName}\" contains an invalid image data URL.");
            var metadata = text[5..comma].Split(';');
            if (metadata.Length != 2 || !string.Equals(metadata[1], "base64", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Column \"{columnName}\" must contain a base64 image data URL.");
            declaredMimeType = metadata[0].ToLowerInvariant();
            if (declaredMimeType is not ("image/png" or "image/jpeg" or "image/gif" or "image/webp"))
                throw new InvalidOperationException($"Column \"{columnName}\" uses an unsupported image type.");
            data = text[(comma + 1)..];
        }

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(data);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException($"Column \"{columnName}\" must contain valid base64 data.", ex);
        }
        if (bytes.Length > MaximumImageBytes)
            throw new InvalidOperationException($"Column \"{columnName}\" must not exceed 5 MB.");

        if (declaredMimeType is not null &&
            !string.Equals(declaredMimeType, DetectImageMimeType(bytes), StringComparison.Ordinal))
            throw new InvalidOperationException($"Column \"{columnName}\" image content does not match its declared type.");
        return bytes;
    }

    private static string? DetectImageMimeType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
            return "image/png";
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return "image/jpeg";
        if (bytes.Length >= 6 &&
            (bytes[..6].SequenceEqual("GIF87a"u8) || bytes[..6].SequenceEqual("GIF89a"u8)))
            return "image/gif";
        if (bytes.Length >= 12 &&
            bytes[..4].SequenceEqual("RIFF"u8) &&
            bytes[8..12].SequenceEqual("WEBP"u8))
            return "image/webp";
        return null;
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
