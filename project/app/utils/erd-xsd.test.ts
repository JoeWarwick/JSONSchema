import { createErdXmlTemplate, generateErdXsd } from './erd-xsd';
import type { ErdModel } from '../types/erd';

const model: ErdModel = {
  tables: [
    {
      id: 'authors',
      name: 'Author',
      clrName: 'Author',
      sourceFile: 'AppDbContext.cs',
      columns: [
        { name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: 'Name', type: 'string', isNullable: false, isPrimaryKey: false, isForeignKey: false },
        { name: 'WebsiteUrl', type: 'string', isNullable: true, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
    {
      id: 'articles',
      name: 'Article',
      clrName: 'Article',
      sourceFile: 'AppDbContext.cs',
      columns: [
        { name: 'Id', type: 'int', isNullable: false, isPrimaryKey: true, isForeignKey: false },
        { name: 'AuthorId', type: 'int', isNullable: false, isPrimaryKey: false, isForeignKey: true },
        { name: 'Title', type: 'string', isNullable: false, isPrimaryKey: false, isForeignKey: false },
        { name: 'BodyHtml', type: 'string', isNullable: true, isPrimaryKey: false, isForeignKey: false },
        { name: 'Image', type: 'byte[]', isNullable: true, isPrimaryKey: false, isForeignKey: false },
      ],
      navigations: [],
    },
  ],
  relationships: [
    {
      id: 'author-articles',
      principalTable: 'authors',
      dependentTable: 'articles',
      foreignKeyColumns: ['AuthorId'],
      principalCardinality: 'one',
      dependentCardinality: 'many',
      principalNavigation: 'Articles',
      dependentNavigation: 'Author',
      explicit: true,
    },
  ],
  sourceFiles: [],
  diagnostics: [],
};

function schemaFor(rootTableId: string) {
  return generateErdXsd(model, rootTableId)['xs:schema'] as Record<string, unknown>;
}

function entityType(schema: Record<string, unknown>, tableId: string) {
  const types = schema['xs:complexType'] as Array<Record<string, unknown>>;
  return types.find((type) => {
    const appinfo = ((type['xs:annotation'] as Record<string, unknown>)?.['xs:appinfo'] ?? {}) as Record<string, unknown>;
    return appinfo['cms:table-id'] === tableId && appinfo['cms:reference-only'] !== 'true';
  });
}

describe('generateErdXsd', () => {
  it('creates a single-root XSD with child entities and database cardinality', () => {
    const schema = schemaFor('authors');
    const root = schema['xs:element'] as Record<string, unknown>;
    const authorType = entityType(schema, 'authors');
    const elements = ((authorType?.['xs:sequence'] as Record<string, unknown>)['xs:element']) as Array<Record<string, unknown>>;
    const articles = elements.find((element) => (element['@attributes'] as Record<string, unknown>).name === 'Articles');

    expect(root['@attributes']).toEqual({ name: 'Author', type: 'Entity_authors' });
    expect(articles?.['@attributes']).toMatchObject({
      name: 'Articles',
      minOccurs: '0',
      maxOccurs: 'unbounded',
    });
    expect((articles?.['@attributes'] as Record<string, unknown>).type).not.toBe('Entity_authors');
    expect((articles?.['xs:annotation'] as Record<string, unknown>)['xs:appinfo'])
      .toMatchObject({ 'cms:target-table-id': 'articles' });
  });

  it('preserves nullable columns and chooses markup, URL and binary editor hints', () => {
    const schema = schemaFor('authors');
    const articleType = entityType(schema, 'articles');
    const elements = ((articleType?.['xs:sequence'] as Record<string, unknown>)['xs:element']) as Array<Record<string, unknown>>;
    const byName = (name: string) => elements.find((element) => (element['@attributes'] as Record<string, unknown>).name === name)!;
    const authorType = entityType(schema, 'authors');
    const authorElements = ((authorType?.['xs:sequence'] as Record<string, unknown>)['xs:element']) as Array<Record<string, unknown>>;
    const website = authorElements.find((element) => (element['@attributes'] as Record<string, unknown>).name === 'WebsiteUrl')!;
    const authorLink = elements.find((element) => (element['@attributes'] as Record<string, unknown>).name === 'Author')!;
    const referenceTypeName = (authorLink['@attributes'] as Record<string, unknown>).type;
    const referenceType = (schema['xs:complexType'] as Array<Record<string, unknown>>)
      .find((type) => (type['@attributes'] as Record<string, unknown>).name === referenceTypeName);

    expect(byName('BodyHtml')['@attributes']).toMatchObject({ type: 'xs:string', minOccurs: '0' });
    expect((byName('BodyHtml')['xs:annotation'] as Record<string, unknown>)['xs:appinfo'])
      .toEqual({ 'ui:widget': 'html' });
    expect((website['xs:annotation'] as Record<string, unknown>)['xs:appinfo'])
      .toEqual({ 'ui:widget': 'url' });
    expect(byName('Image')['@attributes']).toMatchObject({ type: 'xs:string', minOccurs: '0' });
    expect((byName('Image')['xs:annotation'] as Record<string, unknown>)['xs:appinfo'])
      .toEqual({ 'ui:widget': 'image' });
    expect(byName('AuthorId')).toBeUndefined();
    expect((referenceType?.['xs:sequence'] as Record<string, unknown>)['xs:element'])
      .toEqual([{ '@attributes': { name: 'Id', type: 'xs:integer', minOccurs: '1' } }]);
  });

  it('requires an entity from the source ERD', () => {
    expect(() => generateErdXsd(model, 'missing')).toThrow('Select an entity that exists in the ERD');
  });

  it('creates a single-root instance template with repeating child collections', () => {
    expect(createErdXmlTemplate(model, 'authors')).toEqual({
      Author: {
        Name: { _text: '' },
        WebsiteUrl: { _text: '' },
        Articles: [],
      },
    });
  });

  it('creates key-only nested references when a relationship closes a cycle', () => {
    const oneToOneModel: ErdModel = {
      ...model,
      relationships: model.relationships.map((relationship) => ({
        ...relationship,
        dependentCardinality: 'one',
      })),
    };

    expect(createErdXmlTemplate(oneToOneModel, 'authors')).toEqual({
      Author: {
        Name: { _text: '' },
        WebsiteUrl: { _text: '' },
        Articles: {
          Title: { _text: '' },
          BodyHtml: { _text: '' },
          Image: { _text: '' },
          Author: { Id: { _text: '' } },
        },
      },
    });
  });
});
