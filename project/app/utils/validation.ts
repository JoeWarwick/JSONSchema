export function validateValueAgainstSchema(value: unknown, schema: Record<string, unknown>): string | null {
  // Allow empty input for string defaults/inputs
  if (value === '' || value === undefined || value === null) return null;

  const type = schema.type as string | undefined;

  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      return `Value must be one of: ${schema.enum.map(String).join(', ')}`;
    }
  }

  if (type) {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') return 'Value must be a string';
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) return 'Value must be a number';
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return 'Value must be a boolean';
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Value must be an object';
        break;
      case 'array':
        if (!Array.isArray(value)) return 'Value must be an array';
        break;
      case 'null':
        if (value !== null) return 'Value must be null';
        break;
      default:
        break;
    }
  }

  // Pattern validation
  if (schema.pattern && typeof value === 'string') {
    try {
      const re = new RegExp(String(schema.pattern));
      if (!re.test(value)) return 'Value does not match the pattern';
    } catch (e) {
      return 'Invalid pattern';
    }
  }

  // Format validation (simple heuristics)
  if (schema.format && typeof value === 'string') {
    const v = value;
    const fmt = String(schema.format);
    const isIsoDateTime = (s: string) => !Number.isNaN(Date.parse(s)) && /T/.test(s);
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    const isTime = (s: string) => /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
    const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s);
    const isIPv4 = (s: string) => /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(s);
    const isIPv6 = (s: string) => /^[0-9a-fA-F:]+$/.test(s);
    const isUUID = (s: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s);
    const isHostname = (s: string) => /^[a-zA-Z0-9.-]+$/.test(s);

    switch (fmt) {
      case 'date-time':
        if (!isIsoDateTime(v)) return 'Value must be an ISO date-time';
        break;
      case 'date':
        if (!isDate(v)) return 'Value must be a date (YYYY-MM-DD)';
        break;
      case 'time':
        if (!isTime(v)) return 'Value must be a time (HH:MM[:SS])';
        break;
      case 'email':
        if (!isEmail(v)) return 'Value must be a valid email';
        break;
      case 'uri':
        try {
          // eslint-disable-next-line no-new
          new URL(v);
        } catch (e) {
          return 'Value must be a valid URI';
        }
        break;
      case 'ipv4':
        if (!isIPv4(v)) return 'Value must be a valid IPv4 address';
        break;
      case 'ipv6':
        if (!isIPv6(v)) return 'Value must be a valid IPv6 address';
        break;
      case 'uuid':
        if (!isUUID(v)) return 'Value must be a valid UUID';
        break;
      case 'hostname':
        if (!isHostname(v)) return 'Value must be a valid hostname';
        break;
      default:
        break;
    }
  }

  return null;
}

export default validateValueAgainstSchema;
