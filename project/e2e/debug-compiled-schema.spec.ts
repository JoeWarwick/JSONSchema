import { test } from '@playwright/test';

test('Debug compiled schema for choice and enumerations', async ({ page }) => {
  const logs: any[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('SchemaCompiler') || text.includes('getTypeEnumerations') || text.includes('compositorType')) {
      logs.push(text);
      console.log(text);
    }
  });
  
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  
  console.log('\n=== SCHEMA COMPILER LOGS ===');
  console.log(`Total relevant logs: ${logs.length}`);
  
  // Look for specific patterns
  const choiceLogs = logs.filter(l => l.includes('choice'));
  const enumLogs = logs.filter(l => l.includes('getTypeEnumerations'));
  const personTypeLogs = logs.filter(l => l.includes('PersonType'));
  
  console.log('\nChoice-related logs:');
  choiceLogs.slice(0, 10).forEach(l => console.log('  ' + l));
  
  console.log('\nEnum-related logs:');
  enumLogs.slice(0, 10).forEach(l => console.log('  ' + l));
  
  console.log('\nPersonType logs:');
  personTypeLogs.forEach(l => console.log('  ' + l));
});
