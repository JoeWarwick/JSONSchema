using System.Xml;
using System.Xml.Linq;
using System.Xml.Xsl;
using SchemaService.Models;
using SchemaService.Services;
using Xunit;

namespace SchemaService.Tests;

public sealed class TransformWorkerTests
{
    private static string Stylesheet(string body) =>
        $"""<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="xml"/><xsl:template match="/">{body}</xsl:template></xsl:stylesheet>""";

    [Fact]
    public void Execute_TransformsRepeatedNamespacedValuesAndAttributes()
    {
        var request = new TransformRequest
        {
            Input = """<s:orders xmlns:s="urn:source"><s:order id="7"><s:name>Alice</s:name></s:order><s:order id="8"><s:name>Bob</s:name></s:order></s:orders>""",
            Stylesheet = Stylesheet("""
<xsl:element name="invoices" namespace="urn:target">
  <xsl:for-each select="/*[local-name()='orders' and namespace-uri()='urn:source']/*[local-name()='order' and namespace-uri()='urn:source']">
    <xsl:element name="invoice" namespace="urn:target">
      <xsl:attribute name="code"><xsl:value-of select="@id"/></xsl:attribute>
      <xsl:element name="customer" namespace="urn:target"><xsl:value-of select="*[local-name()='name' and namespace-uri()='urn:source']"/></xsl:element>
    </xsl:element>
  </xsl:for-each>
</xsl:element>
""")
        };
        var doc = XDocument.Parse(TransformWorker.Execute(request));
        XNamespace ns = "urn:target";
        var invoices = doc.Root!.Elements(ns + "invoice").ToArray();
        Assert.Equal(2, invoices.Length);
        Assert.Equal("7", invoices[0].Attribute("code")!.Value);
        Assert.Equal("Alice", invoices[0].Element(ns + "customer")!.Value);
        Assert.Equal("Bob", invoices[1].Element(ns + "customer")!.Value);
    }

    [Fact]
    public void Execute_ProhibitsDtd()
    {
        var request = new TransformRequest
        {
            Input = """<!DOCTYPE root [<!ENTITY sample "blocked">]><root>&sample;</root>""",
            Stylesheet = Stylesheet("<result/>")
        };
        Assert.Throws<XmlException>(() => TransformWorker.Execute(request));
    }

    [Fact]
    public void Execute_DisablesDocumentFunction()
    {
        var request = new TransformRequest
        {
            Input = "<root/>",
            Stylesheet = Stylesheet("""<result><xsl:value-of select="document('file:///not-accessible.xml')"/></result>""")
        };
        Assert.ThrowsAny<XsltException>(() => TransformWorker.Execute(request));
    }

    [Fact]
    public void Execute_BlocksExternalImports()
    {
        var request = new TransformRequest
        {
            Input = "<root/>",
            Stylesheet = """<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:import href="file:///not-accessible.xsl"/></xsl:stylesheet>"""
        };
        Assert.ThrowsAny<XsltException>(() => TransformWorker.Execute(request));
    }

    [Fact]
    public void Execute_LimitsOutput()
    {
        var request = new TransformRequest
        {
            Input = "<root>" + string.Concat(Enumerable.Repeat("<item>" + new string('a', 1000) + "</item>", 600)) + "</root>",
            Stylesheet = Stylesheet("""<result><xsl:for-each select="/root/item"><xsl:value-of select="."/><xsl:value-of select="."/></xsl:for-each></result>""")
        };
        var error = Assert.Throws<InvalidOperationException>(() => TransformWorker.Execute(request));
        Assert.Contains("1,000,000 character preview limit", error.Message);
    }

    [Fact]
    public void Execute_LimitsInput()
    {
        Assert.Throws<ArgumentException>(() => TransformWorker.Execute(new TransformRequest
        {
            Input = new string('a', TransformWorker.MaxCharacters + 1),
            Stylesheet = Stylesheet("<result/>")
        }));
    }
}
