const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function requireIdentifier(identifier: string, label = 'SQL identifier'): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`${label} is invalid: ${identifier}`);
  }
  return identifier;
}

export function requireIdentifiers(identifiers: readonly string[], label = 'SQL identifier'): string[] {
  return identifiers.map((identifier) => requireIdentifier(identifier, label));
}

export function requireLimit(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}
