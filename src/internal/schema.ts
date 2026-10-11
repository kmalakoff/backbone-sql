import BackboneORM from 'backbone-orm';
import type { Knex } from 'knex';

import { requireIdentifier } from './identifiers.ts';
import { operationWorker, runErrorWorker, runWorker } from './settle.ts';
import type { ErrorCallback, ResultCallback, SQLColumnDefinition } from './types.ts';

const CONSTRUCTOR_OPTIONS = ['textType', 'length', 'precision', 'scale', 'value', 'values'] as const;

function originalConstructorArgument(source: NonNullable<SQLColumnDefinition['constructorSource']>): unknown {
  const underscore = BackboneORM._;
  if ((typeof underscore !== 'object' && typeof underscore !== 'function') || underscore === null) throw new TypeError('ORM Underscore is unavailable');
  const pick: unknown = Reflect.get(underscore, 'pick');
  const values: unknown = Reflect.get(underscore, 'values');
  if (typeof pick !== 'function' || typeof values !== 'function') throw new TypeError('ORM Underscore pick/values are unavailable');
  const picked: unknown = Reflect.apply(pick, underscore, [source.field, CONSTRUCTOR_OPTIONS]);
  const arguments_: unknown = Reflect.apply(values, underscore, [picked]);
  if (!Array.isArray(arguments_)) throw new TypeError('ORM Underscore values must return an array');
  return arguments_[0];
}

function isEnumList(input: unknown): input is ArrayLike<unknown> {
  return Array.isArray(input) || (ArrayBuffer.isView(input) && 'length' in input);
}

function originalEnumValues(input: unknown): string[] {
  if (!isEnumList(input)) throw new TypeError('PostgreSQL enum constructor requires a list');
  const length = input.length;
  const values: string[] = [];
  for (let index = 0; index < length; index += 1) values.push([input[index]].join(''));
  return length === 0 ? [''] : values;
}

function normalizedEnumValues(definition: SQLColumnDefinition, dialect: string): string[] | undefined {
  if (dialect === 'sqlite3') return;
  if (dialect !== 'postgresql') throw new Error(`Unsupported enum dialect: ${dialect}`);
  const input = definition.values;
  if (!Array.isArray(input)) throw new TypeError('PostgreSQL enum definition requires normalized string values');
  const length = input.length;
  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const value: unknown = input[index];
    if (typeof value !== 'string') throw new TypeError('PostgreSQL enum definition requires normalized string values');
    values.push(value);
  }
  return length === 0 ? [''] : values;
}

function validateEnumHeader(definition: SQLColumnDefinition): void {
  if (!('enumSource' in definition)) return;
  const source = definition.enumSource;
  if (definition.type !== 'enu' || typeof source !== 'object' || source === null || Array.isArray(source) || source.kind !== 'original-schema' || typeof source.field !== 'object' || source.field === null || Array.isArray(source.field)) {
    throw new TypeError('Enum source requires an original schema field');
  }
  if ('values' in definition) throw new TypeError('Enum source and normalized values are mutually exclusive');
}

function enumValues(definition: SQLColumnDefinition, dialect: string): string[] | undefined {
  if (definition.enumSource === undefined) return normalizedEnumValues(definition, dialect);
  const input = originalConstructorArgument(definition.enumSource);
  if (dialect === 'sqlite3') return;
  if (dialect !== 'postgresql') throw new Error(`Unsupported enum dialect: ${dialect}`);
  return originalEnumValues(input);
}

function validateConstructorHeader(definition: SQLColumnDefinition): void {
  if (!('constructorSource' in definition)) return;
  const source = definition.constructorSource;
  if ((definition.type !== 'increments' && definition.type !== 'bigIncrements' && definition.type !== 'dateTime' && definition.type !== 'timestamp') || typeof source !== 'object' || source === null || Array.isArray(source) || source.kind !== 'original-schema' || typeof source.field !== 'object' || source.field === null || Array.isArray(source.field)) {
    throw new TypeError('Constructor source requires an original increment or temporal schema field');
  }
  if (CONSTRUCTOR_OPTIONS.some((key) => key in definition) || 'enumSource' in definition) {
    throw new TypeError('Constructor source and normalized constructor options are mutually exclusive');
  }
}

function temporalOptions(definition: SQLColumnDefinition): Readonly<{ useTz?: boolean; precision?: number }> | undefined {
  if (definition.constructorSource !== undefined) return { useTz: !originalConstructorArgument(definition.constructorSource) };
  return definition.precision === undefined ? undefined : { precision: definition.precision };
}

function addColumn(table: Knex.TableBuilder, definition: SQLColumnDefinition, dialect: string): void {
  const name = requireIdentifier(definition.name, 'Column name');
  let column: Knex.ColumnBuilder;

  switch (definition.type) {
    case 'increments':
      if (definition.constructorSource !== undefined) originalConstructorArgument(definition.constructorSource);
      column = table.increments(name);
      break;
    case 'bigIncrements':
      if (definition.constructorSource !== undefined) originalConstructorArgument(definition.constructorSource);
      column = table.bigIncrements(name);
      break;
    case 'integer':
      column = table.integer(name, definition.length);
      break;
    case 'tinyint':
      column = table.tinyint(name, definition.length);
      break;
    case 'smallint':
      column = table.smallint(name);
      break;
    case 'mediumint':
      column = table.mediumint(name);
      break;
    case 'bigInteger':
      column = table.bigInteger(name);
      break;
    case 'text':
      column = table.text(name, definition.textType);
      break;
    case 'enu': {
      const values = enumValues(definition, dialect);
      column = values === undefined ? table.specificType(name, 'varchar') : table.text(name).checkIn(values);
      break;
    }
    case 'string':
      column = table.string(name, definition.length);
      break;
    case 'float':
      column = table.float(name, definition.precision, definition.scale);
      break;
    case 'double':
      column = table.double(name);
      break;
    case 'decimal':
      column = table.decimal(name, definition.precision, definition.scale);
      break;
    case 'boolean':
      column = table.boolean(name);
      break;
    case 'date':
      column = table.date(name);
      break;
    case 'time':
      column = table.time(name);
      break;
    case 'dateTime':
      column = table.dateTime(name, temporalOptions(definition));
      break;
    case 'timestamp':
      column = table.timestamp(name, temporalOptions(definition));
      break;
    case 'binary':
      column = table.binary(name, definition.length);
      break;
    case 'json':
      column = table.json(name);
      break;
    case 'uuid':
      column = table.uuid(name);
      break;
  }

  if (definition.nullable === true) column.nullable();
  if (definition.nullable === false) column.notNullable();
  if (definition.primary && definition.type !== 'increments' && definition.type !== 'bigIncrements') column.primary();
  if (definition.indexed) column.index();
  if (definition.unique) column.unique();
}

export function validateDefinitions(definitions: readonly SQLColumnDefinition[], dialect?: string): void {
  const names = new Set<string>();
  for (const definition of definitions) {
    const name = requireIdentifier(definition.name, 'Column name');
    if (names.has(name)) throw new Error(`Duplicate column definition: ${name}`);
    names.add(name);
    validateEnumHeader(definition);
    validateConstructorHeader(definition);
    if (definition.type === 'enu' && dialect !== undefined) {
      if (dialect !== 'sqlite3' && dialect !== 'postgresql') throw new Error(`Unsupported enum dialect: ${dialect}`);
      if (definition.enumSource === undefined) normalizedEnumValues(definition, dialect);
    }
  }
}

export default class SQLSchema {
  readonly table: string;

  private readonly database: Knex;
  private ensurePromise?: Promise<void>;
  private resetPromise?: Promise<void>;

  constructor(database: Knex, table: string) {
    this.database = database;
    this.table = requireIdentifier(table, 'Table name');
  }

  ensureSchema(definitions: readonly SQLColumnDefinition[]): Promise<void>;
  ensureSchema(definitions: readonly SQLColumnDefinition[], callback: ErrorCallback): void;
  ensureSchema(definitions: readonly SQLColumnDefinition[], callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => {
      validateDefinitions(definitions, this.database.client.dialect);
      this.ensurePromise ??= this.ensureOperation(definitions).finally(() => {
        this.ensurePromise = undefined;
      });
      return this.ensurePromise;
    });
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  resetSchema(definitions: readonly SQLColumnDefinition[]): Promise<void>;
  resetSchema(definitions: readonly SQLColumnDefinition[], callback: ErrorCallback): void;
  resetSchema(definitions: readonly SQLColumnDefinition[], callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => {
      validateDefinitions(definitions, this.database.client.dialect);
      this.resetPromise ??= this.database.schema
        .dropTableIfExists(this.table)
        .then(() => this.ensureOperation(definitions))
        .finally(() => {
          this.resetPromise = undefined;
        });
      return this.resetPromise;
    });
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  ensureOwnedSchema(definitions: readonly SQLColumnDefinition[], beforeDDL: () => void): Promise<void> {
    validateDefinitions(definitions, this.database.client.dialect);
    return this.ensureOperation(definitions, beforeDDL);
  }

  dropOwnedTableIfExists(beforeDDL: () => void): Promise<void> {
    return Promise.resolve().then(() => {
      beforeDDL();
      return this.database.schema.dropTableIfExists(this.table);
    });
  }

  hasTable(): Promise<boolean>;
  hasTable(callback: ResultCallback<boolean>): void;
  hasTable(callback?: ResultCallback<boolean>): Promise<boolean> | void {
    const worker = operationWorker(() => this.database.schema.hasTable(this.table));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  hasColumn(column: string): Promise<boolean>;
  hasColumn(column: string, callback: ResultCallback<boolean>): void;
  hasColumn(column: string, callback?: ResultCallback<boolean>): Promise<boolean> | void {
    const worker = operationWorker(() => this.database.schema.hasColumn(this.table, requireIdentifier(column, 'Column name')));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  dropTable(): Promise<void>;
  dropTable(callback: ErrorCallback): void;
  dropTable(callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => this.database.schema.dropTable(this.table));
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  dropTableIfExists(): Promise<void>;
  dropTableIfExists(callback: ErrorCallback): void;
  dropTableIfExists(callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => this.database.schema.dropTableIfExists(this.table));
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  renameTable(to: string): Promise<void>;
  renameTable(to: string, callback: ErrorCallback): void;
  renameTable(to: string, callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => this.database.schema.renameTable(this.table, requireIdentifier(to, 'Table name')));
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  private async ensureOperation(definitions: readonly SQLColumnDefinition[], beforeDDL?: () => void): Promise<void> {
    const tableExists = await this.database.schema.hasTable(this.table);
    if (!tableExists) {
      beforeDDL?.();
      await this.database.schema.createTable(this.table, (table) => {
        for (const definition of definitions) addColumn(table, definition, this.database.client.dialect);
      });
      return;
    }

    const presence = await Promise.all(
      definitions.map(async (definition) => ({
        definition,
        exists: await this.database.schema.hasColumn(this.table, definition.name),
      }))
    );
    const missing = presence.filter(({ exists }) => !exists).map(({ definition }) => definition);
    if (missing.length === 0) return;

    beforeDDL?.();
    await this.database.schema.alterTable(this.table, (table) => {
      for (const definition of missing) addColumn(table, definition, this.database.client.dialect);
    });
  }
}
