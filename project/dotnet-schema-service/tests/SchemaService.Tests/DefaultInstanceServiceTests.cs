using System.Xml.Linq;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class DefaultInstanceServiceTests
{
    [Fact]
    public void Create_UsesTypeAwarePlaceholders_ForBuiltInPrimitiveTypes()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://example.com/t"
           targetNamespace="http://example.com/t"
           elementFormDefault="qualified">
  <xs:complexType name="SampleType">
    <xs:sequence>
      <xs:element name="count" type="xs:int"/>
      <xs:element name="price" type="xs:decimal"/>
      <xs:element name="when" type="xs:date"/>
      <xs:element name="stamp" type="xs:dateTime"/>
      <xs:element name="at" type="xs:time"/>
      <xs:element name="flag" type="xs:boolean"/>
    </xs:sequence>
    <xs:attribute name="id" type="xs:int" use="required"/>
  </xs:complexType>
  <xs:element name="root" type="tns:SampleType"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "root"
        });

        var doc = XDocument.Parse(response.Xml);
        var root = doc.Root;

        Assert.NotNull(root);
        Assert.Equal("root", root!.Name.LocalName);
        Assert.Equal("0", root.Attribute("id")?.Value);
        Assert.Equal("0", root.Element(root.Name.Namespace + "count")?.Value);
        Assert.Equal("0", root.Element(root.Name.Namespace + "price")?.Value);
        Assert.Equal("2026-07-22", root.Element(root.Name.Namespace + "when")?.Value);
        Assert.Equal("2026-07-22T00:00:00Z", root.Element(root.Name.Namespace + "stamp")?.Value);
        Assert.Equal("00:00:00", root.Element(root.Name.Namespace + "at")?.Value);
        Assert.Equal("true", root.Element(root.Name.Namespace + "flag")?.Value);
    }

    [Fact]
    public void Create_GeneratesInstance_WhenSchemaHasUnresolvedUnusedImport()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://example.com/demo"
           targetNamespace="http://example.com/demo"
           elementFormDefault="qualified">
  <xs:import namespace="http://example.com/external" schemaLocation="external-types.xsd"/>

  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:element name="person" type="tns:PersonType"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "person"
        });

        var doc = XDocument.Parse(response.Xml);
        var root = doc.Root;

        Assert.NotNull(root);
        Assert.Equal("person", root!.Name.LocalName);
        Assert.Equal("string", root.Element(root.Name.Namespace + "firstName")?.Value);
    }

    [Fact]
    public void Create_IncludesBaseAndExtensionFields_ForComplexContentExtensionRoot()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:tns="http://example.com/demo"
           targetNamespace="http://example.com/demo"
           elementFormDefault="qualified"
           attributeFormDefault="unqualified">
  <xs:complexType name="PersonType">
    <xs:sequence>
      <xs:element name="firstName" type="xs:string"/>
      <xs:element name="lastName" type="xs:string"/>
    </xs:sequence>
    <xs:attribute name="id" type="xs:int" use="required"/>
  </xs:complexType>

  <xs:complexType name="EmployeeType">
    <xs:complexContent>
      <xs:extension base="tns:PersonType">
        <xs:sequence>
          <xs:element name="employeeNumber" type="xs:string"/>
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>

  <xs:element name="employee" type="tns:EmployeeType"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "employee"
        });

        var doc = XDocument.Parse(response.Xml);
        var root = doc.Root;

        Assert.NotNull(root);
        Assert.Equal("employee", root!.Name.LocalName);
        Assert.Equal("0", root.Attribute("id")?.Value);
        Assert.Equal("string", root.Element(root.Name.Namespace + "firstName")?.Value);
        Assert.Equal("string", root.Element(root.Name.Namespace + "lastName")?.Value);
        Assert.Equal("string", root.Element(root.Name.Namespace + "employeeNumber")?.Value);
    }

    [Fact]
    public void Create_UsesConcreteMembersForAbstractSubstitutionGroups()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="declaration" abstract="true"/>
  <xs:element name="instruction" abstract="true"/>
  <xs:element name="template" substitutionGroup="declaration" type="xs:string"/>
  <xs:element name="apply-templates" substitutionGroup="instruction" type="xs:string"/>
  <xs:complexType name="RootType">
    <xs:sequence>
      <xs:choice minOccurs="1" maxOccurs="unbounded">
        <xs:element ref="declaration"/>
      </xs:choice>
      <xs:choice minOccurs="1" maxOccurs="unbounded">
        <xs:element ref="instruction"/>
      </xs:choice>
    </xs:sequence>
  </xs:complexType>
  <xs:element name="root" type="RootType"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "root"
        });

        var root = XDocument.Parse(response.Xml).Root;
        Assert.NotNull(root);
        Assert.NotNull(root!.Element("template"));
        Assert.NotNull(root.Element("apply-templates"));
        Assert.Null(root.Element("declaration"));
        Assert.Null(root.Element("instruction"));
    }

    [Fact]
    public void Create_RejectsAbstractRequestedRootInsteadOfSilentlySelectingAnotherRoot()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="abstract-root" abstract="true"/>
  <xs:element name="actual-root" type="xs:string"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var exception = Assert.Throws<InvalidOperationException>(() => service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "abstract-root"
        }));

        Assert.Contains("not a concrete global element", exception.Message);
    }

    [Fact]
    public void Create_GeneratesComplexRoot_ForXsltStylesheetElement()
    {
        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = LoadXsltSchema(),
            RootElementName = "stylesheet"
        });

        var root = XDocument.Parse(response.Xml).Root;
        Assert.NotNull(root);
        Assert.Equal("http://www.w3.org/1999/XSL/Transform", root!.Name.NamespaceName);
        Assert.Equal("xsl", root.GetPrefixOfNamespace(root.Name.Namespace));
        Assert.Equal(root.Name.Namespace, root.GetNamespaceOfPrefix("xsl"));
        Assert.Null(root.Attribute("id"));
        Assert.Equal("2.0", root.Attribute("version")?.Value);
        Assert.Equal("strip", root.Attribute("default-validation")?.Value);
        Assert.Equal("unspecified", root.Attribute("input-type-annotations")?.Value);
        Assert.Empty(root.Elements());
        Assert.DoesNotContain("string", root.Value);
    }

    [Fact]
    public void Create_ResolvesSubstitutionHeadType_WhenSchemaCompilationFails()
    {
        var xsd = """
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
           targetNamespace="http://www.w3.org/1999/XSL/Transform"
           elementFormDefault="qualified">
  <xs:element name="variable" type="xs:string"/>
  <xs:element name="transform">
    <xs:complexType>
      <xs:sequence>
        <xs:choice minOccurs="0" maxOccurs="unbounded">
          <xs:element ref="xsl:variable"/>
          <xs:element ref="xsl:variable"/>
        </xs:choice>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
  <xs:element name="stylesheet" substitutionGroup="xsl:transform"/>
</xs:schema>
""";

        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = xsd,
            RootElementName = "stylesheet"
        });

        var root = XDocument.Parse(response.Xml).Root;
        Assert.NotNull(root);
        Assert.Equal("http://www.w3.org/1999/XSL/Transform", root!.Name.NamespaceName);
        Assert.Equal("xsl", root.GetPrefixOfNamespace(root.Name.Namespace));
        Assert.Equal("2.0", root.Attribute("version")?.Value);
        Assert.Equal("string", root.Attribute("id")?.Value);
        Assert.Empty(root.Elements());
        Assert.Empty(root.Value);
        Assert.Contains(response.Warnings, warning => warning.Contains("content model to become ambiguous", StringComparison.Ordinal));
    }

    [Fact]
    public void Create_DefaultsToStylesheet_ForXsltSchema()
    {
        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = LoadXsltSchema()
        });

        var root = XDocument.Parse(response.Xml).Root;
        Assert.NotNull(root);
        Assert.Equal("stylesheet", root!.Name.LocalName);
    }

    [Fact]
    public void Create_AllowsAnyConcreteGlobalElement_AsRequestedRoot()
    {
        var service = new DefaultInstanceService();
        var response = service.Create(new DefaultInstanceRequest
        {
            Schema = LoadXsltSchema(),
            RootElementName = "analyze-string"
        });

        var root = XDocument.Parse(response.Xml).Root;
        Assert.NotNull(root);
        Assert.Equal("analyze-string", root!.Name.LocalName);
    }

    private static string LoadXsltSchema() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "schema-for-xslt20.xsd"));
}
