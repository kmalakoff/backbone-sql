import type Backbone from 'backbone';
import type { ModelConstructor, Relation, SchemaInstance } from 'backbone-orm';

export interface SQLiteManyToManyRelation extends Relation {
  join_table: ModelConstructor<Backbone.Model>;
  reverse_relation: Relation;
}

export function isSQLiteManyToManyRelation(relation: Relation): relation is SQLiteManyToManyRelation {
  return relation.type === 'hasMany' && relation.reverse_relation?.type === 'hasMany' && relation.join_table !== undefined;
}

export type SQLRelationDialect = 'SQLite' | 'PostgreSQL';

export function requireSQLRelation(schema: SchemaInstance, key: string, dialect: SQLRelationDialect = 'SQLite'): Relation {
  const relation = schema.relation(key);
  if (!relation) throw new Error(`Included relation '${key}' is not a relation`);
  if (relation.isEmbedded()) throw new Error(`${dialect} embedded relations are not implemented: ${key}`);
  if (relation.isVirtual()) throw new Error(`${dialect} virtual relations are not implemented: ${key}`);
  if (relation.reverse_model_type === relation.model_type) throw new Error(`${dialect} self relations are not implemented: ${key}`);
  if (relation.join_table) {
    if (!isSQLiteManyToManyRelation(relation)) throw new Error(`${dialect} unsupported join-table relation: ${key}`);
    return relation;
  }
  if (relation.type !== 'belongsTo' && relation.type !== 'hasMany' && relation.type !== 'hasOne') {
    throw new Error(`SQLite ${relation.type} relations are not implemented: ${key}`);
  }
  if ((relation.type === 'hasMany' || relation.type === 'hasOne') && relation.reverse_relation?.type !== 'belongsTo') {
    throw new Error(`SQLite ${relation.type} relation requires a belongsTo reverse relation: ${key}`);
  }
  return relation;
}

export function validateSQLRelations(schema: SchemaInstance, dialect: SQLRelationDialect = 'SQLite'): void {
  for (const key of Object.keys(schema.relations)) requireSQLRelation(schema, key, dialect);
}
