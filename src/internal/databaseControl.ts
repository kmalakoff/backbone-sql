import type { SchemaInstance } from 'backbone-orm';

import type { SQLDatabaseControl, SQLSchemaControlOptions } from '../types.ts';
import type SQLQuery from './query.ts';
import type SQLSchema from './schema.ts';
import type { SchemaTraversal } from './schemaTraversal.ts';
import { operationWorker, runCallbackThenable, runErrorWorker } from './settle.ts';
import type { ErrorCallback, SQLColumnDefinition, SQLConnection } from './types.ts';

export async function ensureConfiguredTable(schema: SQLSchema, definitions: readonly SQLColumnDefinition[], options: SQLSchemaControlOptions, ormSchema?: Pick<SchemaInstance, 'fields' | 'relations'>, beforeDDL?: () => void): Promise<void> {
  if (options.verbose) {
    const exists = await schema.hasTable();
    console.log(`Ensuring table: ${schema.table} (exists: ${exists}) with fields: '${Object.keys(ormSchema?.fields ?? {}).join(', ')}' and relations: '${Object.keys(ormSchema?.relations ?? {}).join(', ')}'`);
  }
  if (beforeDDL) await schema.ensureOwnedSchema(definitions, beforeDDL);
  else await schema.ensureSchema(definitions);
}

export function createDatabaseControl<Connection extends SQLConnection>(
  connection: Connection,
  query: SQLQuery,
  schema: SQLSchema,
  definitions: () => readonly SQLColumnDefinition[],
  traversal: SchemaTraversal,
  ormSchema?: Pick<SchemaInstance, 'fields' | 'relations'>,
  beforeDDL?: () => void
): SQLDatabaseControl<Connection> {
  function ensureSchema(callback: ErrorCallback): void;
  function ensureSchema(options: SQLSchemaControlOptions, callback: ErrorCallback): void;
  function ensureSchema(optionsOrCallback: SQLSchemaControlOptions | ErrorCallback, callback?: ErrorCallback): void {
    const notify = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (typeof notify !== 'function') throw new Error('ensureSchema requires a callback');
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    runErrorWorker(
      operationWorker(() => traversal('ensure', options)),
      notify
    );
  }
  function resetSchema(callback: ErrorCallback): void;
  function resetSchema(options: SQLSchemaControlOptions, callback: ErrorCallback): void;
  function resetSchema(optionsOrCallback: SQLSchemaControlOptions | ErrorCallback, callback?: ErrorCallback): void {
    const notify = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (typeof notify !== 'function') throw new Error('resetSchema requires a callback');
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    runErrorWorker(
      operationWorker(() => traversal('reset', options)),
      notify
    );
  }
  return {
    connection,
    query,
    schema,
    ensureSchema,
    resetSchema,
    createOrUpdateTable: (options, callback) => {
      runErrorWorker(
        operationWorker(() => ensureConfiguredTable(schema, definitions(), options, ormSchema, beforeDDL)),
        callback
      );
    },
    dropTable: (callback) =>
      runCallbackThenable(
        operationWorker(() => schema.dropTable()),
        callback
      ),
    dropTableIfExists: (callback) =>
      runCallbackThenable(
        operationWorker(() => schema.dropTableIfExists()),
        callback
      ),
    hasColumn: (column, callback) =>
      runCallbackThenable(
        operationWorker(() => schema.hasColumn(column)),
        callback
      ),
    hasTable: (callback) =>
      runCallbackThenable(
        operationWorker(() => schema.hasTable()),
        callback
      ),
    renameTable: (to, callback) =>
      runCallbackThenable(
        operationWorker(() => schema.renameTable(to)),
        callback
      ),
  };
}
