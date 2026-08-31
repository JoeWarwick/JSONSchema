import { test, expect } from '@playwright/test';

test.setTimeout(120000);

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const SCHEMA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="UpgradeStep">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Model" type="ModelType"/>
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
</xs:schema>`;

const INSTANCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<UpgradeStep>
  <Model version-number="2.0" name="DemoModel"/>
</UpgradeStep>`;

test.describe('Instance Form attribute deletion regression', () => {
  test('removes the inherited version-number attribute from a nested Model element', async ({ page }) => {
    await page.context().addInitScript(() => {
      try {
        localStorage.setItem('schema-sculptor-markup-language', 'xml');
        localStorage.setItem('schema-sculptor-schema-xml', `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="UpgradeStep">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Model" type="ModelType"/>
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
</xs:schema>`);
        localStorage.setItem('schema-sculptor-instance-xml', `<?xml version="1.0" encoding="UTF-8"?>
<UpgradeStep>
  <Model version-number="2.0" name="DemoModel"/>
</UpgradeStep>`);
      } catch {
        // ignore
      }
    });

    await page.goto(BASE);

    await page.getByRole('button', { name: 'Instance Form' }).click();

    const upgradeRow = page.locator('[data-testid="xml-tag-UpgradeStep"]').locator('..');
    await upgradeRow.locator('button').first().click();

    const modelRow = page.locator('[data-testid="xml-tag-Model"]').locator('..');
    await modelRow.locator('button').first().click();

    const removeButton = page.getByTitle('Remove version-number');
    await expect(removeButton).toBeVisible({ timeout: 20000 });
    await removeButton.click();

    await page.getByRole('button', { name: 'XML Input' }).click();
    const xmlText = await page.locator('textarea').first().inputValue();

    expect(xmlText).not.toContain('version-number');
    expect(xmlText).toContain('<Model');
  });
});
