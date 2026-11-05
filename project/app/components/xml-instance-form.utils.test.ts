import { resolveInstanceChildData, resolveInstanceChildKey, synchronizeXmlChildOrder } from './xml-instance-form.utils';

describe('resolveInstanceChildData', () => {
  it('resolves prefixed child names from the root instance wrapper', () => {
    const child = { '@attributes': { name: 'example' } };
    const instance = {
      'xsl:stylesheet': {
        template: child,
      },
    };

    expect(resolveInstanceChildData('xsl:template', 'xsl:stylesheet', instance, true)).toBe(child);
  });

  it('resolves root values wrapped by a namespaced document element', () => {
    const child = { '@attributes': { name: 'apply-templates' } };
    const instance = {
      'xsl:stylesheet': {
        'xsl:template': child,
      },
    };

    expect(resolveInstanceChildData('xsl:template', 'xsl:stylesheet', instance, true)).toBe(child);
    expect(resolveInstanceChildData('template', 'xsl:stylesheet', instance, true)).toBe(child);
  });

  it('does not unwrap non-root instance values', () => {
    const instance = {
      wrapper: {
        child: 'value',
      },
    };

    expect(resolveInstanceChildData('child', 'wrapper', instance, false)).toBeUndefined();
  });

  it('resolves nested prefixed fields without requiring parsed child-order metadata', () => {
    const child = { '#text': 'Main Street' };
    const instance = { 'tns:street': child };
    expect(resolveInstanceChildData('street', 'tns:address', instance, false)).toBe(child);
    expect(resolveInstanceChildKey(instance, 'street')).toBe('tns:street');
    expect(resolveInstanceChildKey(instance, 'tns:street')).toBe('tns:street');
  });

  it('prefers exact names and does not guess among multiple namespace matches', () => {
    const instance = { 'a:name': 'A', 'b:name': 'B' };
    expect(resolveInstanceChildKey(instance, 'a:name')).toBe('a:name');
    expect(resolveInstanceChildKey(instance, 'name')).toBeUndefined();
    expect(resolveInstanceChildKey({ '@name': 'attribute' }, 'name')).toBeUndefined();
  });

  it('refreshes ordered occurrences from edited values without changing document order', () => {
    const current = {
      'tns:item': [{ '#text': 'One' }, { '#text': 'Updated' }],
      'tns:other': { '#text': 'Other' },
      __childrenInOrder: [
        { tagName: 'tns:item', value: { '#text': 'Old one' } },
        { tagName: 'tns:other', value: { '#text': 'Old other' } },
        { tagName: 'tns:item', value: { '#text': 'Old two' } },
      ],
    };
    synchronizeXmlChildOrder(current);
    expect(current.__childrenInOrder.map(entry => entry.tagName)).toEqual(['tns:item', 'tns:other', 'tns:item']);
    expect(current.__childrenInOrder[0].value).toBe(current['tns:item'][0]);
    expect(current.__childrenInOrder[1].value).toBe(current['tns:other']);
    expect(current.__childrenInOrder[2].value).toBe(current['tns:item'][1]);
    expect(resolveInstanceChildData('item', 'root', current, false)).toEqual(current['tns:item']);
  });
});
