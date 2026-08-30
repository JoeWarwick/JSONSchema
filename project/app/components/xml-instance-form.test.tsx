import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from './ui/tooltip/tooltip';
import { XmlInstanceForm } from './xml-instance-form';

function renderForm(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('XmlInstanceForm trigger-row behavior', () => {
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

  test('uses attribute trigger row for remove controls and hides inline attribute trash', () => {
    const onChange = jest.fn();

    renderForm(
      <XmlInstanceForm
        schema={schema}
        rootSchema={schema}
        value={{ person: { '@attributes': { alias: 'Alpha' }, id: { _text: 'A1' } } }}
        onChange={onChange}
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
