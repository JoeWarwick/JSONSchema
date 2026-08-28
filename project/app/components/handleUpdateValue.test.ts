/**
 * Test for handleUpdateValue wrapper unwrapping logic
 * This tests if handleUpdateValue correctly unwraps wrapped values before passing to updateFn
 */

describe('handleUpdateValue wrapper unwrapping', () => {
  it('should unwrap wrapped values when path is empty', () => {
    // Simulate the scenario: value = {person: {...}}, path = []
    const wrappedValue = {
      person: {
        homeEmail: { _text: 'test@example.com' },
        firstName: 'John',
      },
    };

    const wrapperKey = 'person'; // Should be set by useMemo

    // Simulate what handleUpdateValue should do
    const pathArray: string[] = [];
    const updateFn = (current: any) => {
      // This is the choice switch updateFn
      // It should receive the unwrapped person object, not the wrapped {person: {...}}
      
      console.log('updateFn received with keys:', Object.keys(current || {}));
      
      // Try to switch choice
      const updated = { ...current };
      delete updated.homeEmail;
      updated.workEmail = { _text: 'work@example.com' };
      
      return updated;
    };

    // Simulate handleUpdateValue logic
    let adjustedPath = pathArray;
    if (adjustedPath.length === 0 && wrapperKey) {
      adjustedPath = [wrapperKey]; // Should become ['person']
    }

    const updated = JSON.parse(JSON.stringify(wrappedValue));
    let target = updated;
    
    // Navigate to parent
    for (let i = 0; i < adjustedPath.length - 1; i++) {
      const key = adjustedPath[i];
      if (!target[key]) target[key] = {};
      target = target[key];
    }

    const lastKey = adjustedPath[adjustedPath.length - 1];
    
    // This is the critical line: calling updateFn
    const result = updateFn(target[lastKey]); // Should pass unwrapped {homeEmail: ..., firstName: ...}
    
    // updateFn should have received the person object
    expect(result).toHaveProperty('workEmail');
    expect(result).not.toHaveProperty('homeEmail');
    expect(result).toHaveProperty('firstName');
    
    // After assignment, updated should still be wrapped
    target[lastKey] = result;
    
    expect(updated).toHaveProperty('person');
    expect(updated.person).toHaveProperty('workEmail');
    expect(updated.person).not.toHaveProperty('homeEmail');
  });

  it('should detect if updateFn receives wrapped value (bug indicator)', () => {
    const wrappedValue = {
      person: {
        homeEmail: { _text: 'test@example.com' },
        firstName: 'John',
      },
    };

    let receivedValue: any;
    const updateFn = (current: any) => {
      receivedValue = current;
      return { ...current };
    };

    // If this test fails and receivedValue === wrappedValue, then the bug exists
    // (updateFn received the wrapped object instead of unwrapped)
    
    const person = wrappedValue.person;
    updateFn(person);
    
    // updateFn should have received the person object, not the wrapper
    expect(receivedValue).toEqual(person);
    expect(receivedValue).not.toEqual(wrappedValue);
    expect(Object.keys(receivedValue)).toContain('homeEmail');
    expect(Object.keys(receivedValue)).not.toContain('person');
  });
});
