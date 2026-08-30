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
            XmlResolver = null,
            ConformanceLevel = ConformanceLevel.Document,
            ValidationFlags = XmlSchemaValidationFlags.None
        };

        var schemaSet = new XmlSchemaSet
        {
            XmlResolver = null
        };

        XmlSchema? parsedSchema = null;

        try
        {
            using (var stringReader = new StringReader(request.Schema))
            using (var xmlReader = XmlReader.Create(stringReader, readerSettings))
            {
                parsedSchema = XmlSchema.Read(xmlReader, (_, args) =>
                {
                    if (!string.IsNullOrWhiteSpace(args.Message))
                    {
                        warnings.Add($"Schema validation warning: {args.Message}");
                    }
                });
            }

            if (parsedSchema is null)
            {
                throw new InvalidOperationException("The schema could not be parsed as an XML Schema document.");
            }

            schemaSet.Add(parsedSchema);

            schemaSet.Compile();
        }
        catch (XmlSchemaException ex)
        {
            warnings.Add($"Schema validation warning: {ex.Message}");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Failed to parse schema", ex);
        }

        var schema = parsedSchema ?? schemaSet.Schemas().OfType<XmlSchema>().FirstOrDefault();
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
            WriteElement(xmlWriter, rootElement, schema.TargetNamespace, rootElement.IsNillable, schema, new HashSet<string>(StringComparer.Ordinal));
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
            elements = schema.Items.OfType<XmlSchemaElement>().ToArray();
        }

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

    private static void WriteElement(
        XmlWriter writer,
        XmlSchemaElement element,
        string? defaultNamespace,
        bool suppressNamespaceDeclaration,
        XmlSchema schema,
        HashSet<string> visitedTypeNames)
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

        if (TryResolveComplexType(element, schema) is XmlSchemaComplexType complexType)
        {
            WriteComplexType(writer, complexType, schema, visitedTypeNames);
        }
        else
        {
            var placeholder = element.DefaultValue ?? element.FixedValue ?? GetElementPlaceholderValue(element, schema);
            writer.WriteString(placeholder);
        }

        writer.WriteEndElement();
    }

    private static XmlSchemaComplexType? TryResolveComplexType(XmlSchemaElement element, XmlSchema schema)
    {
        if (element.SchemaType is XmlSchemaComplexType inlineComplexType)
        {
            return inlineComplexType;
        }

        var typeName = element.SchemaTypeName;
        if (!typeName.IsEmpty)
        {
            var localTypeName = typeName.Name;
            if (!string.IsNullOrWhiteSpace(localTypeName))
            {
                var declared = schema.Items
                    .OfType<XmlSchemaComplexType>()
                    .FirstOrDefault(item => string.Equals(item.Name, localTypeName, StringComparison.Ordinal));
                if (declared is not null)
                {
                    return declared;
                }
            }
        }

        if (element.ElementSchemaType is XmlSchemaComplexType resolved && resolved.Datatype is null)
        {
            return resolved;
        }

        return element.ElementSchemaType as XmlSchemaComplexType;
    }

    private static void WriteComplexType(
        XmlWriter writer,
        XmlSchemaComplexType complexType,
        XmlSchema schema,
        HashSet<string> visitedTypeNames)
    {
        var typeName = complexType.Name ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(typeName) && !visitedTypeNames.Add(typeName))
        {
            return;
        }

        var writtenAttributeNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (XmlSchemaAttribute attribute in EnumerateDeclaredAttributes(complexType))
        {
            var attributeName = attribute.Name;
            if (string.IsNullOrWhiteSpace(attributeName) && !attribute.RefName.IsEmpty)
            {
                attributeName = attribute.RefName.Name;
            }

            if (string.IsNullOrWhiteSpace(attributeName) || !writtenAttributeNames.Add(attributeName))
            {
                continue;
            }

            var attributeValue = attribute.DefaultValue ?? attribute.FixedValue ?? GetAttributePlaceholderValue(attribute, schema);
            writer.WriteAttributeString(attributeName, attributeValue);
        }

        var contentModel = complexType.ContentModel;
        if (contentModel is XmlSchemaComplexContent complexContent &&
            complexContent.Content is XmlSchemaComplexContentExtension extension)
        {
            var baseTypeName = extension.BaseTypeName.Name;
            if (!string.IsNullOrWhiteSpace(baseTypeName))
            {
                var baseComplexType = schema.Items
                    .OfType<XmlSchemaComplexType>()
                    .FirstOrDefault(item => string.Equals(item.Name, baseTypeName, StringComparison.Ordinal));
                if (baseComplexType is not null)
                {
                    WriteComplexType(writer, baseComplexType, schema, visitedTypeNames);
                }
            }

            if (extension.Particle is XmlSchemaParticle extensionParticle)
            {
                WriteParticle(writer, extensionParticle, schema, visitedTypeNames);
            }

            if (!string.IsNullOrWhiteSpace(typeName))
            {
                visitedTypeNames.Remove(typeName);
            }

            return;
        }

        if (contentModel is XmlSchemaSimpleContent simpleContent &&
            simpleContent.Content is XmlSchemaSimpleContentExtension simpleExtension)
        {
            var simplePlaceholder = GetPlaceholderValueFromTypeName(simpleExtension.BaseTypeName.Name, schema);
            writer.WriteString(simplePlaceholder);

            if (!string.IsNullOrWhiteSpace(typeName))
            {
                visitedTypeNames.Remove(typeName);
            }

            return;
        }

        var particle = complexType.ContentTypeParticle;
        if (particle is not null)
        {
            WriteParticle(writer, particle, schema, visitedTypeNames);
        }
        else if (complexType.Particle is XmlSchemaParticle declaredParticle)
        {
            WriteParticle(writer, declaredParticle, schema, visitedTypeNames);
        }

        if (!string.IsNullOrWhiteSpace(typeName))
        {
            visitedTypeNames.Remove(typeName);
        }
    }

    private static IEnumerable<XmlSchemaAttribute> EnumerateDeclaredAttributes(XmlSchemaComplexType complexType)
    {
        foreach (var item in complexType.Attributes.OfType<XmlSchemaAttribute>())
        {
            yield return item;
        }

        if (complexType.ContentModel is XmlSchemaComplexContent complexContent &&
            complexContent.Content is XmlSchemaComplexContentExtension extension)
        {
            foreach (var item in extension.Attributes.OfType<XmlSchemaAttribute>())
            {
                yield return item;
            }
        }

        if (complexType.ContentModel is XmlSchemaSimpleContent simpleContent &&
            simpleContent.Content is XmlSchemaSimpleContentExtension simpleExtension)
        {
            foreach (var item in simpleExtension.Attributes.OfType<XmlSchemaAttribute>())
            {
                yield return item;
            }
        }
    }

    private static string GetElementPlaceholderValue(XmlSchemaElement element, XmlSchema schema)
    {
        if (!element.SchemaTypeName.IsEmpty)
        {
            var byName = GetPlaceholderValueFromTypeName(element.SchemaTypeName.Name, schema);
            if (!string.Equals(byName, "string", StringComparison.Ordinal))
            {
                return byName;
            }
        }

        return GetPlaceholderValue(element.ElementSchemaType);
    }

    private static string GetAttributePlaceholderValue(XmlSchemaAttribute attribute, XmlSchema schema)
    {
        if (!attribute.SchemaTypeName.IsEmpty)
        {
            var byName = GetPlaceholderValueFromTypeName(attribute.SchemaTypeName.Name, schema);
            if (!string.Equals(byName, "string", StringComparison.Ordinal))
            {
                return byName;
            }
        }

        return GetPlaceholderValue(attribute.AttributeSchemaType);
    }

    private static string GetPlaceholderValueFromTypeName(string? typeName, XmlSchema schema)
    {
        if (string.IsNullOrWhiteSpace(typeName))
        {
            return "string";
        }

        var localName = typeName.Contains(':', StringComparison.Ordinal)
            ? typeName[(typeName.IndexOf(':', StringComparison.Ordinal) + 1)..]
            : typeName;

        var builtIn = localName switch
        {
            "boolean" => "true",
            "byte" or "unsignedByte" or "short" or "unsignedShort" or "int" or "unsignedInt" or "long" or "unsignedLong" => "0",
            "decimal" or "double" or "float" => "0",
            "date" => "2026-07-22",
            "dateTime" => "2026-07-22T00:00:00Z",
            "time" => "00:00:00",
            _ => "string"
        };

        if (!string.Equals(builtIn, "string", StringComparison.Ordinal) ||
            localName.StartsWith("string", StringComparison.OrdinalIgnoreCase))
        {
            return builtIn;
        }

        return ResolveSimpleTypePlaceholder(localName, schema, new HashSet<string>(StringComparer.Ordinal));
    }

    private static string ResolveSimpleTypePlaceholder(string localTypeName, XmlSchema schema, HashSet<string> visitedSimpleTypes)
    {
        if (string.IsNullOrWhiteSpace(localTypeName) || !visitedSimpleTypes.Add(localTypeName))
        {
            return "string";
        }

        var simpleType = schema.Items
            .OfType<XmlSchemaSimpleType>()
            .FirstOrDefault(item => string.Equals(item.Name, localTypeName, StringComparison.Ordinal));

        if (simpleType?.Content is XmlSchemaSimpleTypeRestriction restriction)
        {
            return GetPlaceholderValueFromTypeName(restriction.BaseTypeName.Name, schema);
        }

        if (simpleType?.Content is XmlSchemaSimpleTypeList list)
        {
            var itemTypeName = list.ItemTypeName.Name;
            return GetPlaceholderValueFromTypeName(itemTypeName, schema);
        }

        if (simpleType?.Content is XmlSchemaSimpleTypeUnion union)
        {
            var baseMemberTypes = union.BaseMemberTypes;
            var firstMember = baseMemberTypes is null
                ? null
                : baseMemberTypes.OfType<XmlSchemaSimpleType>().FirstOrDefault();

            if (firstMember?.QualifiedName.Name is { Length: > 0 } firstName)
            {
                return GetPlaceholderValueFromTypeName(firstName, schema);
            }

            if (union.MemberTypes is { Length: > 0 })
            {
                return GetPlaceholderValueFromTypeName(union.MemberTypes[0].Name, schema);
            }
        }

        return "string";
    }

    private static void WriteParticle(
        XmlWriter writer,
        XmlSchemaParticle particle,
        XmlSchema schema,
        HashSet<string> visitedTypeNames)
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
                    WriteNestedElement(writer, element, schema, visitedTypeNames);
                }
                break;

            case XmlSchemaSequence sequence:
                foreach (XmlSchemaObject item in sequence.Items)
                {
                    if (item is XmlSchemaElement nestedElement)
                    {
                        WriteNestedElement(writer, nestedElement, schema, visitedTypeNames);
                    }
                    else if (item is XmlSchemaChoice choice)
                    {
                        var firstChoice = choice.Items.OfType<XmlSchemaElement>().FirstOrDefault();
                        if (firstChoice is not null)
                        {
                            WriteNestedElement(writer, firstChoice, schema, visitedTypeNames);
                        }
                    }
                    else if (item is XmlSchemaSequence nestedSequence)
                    {
                        WriteParticle(writer, nestedSequence, schema, visitedTypeNames);
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
                        WriteNestedElement(writer, nestedElement, schema, visitedTypeNames);
                    }
                }
                break;

            case XmlSchemaChoice choice:
                var firstElement = choice.Items.OfType<XmlSchemaElement>().FirstOrDefault();
                if (firstElement is not null)
                {
                    WriteNestedElement(writer, firstElement, schema, visitedTypeNames);
                }
                break;
        }
    }

    private static void WriteNestedElement(
        XmlWriter writer,
        XmlSchemaElement nestedElement,
        XmlSchema schema,
        HashSet<string> visitedTypeNames)
    {
        var localName = nestedElement.QualifiedName.IsEmpty
            ? (nestedElement.RefName.IsEmpty ? nestedElement.Name : nestedElement.RefName.Name)
            : nestedElement.QualifiedName.Name;
        var namespaceUri = nestedElement.QualifiedName.Namespace ?? string.Empty;

        writer.WriteStartElement(string.Empty, localName ?? "item", namespaceUri);

        if (TryResolveComplexType(nestedElement, schema) is XmlSchemaComplexType nestedComplexType)
        {
            WriteComplexType(writer, nestedComplexType, schema, visitedTypeNames);
        }
        else
        {
            var placeholder = nestedElement.DefaultValue ?? nestedElement.FixedValue ?? GetElementPlaceholderValue(nestedElement, schema);
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
