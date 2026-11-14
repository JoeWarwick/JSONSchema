namespace SchemaService.Models;

public sealed class GenerateSqliteSchemaRequest
{
    public string WorkbenchId { get; set; } = "";
    public List<SqliteSchemaTable> Tables { get; set; } = [];
    public List<SqliteSchemaRelationship> Relationships { get; set; } = [];
}

public sealed class SqliteSchemaTable
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<SqliteSchemaColumn> Columns { get; set; } = [];
}

public sealed class SqliteSchemaColumn
{
    public string Name { get; set; } = "";
    public string Type { get; set; } = "string";
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public string? DefaultGeneration { get; set; }
}

public sealed class SqliteSchemaRelationship
{
    public string PrincipalTable { get; set; } = "";
    public string DependentTable { get; set; } = "";
    public List<string> ForeignKeyColumns { get; set; } = [];
}

public sealed class ErdWorkbenchSnapshot
{
    public List<ErdWorkbenchTableSnapshot> Tables { get; set; } = [];
    public List<SqliteSchemaRelationship> Relationships { get; set; } = [];
}

public sealed class ErdWorkbenchTableSnapshot
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<SqliteSchemaColumn> Columns { get; set; } = [];
    public List<ErdWorkbenchRecord> Records { get; set; } = [];
}

public sealed class ErdWorkbenchRecord
{
    public long RowId { get; set; }
    public Dictionary<string, object?> Values { get; set; } = [];
}

public sealed class SaveErdWorkbenchRecordRequest
{
    public string TableId { get; set; } = "";
    public long? RowId { get; set; }
    public Dictionary<string, System.Text.Json.JsonElement> Values { get; set; } = [];
}
