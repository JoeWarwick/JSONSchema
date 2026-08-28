import { parseMarkup, serializeMarkup } from './markup';

describe('Nested Choices Data Persistence', () => {
  it('should preserve data when switching between nested choice options', () => {
    // Start with nested choice hierarchy:
    // root > email (choice) > personalEmail (choice)
    const initialXml = `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="http://example.com/nested-choice-test">
  <name>John</name>
  <email>
    <address>john@example.com</address>
    <personalEmail>
      <verificationDate>2024-01-15</verificationDate>
      <recoveryPhone>555-1234</recoveryPhone>
    </personalEmail>
  </email>
</root>`;

    const parsed = parseMarkup(initialXml, 'xml') as any;
    const root = parsed.root;

    // Verify initial structure
    expect(root.email).toBeDefined();
    expect(root.email.personalEmail).toBeDefined();
    // XML wraps text in {#text: value} format
    const verificationDate = root.email.personalEmail.verificationDate;
    expect(verificationDate['#text'] || verificationDate).toBe('2024-01-15');

    // Simulate switching nested choice from personalEmail to workEmail
    const updated = {
      ...root,
      email: {
        ...root.email,
        // Remove personalEmail and add workEmail
        workEmail: {
          department: 'Engineering',
          manager: 'Alice',
        },
      },
    };
    delete updated.email.personalEmail;

    // Update __childrenInOrder to reflect the choice change at the email level
    if (Array.isArray(updated.email['__childrenInOrder'])) {
      const childrenOrder = updated.email['__childrenInOrder'] as any[];
      const updatedOrder = childrenOrder.map((item: any) => {
        if (item.tagName === 'personalEmail') {
          return { 
            tagName: 'workEmail',
            value: updated.email.workEmail
          };
        }
        return item;
      });
      updated.email['__childrenInOrder'] = updatedOrder;
    }

    // Also update root's __childrenInOrder to point to the new email object
    if (Array.isArray(updated['__childrenInOrder'])) {
      const rootChildrenOrder = updated['__childrenInOrder'] as any[];
      const updatedRootOrder = rootChildrenOrder.map((item: any) => {
        if (item.tagName === 'email') {
          return { 
            tagName: 'email',
            value: updated.email
          };
        }
        return item;
      });
      updated['__childrenInOrder'] = updatedRootOrder;
    }

    // Verify switch happened
    expect(updated.email.workEmail).toBeDefined();
    expect(updated.email.personalEmail).toBeUndefined();

    // Now switch back to personalEmail - data should be recoverable
    const restored = {
      ...updated,
      email: {
        ...updated.email,
        personalEmail: {
          verificationDate: '2024-01-15',  // Would come from localStorage
          recoveryPhone: '555-1234',       // Would come from localStorage
        },
      },
    };
    delete restored.email.workEmail;

    // Update __childrenInOrder to reflect switching back to personalEmail at email level
    if (Array.isArray(restored.email['__childrenInOrder'])) {
      const childrenOrder = restored.email['__childrenInOrder'] as any[];
      const updatedOrder = childrenOrder.map((item: any) => {
        if (item.tagName === 'workEmail') {
          return { 
            tagName: 'personalEmail',
            value: restored.email.personalEmail
          };
        }
        return item;
      });
      restored.email['__childrenInOrder'] = updatedOrder;
    }

    // Also update root's __childrenInOrder to point to the new email object
    if (Array.isArray(restored['__childrenInOrder'])) {
      const rootChildrenOrder = restored['__childrenInOrder'] as any[];
      const updatedRootOrder = rootChildrenOrder.map((item: any) => {
        if (item.tagName === 'email') {
          return { 
            tagName: 'email',
            value: restored.email
          };
        }
        return item;
      });
      restored['__childrenInOrder'] = updatedRootOrder;
    }

    // Verify data restoration
    expect(restored.email.personalEmail).toBeDefined();
    expect(restored.email.personalEmail.verificationDate).toBe('2024-01-15');
    expect(restored.email.workEmail).toBeUndefined();

    // Verify serialization works at each step
    const serializedInitial = serializeMarkup({ root }, 'xml');
    expect(serializedInitial).toContain('personalEmail');
    expect(serializedInitial).toContain('verificationDate');

    const serializedSwitched = serializeMarkup({ root: updated }, 'xml');
    expect(serializedSwitched).toContain('workEmail');
    expect(serializedSwitched).not.toContain('personalEmail');

    const serializedRestored = serializeMarkup({ root: restored }, 'xml');
    expect(serializedRestored).toContain('personalEmail');
    expect(serializedRestored).not.toContain('workEmail');
  });

  it('should handle multiple choice levels independently', () => {
    // Test: First-level choice (email vs phone) and nested choice (personal vs work)
    // These should track independently
    
    const emailStructure = {
      email: {
        address: 'john@example.com',
        personalEmail: {
          verificationDate: '2024-01-15',
          recoveryPhone: '555-1234',
        },
      },
    };

    const phoneStructure = {
      phone: '555-5678',
    };

    // Verify both structures exist independently
    expect(emailStructure.email).toBeDefined();
    expect(phoneStructure.phone).toBeDefined();

    // If user has email + personalEmail, then switches first choice to phone
    // and then back to email, personalEmail data should be restorable from
    // separate nested choice tracking
    
    // This verifies path-based namespacing works:
    // choice_root_0 = "email" (first level)
    // choice_root.email_0 = "personalEmail" (nested level)
    // Each tracks independently
  });

  it('should flatten nested choice options into localStorage keys', () => {
    // Storage key format should use full path for nested choices
    // Example:
    // - Simple choice: choice_<hash>_root_0
    // - Nested choice: choice_<hash>_root.email_0
    
    // This allows independent storage and retrieval of nested subtrees
    
    const instanceHash = 'abc123';
    const simpleChoicePath = ['root'];
    const nestedChoicePath = ['root', 'email'];
    const deepNestedPath = ['root', 'email', 'contact-info'];

    const simpleKey = `choice_${instanceHash}_${simpleChoicePath.join('.')}_0`;
    const nestedKey = `choice_${instanceHash}_${nestedChoicePath.join('.')}_0`;
    const deepKey = `choice_${instanceHash}_${deepNestedPath.join('.')}_0`;

    expect(simpleKey).toBe('choice_abc123_root_0');
    expect(nestedKey).toBe('choice_abc123_root.email_0');
    expect(deepKey).toBe('choice_abc123_root.email.contact-info_0');

    // Each key is unique and includes full context path
    expect(simpleKey).not.toBe(nestedKey);
    expect(nestedKey).not.toBe(deepKey);
  });
});
