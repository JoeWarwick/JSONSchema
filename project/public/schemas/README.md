# Bundled schemas

Downloaded schemas retain their upstream content and license notices.

| File | Source | Notes |
| --- | --- | --- |
| `openapi-3.1.schema.json` | <https://spec.openapis.org/oas/3.1/schema/2025-09-15> | OpenAPI 3.1.x document structure, using JSON Schema 2020-12. As stated upstream, this schema does **not** validate embedded Schema Objects. |
| `schema-for-xslt10.xsd` | Application-maintained; [XSLT 1.0 Recommendation](https://www.w3.org/TR/xslt-10/) and [W3C-hosted unofficial DTD](https://www.w3.org/1999/11/xslt10.dtd) used as vocabulary references | Independently authored offline XSD 1.0 for authoring/forms, not an official W3C schema or a complete stylesheet validator. |
| `schema-for-xslt20.xsd` | <https://www.w3.org/2007/schema-for-xslt20.xsd> | Existing W3C XSLT 2.0 schema, left unchanged. W3C software license is included in its documentation. |
| `schema-for-xslt30.xsd` | <https://www.w3.org/TR/xslt-30/schema-for-xslt30.xsd> | W3C XSLT 3.0 schema. Not an XSLT 1.0 processor or a complete offline schema bundle: it imports the XML Schema 1.1 schema at `http://www.w3.org/TR/xmlschema11-1/XMLSchema.xsd`. |
| `xsl-fo-fop.xsd` | [Apache FOP, pinned revision](https://raw.githubusercontent.com/apache/xmlgraphics-fop/61552a1f108a32b369a9275a368225b8abee2730/fop/src/foschema/fop.xsd) | Apache FOP's XSL-FO schema, **not** an official W3C XSL-FO 1.1 schema or full coverage of 1.1. In particular it lacks `flow-map` and `page-sequence-wrapper`. |

The [XSL 1.1 Recommendation](https://www.w3.org/TR/xsl11/) describes XSL
Formatting Objects (XSL-FO), not XSL Transformations (XSLT), and does not link a
downloadable XSD. The FOP schema is supplied as an explicitly identified practical
alternative. Its Apache 2.0 license and attribution are preserved in
`xsl-fo-fop.LICENSE.txt` and `xsl-fo-fop.NOTICE.txt`.

## XSLT 1.0 authoring

Open `schema-for-xslt10.xsd` as a schema in an XML workbench to use the existing
schema and instance-form tools. It declares all 35 XSLT 1.0 elements, including
both root names (`stylesheet` and `transform`), named modes, parameters, sorting,
and attribute sets. Instructions include descriptions; literal-valued yes/no and
number-level attributes have enumerations. Attributes that allow attribute value
templates remain strings so expressions such as `order="{$direction}"` are valid.
The schema has no imports, includes, or network dependencies.

This is a structural authoring aid, not a replacement for stylesheet compilation:

- Literal-result elements (including elements without a namespace) and extension
  elements are accepted through skipped wildcards. Their entire subtrees,
  including any nested XSLT instructions, are **not** schema-validated.
- Foreign top-level metadata is accepted. Imports must precede other declarations.
- XPath 1.0 expressions, match patterns, attribute value templates, prefix-list
  bindings, named-template references, and context-dependent rules need processor
  checks. For example, XSD 1.0 does not enforce `match` or `name` on a template,
  mutual exclusion of `select` and a binding body, text-only result construction
  inside attributes/comments, or parameters/sorts preceding non-whitespace text.
- Simplified stylesheets with a literal-result root are not validated by this XSD.
  Use an explicit `xsl:stylesheet` or `xsl:transform` root for schema-based tools.
- The authoring profile requires root `version="1.0"` and rejects later XSLT
  instructions/attributes in checked content. It does not implement XSLT
  forward-compatible processing. Wildcard subtrees remain unchecked.
- The schema accepts standard import/include declarations, but the Transform
  preview's security restrictions still control module and external-resource access.

The Transform preview remains an XSLT 1.0 processor; bundling the 2.0/3.0 schemas
does not enable those runtime versions. Use the preview/compiler to check actual
stylesheet semantics as well as this authoring schema's structural checks.
