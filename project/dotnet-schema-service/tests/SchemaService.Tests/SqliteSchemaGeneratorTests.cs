using Microsoft.Data.Sqlite;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class SqliteSchemaGeneratorTests
{
    [Fact]
    public async Task GenerateAsync_CreatesTablesKeysDefaultsAndCascadeForeignKeys()
    {
        var request = new GenerateSqliteSchemaRequest
        {
            Tables =
            [
                new SqliteSchemaTable
                {
                    Id = "parent",
                    Name = "Parent",
                    Columns =
                    [
                        new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                        new SqliteSchemaColumn { Name = "CreatedAt", Type = "DateTime", DefaultGeneration = "current-timestamp" },
                        new SqliteSchemaColumn { Name = "Balance", Type = "decimal" },
                    ],
                },
                new SqliteSchemaTable
                {
                    Id = "child",
                    Name = "Child",
                    Columns =
                    [
                        new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                        new SqliteSchemaColumn { Name = "ParentId", Type = "int", IsNullable = false },
                    ],
                },
            ],
            Relationships =
            [
                new SqliteSchemaRelationship
                {
                    PrincipalTable = "parent",
                    DependentTable = "child",
                    ForeignKeyColumns = ["ParentId"],
                },
            ],
        };

        var database = await new SqliteSchemaGenerator().GenerateAsync(request, CancellationToken.None);
        var databasePath = Path.Combine(Path.GetTempPath(), $"schema-sculptor-test-{Guid.NewGuid():N}.sqlite");
        try
        {
            await File.WriteAllBytesAsync(databasePath, database);
            await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = databasePath,
                Pooling = false,
            }.ToString());
            await connection.OpenAsync();

            await using var foreignKeys = connection.CreateCommand();
            foreignKeys.CommandText = "PRAGMA foreign_key_list(\"Child\");";
            await using var reader = await foreignKeys.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal("Parent", reader.GetString(reader.GetOrdinal("table")));
            Assert.Equal("ParentId", reader.GetString(reader.GetOrdinal("from")));
            Assert.Equal("CASCADE", reader.GetString(reader.GetOrdinal("on_delete")));
            await reader.DisposeAsync();

            await using var schema = connection.CreateCommand();
            schema.CommandText = "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Parent';";
            var createTable = (string?)await schema.ExecuteScalarAsync();
            Assert.Contains("\"Id\" INTEGER PRIMARY KEY AUTOINCREMENT", createTable);
            Assert.Contains("CreatedAt", createTable);

            schema.CommandText = "PRAGMA table_info(\"Parent\");";
            await using var columns = await schema.ExecuteReaderAsync();
            var hasCurrentTimestampDefault = false;
            var hasNumericBalance = false;
            while (await columns.ReadAsync())
            {
                var name = columns.GetString(columns.GetOrdinal("name"));
                if (name == "CreatedAt")
                    hasCurrentTimestampDefault = columns.GetString(columns.GetOrdinal("dflt_value")) == "CURRENT_TIMESTAMP";
                else if (name == "Balance")
                    hasNumericBalance = columns.GetString(columns.GetOrdinal("type")) == "NUMERIC";
            }
            Assert.True(hasCurrentTimestampDefault);
            Assert.True(hasNumericBalance);
        }
        finally
        {
            if (File.Exists(databasePath))
                File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task GenerateAsync_RejectsDuplicateTableNames()
    {
        var request = new GenerateSqliteSchemaRequest
        {
            Tables =
            [
                new SqliteSchemaTable { Id = "first", Name = "Entity", Columns = [new SqliteSchemaColumn { Name = "Id" }] },
                new SqliteSchemaTable { Id = "second", Name = "entity", Columns = [new SqliteSchemaColumn { Name = "Id" }] },
            ],
        };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => new SqliteSchemaGenerator().GenerateAsync(request, CancellationToken.None));

        Assert.Contains("Duplicate table name", error.Message);
    }
}
