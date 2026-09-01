export const commonPropertyTypes = ['string', 'int', 'long', 'short', 'decimal', 'double', 'float', 'bool', 'DateTime', 'DateTimeOffset', 'Guid'];

const identityColumnTypes = new Set(['int', 'long', 'short']);

export function isIdentityEligibleColumnType(type: string): boolean {
  return identityColumnTypes.has(type.replace(/\?$/, ''));
}

export function isTimestampColumnType(type: string): boolean {
  return ['DateTime', 'DateTimeOffset'].includes(type.replace(/\?$/, ''));
}