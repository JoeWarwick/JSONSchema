using System.Text;
using System.Xml;
using System.Xml.Schema;
using SchemaService.Models;

namespace SchemaService.Services;

public sealed class DefaultInstanceService
{
    public DefaultInstanceResponse Create(DefaultInstanceRequest request)
    {
        var warnings = new List<string>();
        var readerSettings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null
        };

        var schemaSet = new XmlSchemaSet
        {
            XmlResolver = null
        };

        using (var stringReader = new StringReader(request.Schema))
        using (var xmlReader = XmlReader.Create(stringReader, readerSettings))
        {
            schemaSet.Add(null, xmlReader);
        }

        schemaSet.Compile();

        var schema = schemaSet.Schemas().OfType<XmlSchema>().FirstOrDefault();
        if (schema is null)
        {
            throw new InvalidOperationException("The schema did not contain any XML Schema document.");
        }

        var rootElement = FindRootElement(schema, request.RootElementName);
        if (rootElement is null)
        {
            throw new InvalidOperationException("The schema did not contain a usable root element.");
        }

        var builder = new StringBuilder();
        var xmlSettings = new XmlWriterSettings
        {
            OmitXmlDeclaration = false,
            Indent = true,
            Encoding = Encoding.UTF8,
            NamespaceHandling = NamespaceHandling.OmitDuplicates
        };

        using var stringWriter = new StringWriter(builder);
        using (var xmlWriter = XmlWriter.Create(stringWriter, xmlSettings))
        {
            WriteElement(xmlWriter, rootElement, schema.TargetNamespace, rootElement.IsNillable);
        }

        return new DefaultInstanceResponse
        {
            Xml = builder.ToString(),
            Warnings = warnings.ToArray()
        };
    }

    private static XmlSchemaElement? FindRootElement(XmlSchema schema, string? preferredRootName)
    {
        var elements = schema.Elements.Values.OfType<XmlSchemaElement>().ToArray();
        if (elements.Length == 0)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(preferredRootName))
        {
            var preferred = elements.FirstOrDefault(element => string.Equals(element.Name, preferredRootName, StringComparison.Ordinal));
            if (preferred is not null)
            {
                return preferred;
            }
        }

        return elements[0];
    }

    private static void WriteElement(XmlWriter writer, XmlSchemaElement element, string? defaultNamespace, bool suppressNamespaceDeclaration)
    {
        var localName = element.QualifiedName.IsEmpty ? element.Name : element.QualifiedName.Name;
        var namespaceUri = string.IsNullOrWhiteSpace(element.QualifiedName.Namespace)
            ? defaultNamespace ?? string.Empty
            : element.QualifiedName.Namespace;

        writer.WriteStartElement(string.Empty, localName ?? "root", namespaceUri);
        if (!suppressNamespaceDeclaration && !string.IsNullOrWhiteSpace(namespaceUri))
        {
            writer.WriteAttributeString("xmlns", namespaceUri);
        }

        if (element.ElementSchemaType is XmlSchemaComplexType complexType)
        {
            WriteComplexType(writer, complexType);
        }
        else
        {
            writer.WriteString(GetPlaceholderValue(element.ElementSchemaType));
        }

        writer.WriteEndElement();
    }

    private static void WriteComplexType(XmlWriter writer, XmlSchemaComplexType complexType)
    {
        foreach (XmlSchemaAttribute attribute in complexType.AttributeUses.Values.OfType<XmlSchemaAttribute>())
        {
            if (string.IsNullOrWhiteSpace(attribute.Name))
            {
                continue;
            }

            var attributeValue = attribute.DefaultValue ?? attribute.FixedValue ?? GetPlaceholderValue(attribute.AttributeSchemaType);
            writer.WriteAttributeString(attribute.Name, attributeValue);
        }

        var particle = complexType.ContentTypeParticle;
        if (particle is null)
        {
            return;
        }

        WriteParticle(writer, particle);
    }

    private static void WriteParticle(XmlWriter writer, XmlSchemaParticle particle)
    {
        switch (particle)
        {
            case XmlSchemaElement element:
                var occurrenceCount = element.MinOccurs > 0 ? 1 : 0;
                if (occurrenceCount == 0 && element.MaxOccurs > 0)
                {
                    occurrenceCount = 1;
                }

                for (var index = 0; index < occurrenceCount; index++)
                {
                    WriteNestedElement(writer, element);
                }
                break;

            case XmlSchemaSequence sequence:
                foreach (XmlSchemaObject item in sequence.Items)
                {
                    if (item is XmlSchemaElement nestedElement)
                    {
                        WriteNestedElement(writer, nestedElement);
                    }
                    else if (item is XmlSchemaChoice choice)
                    {
                        var firstChoice = choice.Items.OfType<XmlSchemaElement>().FirstOrDefault();
                        if (firstChoice is not null)
                        {
                            WriteNestedElement(writer, firstChoice);
                        }
                    }
                    else if (item is XmlSchemaAny)
                    {
                        writer.WriteElementString("any", "");
                    }
                }
                break;

            case XmlSchemaAll all:
                foreach (XmlSchemaObject item in all.Items)
                {
                    if (item is XmlSchemaElement nestedElement)
                    {
                        WriteNestedElement(writer, nestedElement);
                    }
                }
                break;

            case XmlSchemaChoice choice:
                var firstElement = choice.Items.OfType<XmlSchemaElement>().FirstOrDefault();
                if (firstElement is not null)
                {
                    WriteNestedElement(writer, firstElement);
                }
                break;
        }
    }

    private static void WriteNestedElement(XmlWriter writer, XmlSchemaElement nestedElement)
    {
        var localName = nestedElement.QualifiedName.IsEmpty ? nestedElement.Name : nestedElement.QualifiedName.Name;
        var namespaceUri = nestedElement.QualifiedName.Namespace ?? string.Empty;

        writer.WriteStartElement(string.Empty, localName ?? "item", namespaceUri);

        if (nestedElement.ElementSchemaType is XmlSchemaComplexType nestedComplexType)
        {
            WriteComplexType(writer, nestedComplexType);
        }
        else
        {
            var placeholder = nestedElement.DefaultValue ?? nestedElement.FixedValue ?? GetPlaceholderValue(nestedElement.ElementSchemaType);
            writer.WriteString(placeholder);
        }

        writer.WriteEndElement();
    }

    private static string GetPlaceholderValue(XmlSchemaType? schemaType)
    {
        var xmlTypeCode = schemaType?.Datatype?.TypeCode ?? XmlTypeCode.String;
        return xmlTypeCode switch
        {
            XmlTypeCode.Boolean => "true",
            XmlTypeCode.Byte or XmlTypeCode.UnsignedByte or XmlTypeCode.Short or XmlTypeCode.UnsignedShort or XmlTypeCode.Int or XmlTypeCode.UnsignedInt or XmlTypeCode.Long or XmlTypeCode.UnsignedLong => "0",
            XmlTypeCode.Decimal or XmlTypeCode.Double or XmlTypeCode.Float => "0",
            XmlTypeCode.Date => "2026-07-22",
            XmlTypeCode.DateTime => "2026-07-22T00:00:00Z",
            XmlTypeCode.Time => "00:00:00",
            _ => "string"
        };
    }
}
