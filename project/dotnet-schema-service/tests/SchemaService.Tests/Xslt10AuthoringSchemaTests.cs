using System.Xml;
using System.Xml.Linq;
using System.Xml.Schema;
using System.Xml.Xsl;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class Xslt10AuthoringSchemaTests
{
    private const string Namespace = "http://www.w3.org/1999/XSL/Transform";
    private static string SchemaText => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "schema-for-xslt10.xsd"));

    private static XmlReaderSettings ReaderSettings() => new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null
    };

    private static XmlSchemaSet CompileSchema()
    {
        var schemas = new XmlSchemaSet { XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(SchemaText), ReaderSettings());
        schemas.Add(Namespace, reader);
        schemas.Compile();
        return schemas;
    }

    private static List<string> Validate(string xml)
    {
        var errors = new List<string>();
        var settings = ReaderSettings();
        settings.Schemas = CompileSchema();
        settings.ValidationType = ValidationType.Schema;
        settings.ValidationEventHandler += (_, args) =>
        {
            if (args.Severity == XmlSeverityType.Error) errors.Add(args.Message);
        };
        using var reader = XmlReader.Create(new StringReader(xml), settings);
        while (reader.Read()) { }
        return errors;
    }

    private static string Stylesheet(string body, string declarations = "") =>
        $"""<xsl:stylesheet xmlns:xsl="{Namespace}" xmlns:e="urn:extensions" version="1.0" {declarations}>{body}</xsl:stylesheet>""";

    [Fact]
    public void CompilesOffline_DeclaresExactlyTheXslt10Vocabulary_WithDocumentation()
    {
        var schemas = CompileSchema();
        var expected = """
            apply-imports apply-templates attribute attribute-set call-template choose
            comment copy copy-of decimal-format element fallback for-each if import
            include key message namespace-alias number otherwise output param
            preserve-space processing-instruction sort strip-space stylesheet template
            text transform value-of variable when with-param
            """.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Order().ToArray();
        var actual = schemas.GlobalElements.Names.Cast<XmlQualifiedName>().Select(name => name.Name).Order().ToArray();
        Assert.Equal(35, actual.Length);
        Assert.Equal(expected, actual);
        XNamespace xs = XmlSchema.Namespace;
        var document = XDocument.Parse(SchemaText);
        Assert.Empty(document.Descendants(xs + "import"));
        Assert.Empty(document.Descendants(xs + "include"));
        Assert.All(document.Root!.Elements(xs + "element"), element =>
            Assert.False(string.IsNullOrWhiteSpace(element.Element(xs + "annotation")?.Element(xs + "documentation")?.Value)));
    }

    [Theory]
    [InlineData("<xsl:template match='/'><result><xsl:value-of select='name'/></result></xsl:template>")]
    [InlineData("<xsl:template match='/'><e:result><xsl:text>Hello</xsl:text></e:result></xsl:template>")]
    [InlineData("<xsl:template match='/'><e:action><xsl:fallback><xsl:text>Fallback</xsl:text></xsl:fallback></e:action></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:apply-templates select='person' mode='e:people'><xsl:sort order='{$direction}'/><xsl:with-param name='prefix' select=\"'Hi'\"/></xsl:apply-templates></xsl:template>")]
    [InlineData("<xsl:template name='greet'><xsl:param name='name'/><xsl:value-of select='$name'/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:for-each select='person'><xsl:sort select='name'/><xsl:value-of select='name'/></xsl:for-each></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:choose><xsl:when test='person'><xsl:text>Yes</xsl:text></xsl:when><xsl:otherwise>No</xsl:otherwise></xsl:choose></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:element name='{name()}'><xsl:attribute name='id'><xsl:value-of select='@id'/></xsl:attribute></xsl:element></xsl:template>")]
    [InlineData("<xsl:import href='base.xsl'/><xsl:include href='shared.xsl'/><e:metadata/><xsl:output method='xml' indent='yes'/>")]
    [InlineData("<xsl:strip-space elements='* e:*'/><xsl:preserve-space elements='e:text'/><xsl:key name='by-id' match='person' use='@id'/><xsl:decimal-format/><xsl:namespace-alias stylesheet-prefix='e' result-prefix='#default'/>")]
    [InlineData("<xsl:attribute-set name='common'><xsl:attribute name='class'>item</xsl:attribute></xsl:attribute-set><xsl:template match='/'><xsl:copy use-attribute-sets='common'/></xsl:template>")]
    public void AcceptsAuthoringStructures(string body)
    {
        Assert.Empty(Validate(Stylesheet(body, "extension-element-prefixes='e'")));
    }

    [Fact]
    public void AcceptsTransformRoot_AndForeignAttributes()
    {
        var xml = $"""<t:transform xmlns:t="{Namespace}" xmlns:e="urn:metadata" version="1.0" xml:space="preserve" e:note="authoring"><t:template match="/"/></t:transform>""";
        Assert.Empty(Validate(xml));
    }

    [Theory]
    [InlineData("<xsl:template match='/'><xsl:value-of/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:if/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:choose><xsl:otherwise/></xsl:choose></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:choose><xsl:otherwise/><xsl:when test='true()'/></xsl:choose></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:for-each select='person'><xsl:text>Before sort</xsl:text><xsl:sort/></xsl:for-each></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:text>Before param</xsl:text><xsl:param name='late'/></xsl:template>")]
    [InlineData("<xsl:template match='/'/><xsl:import href='late.xsl'/>")]
    [InlineData("<xsl:template match='/'><xsl:value-of select='.' separator=','/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:sequence select='.'/></xsl:template>")]
    [InlineData("<xsl:function name='e:function'/>")]
    [InlineData("<xsl:template match='/'><xsl:for-each-group select='person' group-by='name'/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:apply-templates mode='#current'/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:number level='many'/></xsl:template>")]
    [InlineData("<xsl:output indent='true'/>")]
    [InlineData("<xsl:template match='/'><xsl:variable name='value' as='xs:string'/></xsl:template>")]
    public void RejectsInvalidCheckedStructures_AndLaterVersionFeatures(string body)
    {
        Assert.NotEmpty(Validate(Stylesheet(body)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("version='2.0'")]
    public void RequiresVersion10(string version)
    {
        Assert.NotEmpty(Validate($"""<xsl:stylesheet xmlns:xsl="{Namespace}" {version}/>"""));
    }

    [Fact]
    public void DocumentsTheWildcardBoundary_WithoutClaimingFullValidation()
    {
        Assert.Empty(Validate(Stylesheet("<xsl:template match='/'><result><xsl:value-of/></result></xsl:template>")));
        Assert.NotEmpty(Validate(Stylesheet("<xsl:template match='/'><xsl:value-of/></xsl:template>")));
    }

    [Theory]
    [InlineData("<xsl:template/>")]
    [InlineData("<xsl:template match='/'><xsl:value-of select='['/></xsl:template>")]
    [InlineData("<xsl:template match='/'><xsl:variable name='v' select='1'>body</xsl:variable></xsl:template>")]
    public void LeavesSemanticConstraintsToTheProcessor(string body)
    {
        var stylesheet = Stylesheet(body);
        Assert.Empty(Validate(stylesheet));
        var transform = new XslCompiledTransform();
        using var reader = XmlReader.Create(new StringReader(stylesheet), ReaderSettings());
        Assert.ThrowsAny<XsltException>(() => transform.Load(reader, XsltSettings.Default, null));
    }

    [Fact]
    public void FunctionalStylesheet_ValidatesCompilesAndTransformsTwoRecords()
    {
        var stylesheet = Stylesheet("""
            <xsl:output method="xml" omit-xml-declaration="yes"/>
            <xsl:template match="/">
              <xsl:element name="employees">
                <xsl:apply-templates select="persons/person" mode="employee"/>
              </xsl:element>
            </xsl:template>
            <xsl:template match="person" mode="employee">
              <xsl:element name="employee">
                <xsl:element name="firstName"><xsl:value-of select="firstName"/></xsl:element>
                <xsl:element name="lastName"><xsl:value-of select="lastName"/></xsl:element>
              </xsl:element>
            </xsl:template>
            """);
        Assert.Empty(Validate(stylesheet));
        var transform = new XslCompiledTransform();
        using var stylesheetReader = XmlReader.Create(new StringReader(stylesheet), ReaderSettings());
        transform.Load(stylesheetReader, XsltSettings.Default, null);
        using var input = XmlReader.Create(new StringReader("""
            <persons><person><firstName>Alice</firstName><lastName>Smith</lastName></person>
            <person><firstName>Bob</firstName><lastName>Jones</lastName></person></persons>
            """), ReaderSettings());
        using var output = new StringWriter();
        transform.Transform(input, null, output);
        var employees = XDocument.Parse(output.ToString()).Root!.Elements("employee").ToArray();
        Assert.Equal(new[] { "Alice", "Bob" }, employees.Select(employee => employee.Element("firstName")!.Value));
        Assert.Equal(new[] { "Smith", "Jones" }, employees.Select(employee => employee.Element("lastName")!.Value));
    }

    [Theory]
    [InlineData("stylesheet")]
    [InlineData("transform")]
    public void DefaultInstanceTools_CanCreateAnExplicitStylesheetRoot(string root)
    {
        var response = new DefaultInstanceService().Create(new DefaultInstanceRequest
        {
            Schema = SchemaText,
            RootElementName = root
        });
        var document = XDocument.Parse(response.Xml);
        Assert.Equal(XName.Get(root, Namespace), document.Root!.Name);
        Assert.Equal("1.0", document.Root.Attribute("version")?.Value);
        Assert.Empty(Validate(response.Xml));
    }
}
