import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TooltipProvider } from './ui/tooltip/tooltip';
import { XmlInstanceForm } from './xml-instance-form';
import { parseMarkup } from '../utils/markup';

function renderForm(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('XmlInstanceForm trigger-row behavior', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('derives schema form root add buttons from the XSD walk', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:group name="schemaTop">
          <xs:choice>
            <xs:element ref="xs:element"/>
            <xs:element ref="xs:attribute"/>
            <xs:element ref="xs:notation"/>
          </xs:choice>
        </xs:group>
        <xs:group name="redefinable">
          <xs:choice>
            <xs:element ref="xs:simpleType"/>
            <xs:element ref="xs:complexType"/>
            <xs:element ref="xs:attributeGroup"/>
          </xs:choice>
        </xs:group>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={xmlSchema}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add Element/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add ComplexType/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add SimpleType/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add Group/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add Notation/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add AttributeGroup/i })).toHaveLength(1);
    });
  });

  test('infers child add triggers at nested schema depth, not just the root', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="person" type="PersonType"/>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="firstName" type="xs:string"/>
            <xs:element name="lastName" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={{ person: {} }}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-nested-trigger"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add firstName/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add lastName/i })).toHaveLength(1);
    });
  });

  test('keeps nested xs:choice options visible when choice is inside xs:sequence', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="person" type="PersonType"/>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="firstName" type="xs:string"/>
            <xs:element name="lastName" type="xs:string"/>
            <xs:choice minOccurs="0">
              <xs:element name="homeEmail" type="xs:string"/>
              <xs:element name="workEmail" type="xs:string"/>
            </xs:choice>
            <xs:element name="address" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={{ person: {} }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add homeEmail/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add workEmail/i })).toHaveLength(1);
    });
  });

  test('infers an xs:element add trigger on xs:sequence compositor nodes', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="person" type="PersonType"/>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="firstName" type="xs:string"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={xmlSchema}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add xs:element/i })).toHaveLength(1);
    });
  });

  test('infers an xs:attribute add trigger for xs:complexType when allowed by the walked schema', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:complexType name="complexType">
          <xs:sequence>
            <xs:element ref="xs:attribute" minOccurs="0" maxOccurs="unbounded"/>
          </xs:sequence>
        </xs:complexType>
        <xs:element name="holder" type="complexType"/>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={{ holder: {} }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add xs:attribute/i })).toHaveLength(1);
    });
  });

  test('infers complexType model branch triggers from mixed choice/sequence grammar', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:group name="typeDefParticle">
          <xs:choice>
            <xs:element ref="xs:all"/>
            <xs:element ref="xs:choice"/>
            <xs:element ref="xs:sequence"/>
          </xs:choice>
        </xs:group>
        <xs:group name="attrDecls">
          <xs:sequence>
            <xs:choice>
              <xs:element ref="xs:attribute"/>
              <xs:element ref="xs:attributeGroup"/>
            </xs:choice>
          </xs:sequence>
        </xs:group>
        <xs:group name="complexTypeModel">
          <xs:choice>
            <xs:element ref="xs:simpleContent"/>
            <xs:element ref="xs:complexContent"/>
            <xs:sequence>
              <xs:group ref="xs:typeDefParticle" minOccurs="0"/>
              <xs:group ref="xs:attrDecls"/>
            </xs:sequence>
          </xs:choice>
        </xs:group>
        <xs:complexType name="localComplexType">
          <xs:sequence>
            <xs:group ref="xs:complexTypeModel"/>
          </xs:sequence>
        </xs:complexType>
        <xs:element name="holder" type="localComplexType"/>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={{ holder: {} }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add xs:simpleContent/i })).toHaveLength(1);
      expect(screen.getByRole('option', { name: /xs:complexContent/i })).toBeTruthy();
      expect(screen.getByRole('option', { name: /xs:attribute\s*:/i })).toBeTruthy();
      expect(screen.getByRole('option', { name: /xs:all/i })).toBeTruthy();
      expect(screen.getByRole('option', { name: /xs:choice/i })).toBeTruthy();
      expect(screen.getByRole('option', { name: /xs:sequence/i })).toBeTruthy();
    });
  });

  test('infers xs:enumeration add triggers and remove controls for restriction facets', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:simpleType name="ColorType">
          <xs:restriction base="xs:string">
            <xs:enumeration value="red"/>
            <xs:enumeration value="green"/>
          </xs:restriction>
        </xs:simpleType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={xmlSchema}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add xs:enumeration/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Remove value/i })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /Remove base/i })).toHaveLength(1);
    });
  });

  test('renders a color picker when xs:element declares ui:widget color', async () => {
    const onChange = jest.fn();
    const schemaWithColorWidget = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          'xmlns:ui': 'urn:schemasculptor:ui',
        },
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:sequence': {
            'xs:element': [
              {
                '@attributes': {
                  name: 'favoriteColor',
                  type: 'xs:string',
                  'ui:widget': 'color',
                },
              },
            ],
          },
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaWithColorWidget}
        rootSchema={schemaWithColorWidget}
        value={{ person: { favoriteColor: { _text: '#ff0000' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement | null;
      expect(colorInput).not.toBeNull();
      expect(colorInput?.value.toLowerCase()).toBe('#ff0000');
    });
  });

  test('renders a color picker for xs:attribute when ui:widget is color', async () => {
    const onChange = jest.fn();
    const schemaWithAttributeColorWidget = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          'xmlns:ui': 'urn:schemasculptor:ui',
        },
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:attribute': [
            {
              '@attributes': {
                name: 'favoriteColor',
                type: 'xs:string',
                use: 'optional',
                'ui:widget': 'color',
              },
            },
          ],
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaWithAttributeColorWidget}
        rootSchema={schemaWithAttributeColorWidget}
        value={{ person: { '@attributes': { favoriteColor: '#00ff00' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      const colorInput = screen.getByTestId('xml-attr-person-favoriteColor') as HTMLInputElement;
      expect(colorInput).toBeTruthy();
      expect(colorInput.type).toBe('color');
      expect(colorInput.value.toLowerCase()).toBe('#00ff00');
    });
  });

  test('renders a typeable country select when ui:widget is country', async () => {
    const onChange = jest.fn();
    const schemaWithCountryWidget = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          'xmlns:ui': 'urn:schemasculptor:ui',
        },
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:attribute': [
            {
              '@attributes': {
                name: 'country',
                type: 'xs:string',
                use: 'optional',
                'ui:widget': 'country',
              },
            },
          ],
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaWithCountryWidget}
        rootSchema={schemaWithCountryWidget}
        value={{ person: { '@attributes': { country: 'Canada' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      const countryInput = screen.getByTestId('xml-attr-person-country') as HTMLInputElement;
      expect(countryInput).toBeTruthy();
      expect(countryInput.type).toBe('text');
      expect(countryInput.value).toBe('Canada');
      expect(document.querySelector('datalist')).not.toBeNull();
    });
  });

  test('renders a typeable language tag select when ui:widget is lang', async () => {
    const onChange = jest.fn();
    const schemaWithLangWidget = {
      'xs:schema': {
        '@attributes': {
          'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
          'xmlns:ui': 'urn:schemasculptor:ui',
        },
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:attribute': [
            {
              '@attributes': {
                name: 'languageCode',
                type: 'xs:string',
                use: 'optional',
                'ui:widget': 'lang',
              },
            },
          ],
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaWithLangWidget}
        rootSchema={schemaWithLangWidget}
        value={{ person: { '@attributes': { languageCode: 'en-US' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    await waitFor(() => {
      const languageInput = screen.getByTestId('xml-attr-person-languageCode') as HTMLInputElement;
      expect(languageInput).toBeTruthy();
      expect(languageInput.type).toBe('text');
      expect(languageInput.value).toBe('en-US');
      expect(document.querySelector('datalist')).not.toBeNull();
    });
  });

  test('restores persisted expanded paths across rerenders', () => {
    const onChange = jest.fn();
    const value = {
      person: {
        address: {
          city: {
            _text: 'Paris',
          },
        },
      },
    };

    const payload = JSON.stringify(value ?? {});
    let hash = 0;
    for (let i = 0; i < payload.length; i += 1) {
      hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
    }
    const storageKey = `xml-instance-form-expanded::${hash}`;
    window.localStorage.setItem(storageKey, JSON.stringify(['person', 'person.address']));

    const { rerender } = renderForm(
      <XmlInstanceForm
        schema={value}
        rootSchema={value}
        value={value}
        onChange={onChange}
      />,
    );

    expect(JSON.parse(window.localStorage.getItem(storageKey) || '[]')).toEqual(
      expect.arrayContaining(['person', 'person.address'])
    );

    rerender(
      <TooltipProvider delayDuration={0}>
        <XmlInstanceForm
          schema={value}
          rootSchema={value}
          value={value}
          onChange={onChange}
        />
      </TooltipProvider>
    );

    expect(JSON.parse(window.localStorage.getItem(storageKey) || '[]')).toEqual(
      expect.arrayContaining(['person', 'person.address'])
    );
  });

  const schema = {
    'xs:schema': {
      'xs:element': {
        '@attributes': {
          name: 'person',
          type: 'PersonType',
        },
      },
      'xs:complexType': {
        '@attributes': {
          name: 'PersonType',
        },
        'xs:sequence': {
          'xs:element': [
            {
              '@attributes': {
                name: 'nickname',
                type: 'xs:string',
                minOccurs: '0',
                maxOccurs: '2',
              },
            },
            {
              '@attributes': {
                name: 'id',
                type: 'xs:string',
                minOccurs: '1',
                maxOccurs: '1',
              },
            },
          ],
        },
        'xs:attribute': [
          {
            '@attributes': {
              name: 'alias',
              type: 'xs:string',
              use: 'optional',
            },
          },
          {
            '@attributes': {
              name: 'status',
              type: 'xs:string',
              use: 'required',
            },
          },
        ],
      },
    },
  } as any;

  test('renders trigger chips and disables add at maxOccurs', () => {
    const onChange = jest.fn();
    const initial = renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: { id: { _text: 'A1' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const nicknameAdd = screen.getByRole('button', { name: /Add nickname/i });
    expect(nicknameAdd).toBeTruthy();
    expect(nicknameAdd.hasAttribute('disabled')).toBe(false);

    fireEvent.click(nicknameAdd);
    const first = onChange.mock.calls[0][0];
    expect(first.person.nickname).toBeTruthy();

    initial.unmount();

    const maxOneSchema = JSON.parse(JSON.stringify(schema));
    maxOneSchema['xs:schema']['xs:complexType']['xs:sequence']['xs:element'][0]['@attributes'].maxOccurs = '1';

    renderForm(
      <XmlInstanceForm
        schema={maxOneSchema}
        rootSchema={maxOneSchema}
        value={{ person: { id: { _text: 'A1' }, nickname: { _text: '' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const nicknameAddAtMax = screen.getByRole('button', { name: /Add nickname/i });
    expect(nicknameAddAtMax.hasAttribute('disabled')).toBe(true);
  });

  test('keeps element trigger row add-only and uses rhs trash for optional element instances', () => {
    const onChange = jest.fn();
    renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: { id: { _text: 'A1' }, nickname: { _text: 'N' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    // Optional element instances still get rhs remove control with specific node labeling.
    expect(screen.queryByTitle('Remove nickname')).toBeTruthy();
    expect(screen.queryByTitle('Remove element')).toBeNull();
  });

  test('hides trigger for required singleton elements', () => {
    const onChange = jest.fn();
    renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: { id: { _text: 'A1' }, nickname: { _text: 'N' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    // id has minOccurs=1, so no trigger-row remove control should appear.
    expect(screen.queryByTitle('Remove id')).toBeNull();

    // Required singleton elements should not render a trigger chip at all.
    expect(screen.queryByRole('button', { name: /^\+\s*id$/i })).toBeNull();
  });

  test('shows required singleton trigger with ! while missing', () => {
    const onChange = jest.fn();

    renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: {} }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const idTrigger = screen.queryByRole('button', { name: /Add id/i });
    expect(idTrigger).toBeTruthy();
    expect(idTrigger?.textContent || '').toContain('!');
  });

  test('infers bounded repeat add/remove behavior from minOccurs/maxOccurs', () => {
    const onChange = jest.fn();
    const boundedSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="person" type="PersonType"/>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="alias" type="xs:string" minOccurs="2" maxOccurs="3"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    const { rerender } = renderForm(
      <XmlInstanceForm
        schema={boundedSchema}
        rootSchema={boundedSchema}
        value={{ person: { alias: [{ _text: 'a' }, { _text: 'b' }] } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const addAliasAtMin = screen.getByRole('button', { name: /Add alias/i });
    expect(addAliasAtMin.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByTitle('Remove alias 1')).toBeNull();
    expect(screen.queryByTitle('Remove alias 2')).toBeNull();

    fireEvent.click(addAliasAtMin);
    const afterAdd = onChange.mock.calls[0][0];
    expect(Array.isArray(afterAdd.person.alias)).toBe(true);
    expect(afterAdd.person.alias).toHaveLength(3);

    rerender(
      <TooltipProvider delayDuration={0}>
        <XmlInstanceForm
          schema={boundedSchema}
          rootSchema={boundedSchema}
          value={{ person: { alias: [{ _text: 'a' }, { _text: 'b' }, { _text: 'c' }] } }}
          onChange={onChange}
          autoExpandAll
        />
      </TooltipProvider>,
    );

    const addAliasAtMax = screen.getByRole('button', { name: /Add alias/i });
    expect(addAliasAtMax.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTitle('Remove alias 1')).toBeTruthy();
  });

  test('removes repeating children only when count is above minOccurs', () => {
    const onChange = jest.fn();
    const boundedSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="person" type="PersonType"/>
        <xs:complexType name="PersonType">
          <xs:sequence>
            <xs:element name="alias" type="xs:string" minOccurs="2" maxOccurs="3"/>
          </xs:sequence>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={boundedSchema}
        rootSchema={boundedSchema}
        value={{ person: { alias: [{ _text: 'a' }, { _text: 'b' }, { _text: 'c' }] } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const removeFirstAlias = screen.getByTitle('Remove alias 1');
    expect(removeFirstAlias).toBeTruthy();
    fireEvent.click(removeFirstAlias as HTMLElement);

    const afterRemove = onChange.mock.calls[0][0];
    expect(Array.isArray(afterRemove.person.alias)).toBe(true);
    expect(afterRemove.person.alias).toHaveLength(2);
  });

  test('choice sibling trigger is hidden once another choice option is present', () => {
    const onChange = jest.fn();
    const choiceSchema = {
      'xs:schema': {
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:choice': {
            'xs:element': [
              {
                '@attributes': {
                  name: 'workEmail',
                  type: 'xs:string',
                },
              },
              {
                '@attributes': {
                  name: 'homeEmail',
                  type: 'xs:string',
                },
              },
            ],
          },
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={choiceSchema}
        rootSchema={choiceSchema}
        value={{ person: { workEmail: { _text: 'a@corp.test' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const homeEmailAdd = screen.queryByRole('button', { name: /^\+\s*homeEmail$/i });
    expect(homeEmailAdd).toBeNull();
  });

  test('repeatable choice keeps sibling options visible instead of forcing a single selected dropdown branch', () => {
    const onChange = jest.fn();
    const repeatableChoiceSchema = {
      'xs:schema': {
        'xs:element': {
          '@attributes': {
            name: 'root',
            type: 'RootType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'RootType',
          },
          'xs:choice': {
            '@attributes': {
              minOccurs: '0',
              maxOccurs: 'unbounded',
            },
            'xs:element': [
              {
                '@attributes': {
                  name: 'import',
                  type: 'xs:string',
                },
              },
              {
                '@attributes': {
                  name: 'annotation',
                  type: 'xs:string',
                },
              },
            ],
          },
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={repeatableChoiceSchema}
        rootSchema={repeatableChoiceSchema}
        value={{ root: { import: { _text: 'i1' }, annotation: { _text: 'a1' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    expect(screen.getByRole('button', { name: /Add import/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add annotation/i })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('schema form does not synthesize missing required choice rows from walking schema', async () => {
    const onChange = jest.fn();
    const schemaGrammar = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="holder" type="HolderType"/>
        <xs:complexType name="HolderType">
          <xs:choice>
            <xs:element name="xs:import" type="xs:string"/>
            <xs:element name="xs:annotation" type="xs:string"/>
          </xs:choice>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaGrammar}
        rootSchema={schemaGrammar}
        value={{ holder: {} }}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add xs:import/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Add xs:annotation/i })).toBeTruthy();
    });

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByTestId('xml-tag-xs_import')).toBeNull();
    expect(screen.queryByTestId('xml-tag-xs_annotation')).toBeNull();
  });

  test('schema form preserves existing sibling choice nodes without collapsing to a selected dropdown', async () => {
    const onChange = jest.fn();
    const schemaGrammar = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="holder" type="HolderType"/>
        <xs:complexType name="HolderType">
          <xs:choice>
            <xs:element name="xs:import" type="xs:string"/>
            <xs:element name="xs:annotation" type="xs:string"/>
          </xs:choice>
        </xs:complexType>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaGrammar}
        rootSchema={schemaGrammar}
        value={{ holder: { 'xs:import': { _text: 'i1' }, 'xs:annotation': { _text: 'a1' } } }}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('xml-element-xs_import-input')).toBeTruthy();
      expect(screen.getByTestId('xml-element-xs_annotation-input')).toBeTruthy();
    });

    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('schema form inline complexType repeatable choice keeps sibling nodes visible', async () => {
    const onChange = jest.fn();
    const schemaGrammar = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="holder">
          <xs:complexType>
            <xs:choice minOccurs="0" maxOccurs="unbounded">
              <xs:element name="xs:import" type="xs:string"/>
              <xs:element name="xs:annotation" type="xs:string"/>
            </xs:choice>
          </xs:complexType>
        </xs:element>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={schemaGrammar}
        rootSchema={schemaGrammar}
        value={{ holder: { 'xs:import': { _text: 'i1' }, 'xs:annotation': { _text: 'a1' } } }}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('xml-element-xs_import-input')).toBeTruthy();
      expect(screen.getByTestId('xml-element-xs_annotation-input')).toBeTruthy();
    });

    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('schema form root does not duplicate top-level add triggers with prefixed child triggers', async () => {
    const onChange = jest.fn();
    const xmlSchema = parseMarkup(`
      <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="holder" type="SchemaType"/>
        <xs:complexType name="SchemaType">
          <xs:sequence>
            <xs:group ref="xs:schemaTop" minOccurs="0" maxOccurs="unbounded"/>
          </xs:sequence>
        </xs:complexType>
        <xs:group name="schemaTop">
          <xs:choice>
            <xs:element ref="xs:element"/>
            <xs:element ref="xs:attribute"/>
            <xs:element ref="xs:complexType"/>
          </xs:choice>
        </xs:group>
      </xs:schema>
    `, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={xmlSchema}
        rootSchema={xmlSchema}
        value={{ holder: {} }}
        onChange={onChange}
        autoExpandAll
        expansionStateKey="xml-schema-form-expanded"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Add Element/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add ComplexType/i })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /Add Group/i })).toHaveLength(1);
    });

    expect(screen.queryByRole('button', { name: /Add xs:element/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add xs:complexType/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add xs:group/i })).toBeNull();
  });

  test('optional choice shows rhs trash near dropdown and removes selected branch', () => {
    const onChange = jest.fn();
    const optionalChoiceSchema = {
      'xs:schema': {
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:choice': {
            '@attributes': {
              minOccurs: '0',
              maxOccurs: '1',
            },
            'xs:element': [
              {
                '@attributes': {
                  name: 'workEmail',
                  type: 'xs:string',
                },
              },
              {
                '@attributes': {
                  name: 'homeEmail',
                  type: 'xs:string',
                },
              },
            ],
          },
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={optionalChoiceSchema}
        rootSchema={optionalChoiceSchema}
        value={{ person: { workEmail: { _text: 'a@corp.test' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const removeChoice = screen.queryByTitle('Remove selected workEmail option');
    expect(removeChoice).toBeTruthy();
    fireEvent.click(removeChoice as HTMLElement);

    const payload = onChange.mock.calls[0][0];
    expect(payload.person.workEmail).toBeUndefined();
  });

  test('simple choice places optional trash button to the rhs of input', () => {
    const onChange = jest.fn();
    const optionalChoiceSchema = {
      'xs:schema': {
        'xs:element': {
          '@attributes': {
            name: 'person',
            type: 'PersonType',
          },
        },
        'xs:complexType': {
          '@attributes': {
            name: 'PersonType',
          },
          'xs:choice': {
            '@attributes': {
              minOccurs: '0',
              maxOccurs: '1',
            },
            'xs:element': [
              {
                '@attributes': {
                  name: 'workEmail',
                  type: 'xs:string',
                },
              },
              {
                '@attributes': {
                  name: 'homeEmail',
                  type: 'xs:string',
                },
              },
            ],
          },
        },
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={optionalChoiceSchema}
        rootSchema={optionalChoiceSchema}
        value={{ person: { workEmail: { _text: 'a@corp.test' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const input = screen.getByDisplayValue('a@corp.test');
    const removeChoice = screen.getByTitle('Remove selected workEmail option');

    expect(input.nextElementSibling).toBe(removeChoice);
  });

  test('keeps sibling root options visible and allows switching active root', () => {
    const onChange = jest.fn();
    const rootSchema = {
      'xs:schema': {
        'xs:element': [
          { '@attributes': { name: 'person', type: 'PersonType', minOccurs: '1', maxOccurs: '1' } },
          { '@attributes': { name: 'employee', type: 'EmployeeType', minOccurs: '1', maxOccurs: '1' } },
          { '@attributes': { name: 'note', type: 'NoteType', minOccurs: '1', maxOccurs: '1' } },
        ],
        'xs:complexType': [
          { '@attributes': { name: 'PersonType' } },
          { '@attributes': { name: 'EmployeeType' } },
          { '@attributes': { name: 'NoteType' } },
        ],
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={rootSchema}
        rootSchema={rootSchema}
        value={{ employee: { id: { _text: 'E1' } } }}
        onChange={onChange}
      />,
    );

    const personButton = screen.getByRole('button', { name: /^\+\s*person\s*!$/i });
    const noteButton = screen.getByRole('button', { name: /^\+\s*note\s*!$/i });
    expect(personButton).toBeTruthy();
    expect(noteButton).toBeTruthy();

    fireEvent.click(personButton);
    const switchedPayload = onChange.mock.calls[0][0];
    expect(switchedPayload.employee).toBeUndefined();
    expect(switchedPayload.person).toBeTruthy();

    const employeeButton = screen.getByTitle('employee already selected (1/1)');
    expect(employeeButton).toBeTruthy();
    expect(employeeButton.getAttribute('aria-pressed')).toBe('true');
    expect(employeeButton.hasAttribute('disabled')).toBe(false);
  });

  test('treats only global min:1 max:1 elements as the schema choice set', () => {
    const onChange = jest.fn();
    const rootSchema = {
      'xs:schema': {
        'xs:element': [
          { '@attributes': { name: 'person', type: 'PersonType', minOccurs: '1', maxOccurs: '1' } },
          { '@attributes': { name: 'employee', type: 'EmployeeType', minOccurs: '1', maxOccurs: '1' } },
          { '@attributes': { name: 'note', type: 'NoteType', minOccurs: '0', maxOccurs: '1' } },
          { '@attributes': { name: 'archive', type: 'ArchiveType', minOccurs: '1', maxOccurs: '2' } },
        ],
        'xs:complexType': [
          { '@attributes': { name: 'PersonType' } },
          { '@attributes': { name: 'EmployeeType' } },
          { '@attributes': { name: 'ArchiveType' } },
        ],
      },
    } as any;

    renderForm(
      <XmlInstanceForm
        schema={rootSchema}
        rootSchema={rootSchema}
        value={{ person: { id: { _text: 'P1' } } }}
        onChange={onChange}
      />,
    );

    expect(screen.getByTitle('person already selected (1/1)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^\+\s*employee\s*!$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^\+\s*note$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^\+\s*archive$/i })).toBeNull();
  });

  test('renders inherited attributes and elements for an inline extension based on modelType', () => {
    const onChange = jest.fn();
    const modelSchema = parseMarkup(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="modelType">
    <xs:choice>
      <xs:sequence>
        <xs:element name="ClassFields" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:choice>
    <xs:attribute name="name" type="xs:string" use="required"/>
    <xs:attribute name="namespace" type="xs:string"/>
  </xs:complexType>

  <xs:element name="Model">
    <xs:complexType>
      <xs:complexContent>
        <xs:extension base="modelType">
          <xs:sequence>
            <xs:element name="PostScript" type="xs:string" minOccurs="0"/>
          </xs:sequence>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`, 'xml');

    renderForm(
      <XmlInstanceForm
        schema={modelSchema}
        rootSchema={modelSchema}
        value={{ Model: { '@attributes': { name: 'DemoModel' }, PostScript: { _text: 'done' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    expect(screen.getByRole('button', { name: /^\+\s*name$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^\+\s*namespace$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add PostScript/i })).toBeTruthy();
  });

  test('removes attributes declared in an inline complexContent extension on the model element', async () => {
    const onChange = jest.fn();
    const modelSchema = parseMarkup(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="UpgradeStep">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Models">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Model" type="ModelType" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="ModelType">
    <xs:complexContent>
      <xs:extension base="BaseModelType">
        <xs:attribute name="version-number" type="xs:string" use="optional"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>

  <xs:complexType name="BaseModelType">
    <xs:attribute name="name" type="xs:string" use="optional"/>
  </xs:complexType>
</xs:schema>`, 'xml');
    const value = parseMarkup(`<?xml version="1.0" encoding="UTF-8"?>
<UpgradeStep>
  <Models>
    <Model version-number="2.0" name="DemoModel" />
  </Models>
</UpgradeStep>`, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={modelSchema}
        rootSchema={modelSchema}
        value={value}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const removeButton = screen.getByTitle('Remove version-number');
    expect(removeButton).toBeTruthy();

    fireEvent.click(removeButton as HTMLElement);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const payload = onChange.mock.calls[0][0];
    expect(payload.UpgradeStep.Models.Model['@attributes']?.['version-number']).toBeUndefined();
    expect(payload.UpgradeStep.Models.Model['@attributes']?.name).toBe('DemoModel');
  });

  test('keeps the @attributes bag when deleting a single attribute from the second model in the list', async () => {
    const onChange = jest.fn();
    const modelSchema = parseMarkup(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="UpgradeStep">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Models">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Model" type="ModelType" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="ModelType">
    <xs:complexContent>
      <xs:extension base="BaseModelType">
        <xs:attribute name="version-number" type="xs:string" use="optional"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>

  <xs:complexType name="BaseModelType">
    <xs:attribute name="name" type="xs:string" use="optional"/>
  </xs:complexType>
</xs:schema>`, 'xml');
    const value = parseMarkup(`<?xml version="1.0" encoding="UTF-8"?>
<UpgradeStep>
  <Models>
    <Model version-number="1.0" name="Alpha" />
    <Model version-number="2.0" name="Bravo" />
  </Models>
</UpgradeStep>`, 'xml') as any;

    renderForm(
      <XmlInstanceForm
        schema={modelSchema}
        rootSchema={modelSchema}
        value={value}
        onChange={onChange}
        autoExpandAll
      />,
    );

    const removeButton = screen.getAllByTitle('Remove version-number')[1];
    fireEvent.click(removeButton as HTMLElement);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const payload = onChange.mock.calls[0][0];
    const attrs = payload.UpgradeStep.Models.Model[1]?.['@attributes'];

    expect(attrs).toBeTruthy();
    expect(attrs?.['version-number']).toBeUndefined();
    expect(attrs?.name).toBe('Bravo');
  });

  test('uses attribute trigger row for remove controls and hides inline attribute trash', () => {
    const onChange = jest.fn();

    renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: { '@attributes': { alias: 'Alpha' }, id: { _text: 'A1' } } }}
        onChange={onChange}
        autoExpandAll
      />,
    );

    // Present optional attribute gets trigger-row trash chip.
    expect(screen.queryByTitle('Remove alias')).toBeTruthy();

    // Present attribute disables its + trigger chip.
    const aliasAdd = screen.getByRole('button', { name: /^\+\s*alias$/i });
    expect(aliasAdd.hasAttribute('disabled')).toBe(true);

    // Inline per-row "Remove attribute" buttons are removed.
    expect(screen.queryByTitle('Remove attribute')).toBeNull();
  });

});
