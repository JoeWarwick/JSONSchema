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
    <xs:attribute name="id" type="xs:int"/>
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
}
