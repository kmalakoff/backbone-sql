import type { SchemaInstance } from 'backbone-orm';

export function nativeToAttributes(row: Record<string, unknown>, schema: Pick<SchemaInstance, 'fields'> | undefined): void {
  for (const key of Object.keys(row)) {
    if (row[key] !== null && schema?.fields[key]?.type === 'Boolean') row[key] = Boolean(row[key]);
  }
}
