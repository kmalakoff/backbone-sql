import type Backbone from 'backbone';
import BackboneORM, { type ModelConstructor } from 'backbone-orm';

const UNSUPPORTED_DESTROY_SHAPES = ['$unique', '$values', '$count', '$exists', '$page', '$one'];

export interface OrdinaryDestroyQuery {
  cursor: Record<string, unknown>;
  find: Record<string, unknown>;
}

function identityFields(value: unknown, idAttribute: string): string[] {
  const fields = Array.isArray(value) ? value : [value];
  if (!fields.every((field) => typeof field === 'string')) throw new Error('SQLite destroy projection fields must be strings');
  return [...new Set([...fields, idAttribute])];
}

export function ordinaryDestroyQuery(modelType: ModelConstructor<Backbone.Model>, query: unknown): OrdinaryDestroyQuery {
  const parsed = BackboneORM.Cursor.parseQuery(query, modelType);
  for (const key of UNSUPPORTED_DESTROY_SHAPES) {
    if (Reflect.getOwnPropertyDescriptor(parsed.cursor, key)) throw new Error(`SQLite destroy cursor shape is not implemented: ${key}`);
  }
  const cursor = { ...parsed.cursor };
  if (Reflect.getOwnPropertyDescriptor(cursor, '$each')) {
    const each = cursor.$each;
    if (typeof each !== 'object' || each === null || Array.isArray(each) || Reflect.getOwnPropertyDescriptor(each, 'threads')?.value !== 1 || Reflect.ownKeys(each).some((key) => key !== 'threads')) {
      throw new Error('SQLite destroy only supports explicit serial $each.threads: 1; fetch and other concurrency controls are not implemented');
    }
    delete cursor.$each;
  }
  const idAttribute = new modelType().idAttribute;
  if (cursor.$sort === undefined) cursor.$sort = idAttribute;
  if (cursor.$select !== undefined) cursor.$select = identityFields(cursor.$select, idAttribute);
  if (cursor.$whitelist !== undefined) cursor.$whitelist = identityFields(cursor.$whitelist, idAttribute);
  return { cursor, find: { ...parsed.find } };
}
