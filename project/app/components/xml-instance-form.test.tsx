import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    const nicknameAdd = screen.getByRole('button', { name: /^\+\s*nickname$/i });
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

    const nicknameAddAtMax = screen.getByRole('button', { name: /^\+\s*nickname$/i });
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

    // Element trigger row should not include per-element remove chips.
    expect(screen.queryByTitle('Remove nickname')).toBeNull();

    // Optional element instances still get rhs remove control.
    expect(screen.queryByTitle('Remove element')).toBeTruthy();
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

    const idTrigger = screen.queryByRole('button', { name: /^\+\s*id\s*!$/i });
    expect(idTrigger).toBeTruthy();
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

    const removeChoice = screen.queryByTitle('Remove selected choice element');
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
    const removeChoice = screen.getByTitle('Remove selected choice element');

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
    expect(screen.getByRole('button', { name: /^\+\s*PostScript$/i })).toBeTruthy();
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
