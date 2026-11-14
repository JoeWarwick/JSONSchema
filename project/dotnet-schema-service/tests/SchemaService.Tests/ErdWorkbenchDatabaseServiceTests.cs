using System.Text.Json;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class ErdWorkbenchDatabaseServiceTests
{
    [Fact]
    public async Task SyncAndSave_PreserveRecordsWhenAddingNullableColumns()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-workbench-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            var initialSchema = CreateSchema();
            var initialSnapshot = await service.SyncAsync(initialSchema, CancellationToken.None);
            Assert.Empty(initialSnapshot.Tables[0].Records);

            using var nameJson = JsonDocument.Parse("\"Ada Lovelace\"");
            var saved = await service.SaveRecordAsync("workbench-1", new SaveErdWorkbenchRecordRequest
            {
                TableId = "person",
                Values = new Dictionary<string, JsonElement>
                {
                    ["Name"] = nameJson.RootElement.Clone(),
                },
            }, CancellationToken.None);
            Assert.Equal("Ada Lovelace", saved.Values["Name"]);

            using var updatedNameJson = JsonDocument.Parse("\"Ada Lovelace Byron\"");
            var edited = await service.SaveRecordAsync("workbench-1", new SaveErdWorkbenchRecordRequest
            {
                TableId = "person",
                RowId = saved.RowId,
                Values = new Dictionary<string, JsonElement>
                {
                    ["Name"] = updatedNameJson.RootElement.Clone(),
                },
            }, CancellationToken.None);
            Assert.Equal("Ada Lovelace Byron", edited.Values["Name"]);

            var restartedService = new ErdWorkbenchDatabaseService(directory);
            var updated = CreateSchema();
            updated.Tables[0].Columns.Add(new SqliteSchemaColumn
            {
                Name = "Nickname",
                Type = "string",
                IsNullable = true,
            });
            var updatedSnapshot = await restartedService.SyncAsync(updated, CancellationToken.None);
            Assert.Single(updatedSnapshot.Tables[0].Records);
            Assert.Equal("Ada Lovelace Byron", updatedSnapshot.Tables[0].Records[0].Values["Name"]);
            Assert.Null(updatedSnapshot.Tables[0].Records[0].Values["Nickname"]);

            var incompatible = CreateSchema();
            incompatible.Tables[0].Columns.RemoveAll(column => column.Name == "Name");
            var error = await Assert.ThrowsAsync<SqliteSchemaCompatibilityException>(
                () => service.SyncAsync(incompatible, CancellationToken.None));
            Assert.Contains("removed from", error.Message);

            var afterRejectedChange = await new ErdWorkbenchDatabaseService(directory)
                .GetSnapshotAsync("workbench-1", CancellationToken.None);
            Assert.Equal("Ada Lovelace Byron", afterRejectedChange.Tables[0].Records[0].Values["Name"]);
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    private static GenerateSqliteSchemaRequest CreateSchema() => new()
    {
        WorkbenchId = "workbench-1",
        Tables =
        [
            new SqliteSchemaTable
            {
                Id = "person",
                Name = "Person",
                Columns =
                [
                    new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                    new SqliteSchemaColumn { Name = "Name", Type = "string", IsNullable = false },
                ],
            },
        ],
    };
}
