import { resolveInstanceChildData } from './xml-instance-form.utils';

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
});
