import type { SchemaField, SchemaInstance } from 'backbone-orm';
import { validateSQLRelations } from './internal/relations.ts';
import type { SQLColumnDefinition, SQLColumnType } from './internal/types.ts';

const COLUMN_TYPES: Readonly<Record<string, SQLColumnType>> = {
  bigint: 'bigInteger',
  bigincrements: 'bigIncrements',
  biginteger: 'bigInteger',
  binary: 'binary',
  bool: 'boolean',
  boolean: 'boolean',
  date: 'date',
  datetime: 'dateTime',
  decimal: 'decimal',
  double: 'double',
  enum: 'enu',
  enu: 'enu',
  float: 'float',
  increments: 'increments',
  integer: 'integer',
  json: 'json',
  mediumint: 'mediumint',
  smallint: 'smallint',
  string: 'string',
  text: 'text',
  time: 'time',
  timestamp: 'timestamp',
  tinyint: 'tinyint',
  uuid: 'uuid',
  varchar: 'string',
};

function optionalBoolean(field: SchemaField, key: string): boolean | undefined {
  const value = field[key];
  if (value === undefined) return;
  if (typeof value !== 'boolean') throw new Error(`SQLite schema option ${key} must be a boolean`);
  return value;
}

function optionalNumber(field: SchemaField, key: string): number | undefined {
  const value = field[key];
  if (value === undefined) return;
  if (typeof value !== 'number') throw new Error(`SQLite schema option ${key} must be a number`);
  return value;
}

function columnType(name: string, field: SchemaField): SQLColumnType {
  if (typeof field.type !== 'string') throw new Error(`SQLite schema field ${name} requires a string type`);
  const type = COLUMN_TYPES[field.type.toLowerCase()];
  if (!type) throw new Error(`SQLite schema field ${name} has unsupported type: ${field.type}`);
  return type;
}

function fieldDefinition(name: string, field: SchemaField): SQLColumnDefinition {
  const definition: SQLColumnDefinition = {
    name,
    type: columnType(name, field),
  };
  definition.indexed = optionalBoolean(field, 'indexed');
  definition.nullable = optionalBoolean(field, 'nullable');
  definition.primary = optionalBoolean(field, 'primary');
  definition.unique = optionalBoolean(field, 'unique');
  if (definition.type === 'enu') {
    definition.enumSource = { kind: 'original-schema', field };
    return definition;
  }
  if (definition.type === 'increments' || definition.type === 'bigIncrements' || definition.type === 'dateTime' || definition.type === 'timestamp') {
    definition.constructorSource = { kind: 'original-schema', field };
    return definition;
  }
  definition.length = optionalNumber(field, 'length');
  definition.precision = optionalNumber(field, 'precision');
  definition.scale = optionalNumber(field, 'scale');
  if (field.textType !== undefined) {
    if (field.textType !== 'text' && field.textType !== 'mediumtext' && field.textType !== 'longtext') {
      throw new Error(`SQLite schema option textType is invalid for ${name}`);
    }
    definition.textType = field.textType;
  }
  return definition;
}

export function sqliteColumnDefinitions(schema: SchemaInstance): SQLColumnDefinition[] {
  schema.initialize();
  validateSQLRelations(schema);
  return columnDefinitions(schema);
}

export function postgreSQLColumnDefinitions(schema: SchemaInstance): SQLColumnDefinition[] {
  schema.initialize();
  validateSQLRelations(schema, 'PostgreSQL');
  return columnDefinitions(schema);
}

function columnDefinitions(schema: SchemaInstance): SQLColumnDefinition[] {
  return [...new Set(schema.columns())].map((name) => {
    const field = schema.fields[name];
    if (field) return fieldDefinition(name, field);
    if (name === 'id') return { indexed: true, name, primary: true, type: 'increments' };

    const relation = Object.values(schema.relations).find((candidate) => candidate.foreign_key === name);
    if (relation) return { indexed: true, name, nullable: true, type: 'integer' };
    throw new Error(`SQLite schema column ${name} has no field or belongsTo relation`);
  });
}
