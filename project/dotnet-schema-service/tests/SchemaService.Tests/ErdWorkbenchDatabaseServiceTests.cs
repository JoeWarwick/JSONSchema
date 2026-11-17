using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class ErdWorkbenchDatabaseServiceTests
{
    [Fact]
    public async Task AccountOwner_IsRequiredToAccessOwnedWorkbenchesAndUnownedDatabasesCannotBeClaimed()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-owner-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            var schema = CreateSchema();
            await service.SyncAsync(schema, CancellationToken.None, "owner-a");

            var snapshot = await service.GetSnapshotAsync("workbench-1", CancellationToken.None, "owner-a");
            Assert.Empty(snapshot.Tables[0].Records);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                service.GetSnapshotAsync("workbench-1", CancellationToken.None, "owner-b"));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                service.SyncAsync(schema, CancellationToken.None, "owner-b"));

            var legacySchema = CreateSchema();
            legacySchema.WorkbenchId = "legacy-workbench";
            await service.SyncAsync(legacySchema, CancellationToken.None);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                service.SyncAsync(legacySchema, CancellationToken.None, "owner-a"));
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task SaveRecord_DecodesAndValidatesUploadedImageDataUrls()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-image-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            await service.SyncAsync(new GenerateSqliteSchemaRequest
            {
                WorkbenchId = "image-workbench",
                Tables =
                [
                    new SqliteSchemaTable
                    {
                        Id = "asset",
                        Name = "Asset",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "Image", Type = "byte[]", IsNullable = true },
                        ],
                    },
                ],
            }, CancellationToken.None);

            var saved = await service.SaveRecordAsync("image-workbench", new SaveErdWorkbenchRecordRequest
            {
                TableId = "asset",
                Values = JsonValues(new { Image = "data:image/png;base64,iVBORw0KGgo=" }),
            }, CancellationToken.None);
            Assert.Equal(
                new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A },
                Assert.IsType<byte[]>(saved.Values["Image"]));

            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                service.SaveRecordAsync("image-workbench", new SaveErdWorkbenchRecordRequest
                {
                    TableId = "asset",
                    Values = JsonValues(new { Image = "data:image/jpeg;base64,iVBORw0KGgo=" }),
                }, CancellationToken.None));
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task ReadXmlRecord_NestsRelatedRowsAndUsesKeyReferencesForCycles()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-xml-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            await service.SyncAsync(new GenerateSqliteSchemaRequest
            {
                WorkbenchId = "xml-workbench",
                Tables =
                [
                    new SqliteSchemaTable
                    {
                        Id = "parent",
                        Name = "Parent",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "Region", Type = "string", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "Name", Type = "string" },
                        ],
                    },
                    new SqliteSchemaTable
                    {
                        Id = "child",
                        Name = "Child",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "ParentId", Type = "int" },
                            new SqliteSchemaColumn { Name = "ParentRegion", Type = "string" },
                            new SqliteSchemaColumn { Name = "Label", Type = "string" },
                        ],
                    },
                ],
                Relationships =
                [
                    new SqliteSchemaRelationship
                    {
                        Id = "parent-child",
                        PrincipalTable = "parent",
                        DependentTable = "child",
                        ForeignKeyColumns = ["ParentId", "ParentRegion"],
                        PrincipalCardinality = "one",
                        DependentCardinality = "many",
                        PrincipalNavigation = "Children",
                        DependentNavigation = "Parent",
                    },
                ],
            }, CancellationToken.None, "owner-a");

            var parent = await service.SaveRecordAsync("xml-workbench", new SaveErdWorkbenchRecordRequest
            {
                TableId = "parent",
                Values = JsonValues(new { Id = 7, Region = "west", Name = "Parent A" }),
            }, CancellationToken.None, "owner-a");
            await service.SaveRecordAsync("xml-workbench", new SaveErdWorkbenchRecordRequest
            {
                TableId = "child",
                Values = JsonValues(new { Id = 8, ParentId = 7, ParentRegion = "west", Label = "Child A" }),
            }, CancellationToken.None, "owner-a");

            var xml = await service.ReadXmlRecordAsync(
                "xml-workbench",
                "parent",
                parent.RowId,
                "owner-a",
                CancellationToken.None);
            var document = XDocument.Parse(xml);
            var child = document.Root!.Element("Children")!;
            Assert.Equal("Child A", child.Element("Label")?.Value);
            Assert.Null(child.Element("ParentId"));
            Assert.Equal("7", child.Element("Parent")?.Element("Id")?.Value);
            Assert.Equal("west", child.Element("Parent")?.Element("Region")?.Value);
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task SaveXmlRecord_PersistsNestedRowsAtomicallyAndDeduplicatesByPrimaryKey()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-xml-save-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            await service.SyncAsync(new GenerateSqliteSchemaRequest
            {
                WorkbenchId = "xml-save-workbench",
                Tables =
                [
                    new SqliteSchemaTable
                    {
                        Id = "parent",
                        Name = "Parent",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "Name", Type = "string" },
                        ],
                    },
                    new SqliteSchemaTable
                    {
                        Id = "child",
                        Name = "Child",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "ParentId", Type = "int" },
                            new SqliteSchemaColumn { Name = "Label", Type = "string" },
                        ],
                    },
                ],
                Relationships =
                [
                    new SqliteSchemaRelationship
                    {
                        Id = "parent-child",
                        PrincipalTable = "parent",
                        DependentTable = "child",
                        ForeignKeyColumns = ["ParentId"],
                        PrincipalCardinality = "one",
                        DependentCardinality = "many",
                        PrincipalNavigation = "Children",
                        DependentNavigation = "Parent",
                    },
                ],
            }, CancellationToken.None, "owner-a");

            await Assert.ThrowsAsync<SqliteException>(() => service.SaveXmlRecordAsync(
                "xml-save-workbench",
                "parent",
                null,
                "<Parent><Name>Rolled back</Name><Children><Parent><Id /></Parent></Children></Parent>",
                "owner-a",
                CancellationToken.None));
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.SaveXmlRecordAsync(
                "xml-save-workbench",
                "child",
                null,
                "<Child><Label>Unsaved cycle</Label><Parent><Name>Parent in cycle</Name><Children><Id /></Children></Parent></Child>",
                "owner-a",
                CancellationToken.None));
            var afterRejectedGraphs = await service.GetSnapshotAsync(
                "xml-save-workbench",
                CancellationToken.None,
                "owner-a");
            Assert.Empty(afterRejectedGraphs.Tables.Single(table => table.Id == "parent").Records);
            Assert.Empty(afterRejectedGraphs.Tables.Single(table => table.Id == "child").Records);

            const string xml = """
                <Parent>
                  <Name>Parent A</Name>
                  <Children>
                    <Id>11</Id>
                    <Label>First child version</Label>
                    <Parent><Id /></Parent>
                  </Children>
                  <Children>
                    <Id>11</Id>
                    <Label>Updated child</Label>
                    <Parent><Id /></Parent>
                  </Children>
                </Parent>
                """;
            var saved = await service.SaveXmlRecordAsync(
                "xml-save-workbench",
                "parent",
                null,
                xml,
                "owner-a",
                CancellationToken.None);
            Assert.True(saved.RowId > 0);
            var savedDocument = XDocument.Parse(saved.Xml);
            Assert.NotNull(savedDocument.Root?.Element("Id")?.Value);
            Assert.Equal("Updated child", savedDocument.Root?.Element("Children")?.Element("Label")?.Value);
            Assert.Equal(
                savedDocument.Root?.Element("Id")?.Value,
                savedDocument.Root?.Element("Children")?.Element("Parent")?.Element("Id")?.Value);

            var snapshot = await service.GetSnapshotAsync("xml-save-workbench", CancellationToken.None, "owner-a");
            Assert.Single(snapshot.Tables.Single(table => table.Id == "parent").Records);
            Assert.Single(snapshot.Tables.Single(table => table.Id == "child").Records);
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task SaveXmlRecord_GeneratesUniqueSlugsFromSalientFields()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-slug-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            await service.SyncAsync(new GenerateSqliteSchemaRequest
            {
                WorkbenchId = "slug-workbench",
                Tables =
                [
                    new SqliteSchemaTable
                    {
                        Id = "article",
                        Name = "Article",
                        Columns =
                        [
                            new SqliteSchemaColumn { Name = "Slug", Type = "string", IsPrimaryKey = true },
                            new SqliteSchemaColumn { Name = "Title", Type = "string" },
                        ],
                    },
                ],
            }, CancellationToken.None, "owner-a");

            var first = await service.SaveXmlRecordAsync(
                "slug-workbench", "article", null, "<Article><Title>First Article</Title></Article>",
                "owner-a", CancellationToken.None);
            var second = await service.SaveXmlRecordAsync(
                "slug-workbench", "article", null, "<Article><Title>First Article</Title></Article>",
                "owner-a", CancellationToken.None);

            Assert.Equal("first-article", XDocument.Parse(first.Xml).Root?.Element("Slug")?.Value);
            Assert.Equal("first-article-2", XDocument.Parse(second.Xml).Root?.Element("Slug")?.Value);
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task DeleteJunctionRecord_RemovesTheLinkAndPreservesBothParents()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"schema-sculptor-junction-test-{Guid.NewGuid():N}");
        try
        {
            var service = new ErdWorkbenchDatabaseService(directory);
            await service.SyncAsync(CreateManyToManySchema(), CancellationToken.None);
            var student = await service.SaveRecordAsync("workbench-many-to-many", new SaveErdWorkbenchRecordRequest
            {
                TableId = "student",
                Values = [],
            }, CancellationToken.None);
            var course = await service.SaveRecordAsync("workbench-many-to-many", new SaveErdWorkbenchRecordRequest
            {
                TableId = "course",
                Values = [],
            }, CancellationToken.None);
            var link = await service.SaveRecordAsync("workbench-many-to-many", new SaveErdWorkbenchRecordRequest
            {
                TableId = "enrollment",
                Values = JsonValues(new
                {
                    StudentId = student.Values["Id"],
                    CourseId = course.Values["Id"],
                }),
            }, CancellationToken.None);

            await service.DeleteJunctionRecordAsync("workbench-many-to-many", new DeleteErdWorkbenchJunctionRecordRequest
            {
                TableId = "enrollment",
                RowId = link.RowId,
            }, CancellationToken.None);

            var snapshot = await new ErdWorkbenchDatabaseService(directory)
                .GetSnapshotAsync("workbench-many-to-many", CancellationToken.None);
            Assert.Single(snapshot.Tables.Single(table => table.Id == "student").Records);
            Assert.Single(snapshot.Tables.Single(table => table.Id == "course").Records);
            Assert.Empty(snapshot.Tables.Single(table => table.Id == "enrollment").Records);
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                service.DeleteJunctionRecordAsync("workbench-many-to-many", new DeleteErdWorkbenchJunctionRecordRequest
                {
                    TableId = "student",
                    RowId = student.RowId,
                }, CancellationToken.None));
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

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

    private static GenerateSqliteSchemaRequest CreateManyToManySchema() => new()
    {
        WorkbenchId = "workbench-many-to-many",
        Tables =
        [
            new SqliteSchemaTable
            {
                Id = "student",
                Name = "Student",
                Columns = [new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true }],
            },
            new SqliteSchemaTable
            {
                Id = "course",
                Name = "Course",
                Columns = [new SqliteSchemaColumn { Name = "Id", Type = "int", IsPrimaryKey = true }],
            },
            new SqliteSchemaTable
            {
                Id = "enrollment",
                Name = "Enrollment",
                Columns =
                [
                    new SqliteSchemaColumn { Name = "StudentId", Type = "int", IsPrimaryKey = true },
                    new SqliteSchemaColumn { Name = "CourseId", Type = "int", IsPrimaryKey = true },
                ],
            },
        ],
        Relationships =
        [
            new SqliteSchemaRelationship
            {
                PrincipalTable = "student",
                DependentTable = "enrollment",
                ForeignKeyColumns = ["StudentId"],
            },
            new SqliteSchemaRelationship
            {
                PrincipalTable = "course",
                DependentTable = "enrollment",
                ForeignKeyColumns = ["CourseId"],
            },
        ],
    };

    private static Dictionary<string, JsonElement> JsonValues(object values)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(values));
        return document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
    }
}
