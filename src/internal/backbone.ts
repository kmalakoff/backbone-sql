import type Backbone from 'backbone';
import type { CursorInstance, PatchRemove, PatchRemoveModelConstructor, RuntimeModelCache, RuntimeUtils, SchemaInstance } from 'backbone-orm';
import { nativeToAttributes } from '../lib/nativeToAttributes.ts';
import { type OrdinaryDestroyQuery, ordinaryDestroyQuery } from '../lib/ordinaryDestroyQuery.ts';
import type { SQLDatabaseControl, SQLSchemaControlOptions } from '../types.ts';
import { requireOpenSQLConnection } from './connection.ts';
import { createDatabaseControl } from './databaseControl.ts';
import SQLQuery from './query.ts';
import SQLSchema from './schema.ts';
import { runSchemaTraversal, type SchemaTraversal, type SQLiteSchemaNode } from './schemaTraversal.ts';
import { operationWorker, runErrorWorker, runWorker, toError } from './settle.ts';
import type { ErrorCallback, OwnedSQLConnection, ResultCallback, SQLColumnDefinition, SQLConnection, SQLConnectionPool, SQLRow, SQLSelectOptions, SQLWhere } from './types.ts';

const CURSOR_KEYS = new Set(['$count', '$exists', '$ids', '$limit', '$offset', '$one', '$or', '$select', '$sort', '$unique', '$values']);

type ColumnDefinitions = readonly SQLColumnDefinition[] | (() => readonly SQLColumnDefinition[]);

export interface SQLiteModelConstructor {
  new (...arguments_: never[]): Backbone.Model;
  prototype: Backbone.Model;
  schema?(): SchemaInstance | undefined;
}

export interface SQLiteCollectionConstructor<C extends Backbone.Collection = Backbone.Collection> {
  new (...arguments_: never[]): C;
  prototype: C;
}

export type SQLiteCursorQuery = Record<string, unknown>;
export type SQLiteCursorJSON = SQLRow[] | SQLRow | null | number | boolean;
export type SQLiteCursorModels = Backbone.Model[] | Backbone.Model | null;

interface ParsedCursor {
  count: boolean;
  exists: boolean;
  one: boolean;
  options: SQLSelectOptions;
}

type DestroyCursorFactory = (query: OrdinaryDestroyQuery) => Pick<CursorInstance, 'toJSON'>;

interface BackboneSyncOptions {
  error?(error: Error): unknown;
  query?: SQLiteCursorQuery;
  success?(value?: unknown): unknown;
}

export interface SQLiteORMSchema {
  fields?: SchemaInstance['fields'];
  initialize(): void;
  joinTables(): SQLiteModelConstructor[];
  relations?: SchemaInstance['relations'];
}

export type { SQLiteDatabaseControl } from '../types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireDestroyRows(value: unknown, idAttribute: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('SQLite destroy selection must return ordinary object rows');
  const rows: Record<string, unknown>[] = [];
  for (const row of value) {
    if (!isRecord(row)) throw new Error('SQLite destroy selection must return ordinary object rows');
    const id = row[idAttribute];
    if (!((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.length > 0))) {
      throw new Error(`SQLite destroy selection has an invalid ${idAttribute}; no rows were deleted`);
    }
    rows.push(row);
  }
  return rows;
}

function isBackboneModel(value: unknown): value is Backbone.Model {
  return isRecord(value) && typeof Reflect.get(value, 'toJSON') === 'function' && !Array.isArray(Reflect.get(value, 'models'));
}

function isBackboneCollection(value: unknown): value is Backbone.Collection {
  return isRecord(value) && Array.isArray(Reflect.get(value, 'models'));
}

function hasSchemaControl(value: SQLiteModelConstructor): value is SQLiteModelConstructor & PatchRemoveModelConstructor {
  return typeof value.schema === 'function';
}

function requireModel(value: unknown): Backbone.Model {
  if (!isBackboneModel(value)) throw new Error('SQLite sync requires a Backbone model');
  return value;
}

function requireTarget(value: unknown): Backbone.Model | Backbone.Collection {
  if (isBackboneModel(value) || isBackboneCollection(value)) return value;
  throw new Error('SQLite sync requires a Backbone model or collection');
}

function requireOptions(value: unknown): BackboneSyncOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('SQLite sync options must be an object');
  return value;
}

function isErrorCallback(value: unknown): value is ErrorCallback {
  return typeof value === 'function';
}

function requireErrorCallback(value: unknown, method: string): ErrorCallback {
  if (!isErrorCallback(value)) throw new Error(`${method} requires a callback`);
  return value;
}

function requireStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error(`${label} must contain strings`);
    values.push(entry);
  }
  return values;
}

function requireSort(value: unknown): string | string[] {
  if (typeof value === 'string') return value;
  return requireStringList(value, '$sort');
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`);
  return value;
}

function requireWhereList(value: unknown): SQLWhere[] {
  if (!Array.isArray(value)) throw new Error('$or must be an array');
  const values: SQLWhere[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error('$or must contain query objects');
    values.push(entry);
  }
  return values;
}

function parseCursor(query: SQLiteCursorQuery): ParsedCursor {
  const where: SQLWhere = {};
  for (const [key, value] of Object.entries(query)) {
    if (!CURSOR_KEYS.has(key)) where[key] = value;
  }

  const options: SQLSelectOptions = { where };
  if (query.$ids !== undefined) {
    if (!Array.isArray(query.$ids)) throw new Error('$ids must be an array');
    options.ids = query.$ids;
  }
  if (query.$limit !== undefined) options.limit = requireNumber(query.$limit, '$limit');
  if (query.$offset !== undefined) options.offset = requireNumber(query.$offset, '$offset');
  if (query.$or !== undefined) options.or = requireWhereList(query.$or).map((where) => ({ where }));
  if (query.$select !== undefined) options.columns = requireStringList(query.$select, '$select');
  else if (query.$values !== undefined) options.columns = requireStringList(query.$values, '$values');
  if (query.$sort !== undefined) options.sort = requireSort(query.$sort);
  if (query.$unique !== undefined) options.unique = requireStringList(query.$unique, '$unique');

  return {
    count: query.$count === true,
    exists: query.$exists === true,
    one: query.$one === true,
    options,
  };
}

function copyModelJSON(model: Backbone.Model): Record<string, unknown> {
  const value: unknown = model.toJSON();
  if (!isRecord(value)) throw new Error('Backbone model JSON must be an object');
  return { ...value };
}

export class SQLiteCursor {
  private readonly modelType: SQLiteModelConstructor;
  private query: SQLiteCursorQuery;
  private readonly runtimeUtils: object;
  private readonly table: SQLQuery;

  constructor(query: SQLiteCursorQuery, table: SQLQuery, modelType: SQLiteModelConstructor, runtimeUtils: object) {
    this.query = { ...query };
    this.table = table;
    this.modelType = modelType;
    this.runtimeUtils = runtimeUtils;
  }

  limit(value: number): this {
    this.query = { ...this.query, $limit: value };
    return this;
  }

  count(): Promise<number>;
  count(callback: ResultCallback<number>): void;
  count(callback?: ResultCallback<number>): Promise<number> | void {
    const worker = operationWorker(() => this.table.count(parseCursor(this.query).options));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  exists(): Promise<boolean>;
  exists(callback: ResultCallback<boolean>): void;
  exists(callback?: ResultCallback<boolean>): Promise<boolean> | void {
    const worker = operationWorker(() => this.table.exists(parseCursor(this.query).options));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  toJSON(): Promise<SQLiteCursorJSON>;
  toJSON(callback: ResultCallback<SQLiteCursorJSON>): void;
  toJSON(callback?: ResultCallback<SQLiteCursorJSON>): Promise<SQLiteCursorJSON> | void {
    const worker = operationWorker(() => this.toJSONOperation());
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  toModels(): Promise<SQLiteCursorModels>;
  toModels(callback: ResultCallback<SQLiteCursorModels>): void;
  toModels(callback?: ResultCallback<SQLiteCursorModels>): Promise<SQLiteCursorModels> | void {
    const worker = operationWorker(async () => {
      const json = await this.toJSONOperation();
      if (json === null) return null;
      if (Array.isArray(json)) return json.map((row) => this.createModel(row));
      if (typeof json === 'boolean' || typeof json === 'number') throw new Error('Count and exists cursors cannot create models');
      return this.createModel(json);
    });
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  private async toJSONOperation(): Promise<SQLiteCursorJSON> {
    const parsed = parseCursor(this.query);
    if (parsed.count) return this.table.count(parsed.options);
    if (parsed.exists) return this.table.exists(parsed.options);
    const options = parsed.one ? { ...parsed.options, limit: 1 } : parsed.options;
    const rows = await this.table.select(options);
    const schema = this.modelType.schema?.();
    for (const row of rows) nativeToAttributes(row, schema);
    return parsed.one ? (rows[0] ?? null) : rows;
  }

  private createModel(attributes: SQLRow): Backbone.Model {
    const updateOrNew: unknown = Reflect.get(this.runtimeUtils, 'updateOrNew');
    if (typeof updateOrNew !== 'function') throw new Error('backbone-orm Utils.updateOrNew must be a function');
    const model: unknown = Reflect.apply(updateOrNew, this.runtimeUtils, [attributes, this.modelType]);
    if (!isBackboneModel(model)) throw new Error('SQLite cursor model constructor did not create a Backbone model');
    return model;
  }
}

export class BackboneSQLiteSync<Connection extends SQLConnection = OwnedSQLConnection> {
  readonly table: string;

  private readonly columnAliases: Record<string, string> = {};
  private readonly beforeMutation?: () => void;
  private columnDefinitions: ColumnDefinitions;
  private readonly connection: Connection;
  private readonly connectionPool: SQLConnectionPool<Connection>;
  private readonly databaseControl: SQLDatabaseControl<Connection>;
  private readonly destroyCursor: DestroyCursorFactory;
  private readonly modelType: SQLiteModelConstructor;
  private readonly query: SQLQuery;
  private readonly patchRemove: PatchRemove;
  private readonly runtimeUtils: RuntimeUtils;
  private readonly schemaTraversal: SchemaTraversal;
  private readonly ormSchema?: SQLiteORMSchema;
  private readonly sqlSchema: SQLSchema;

  constructor(
    modelType: SQLiteModelConstructor,
    connection: Connection,
    connectionPool: SQLConnectionPool<Connection>,
    table: string,
    runtimeUtils: RuntimeUtils,
    ormSchema?: SQLiteORMSchema,
    columnDefinitions: ColumnDefinitions = [],
    schemaTraversal?: SchemaTraversal,
    destroyCursor?: DestroyCursorFactory,
    beforeMutation?: () => void
  ) {
    this.beforeMutation = beforeMutation;
    this.columnDefinitions = columnDefinitions;
    this.connection = connection;
    this.connectionPool = connectionPool;
    this.modelType = modelType;
    this.query = new SQLQuery(connection.knex(), table);
    this.ormSchema = ormSchema;
    this.patchRemove = runtimeUtils.patchRemove;
    this.runtimeUtils = runtimeUtils;
    this.destroyCursor = destroyCursor ?? ((query) => this.cursor({ ...query.find, ...query.cursor }));
    this.sqlSchema = new SQLSchema(connection.knex(), table);
    this.schemaTraversal =
      schemaTraversal ??
      ((mode, options) =>
        runSchemaTraversal(connection, mode, options, () => {
          const node: SQLiteSchemaNode = {
            definitions: this.configuredColumnDefinitions(),
            joins: [],
            ormSchema: { fields: ormSchema?.fields ?? {}, relations: ormSchema?.relations ?? {} },
            schema: this.sqlSchema,
            verify: () => {
              requireOpenSQLConnection(connection);
              if (connectionPool.get(connection.url) !== connection) throw new Error(`SQLite connection is closed: ${connection.url}`);
              if (ormSchema && ormSchema.joinTables().length > 0) throw new Error('SQLite schema traversal requires the owned join registry');
            },
          };
          return node;
        }));
    this.databaseControl = createDatabaseControl(
      connection,
      this.query,
      this.sqlSchema,
      () => {
        this.beforeMutation?.();
        return this.configuredColumnDefinitions();
      },
      this.schemaTraversal,
      { fields: ormSchema?.fields ?? {}, relations: ormSchema?.relations ?? {} },
      this.beforeMutation
    );
    this.table = this.query.table;
  }

  install(modelCache: RuntimeModelCache): void {
    this.ormSchema?.initialize();
    Reflect.set(this.modelType.prototype, 'sync', (method: string, target?: unknown, options?: unknown) => this.dispatch(method, target, options));
    Reflect.set(this.modelType.prototype, 'sync', modelCache.configureSync(this.modelType, this.modelType.prototype.sync));
  }

  installCollection<C extends Backbone.Collection>(collectionType: SQLiteCollectionConstructor<C>): void {
    Reflect.set(collectionType.prototype, 'sync', (method: string, target?: unknown, options?: unknown) => this.dispatch(method, target, options));
  }

  cursor(query: SQLiteCursorQuery = {}): SQLiteCursor {
    return new SQLiteCursor(query, this.query, this.modelType, this.runtimeUtils);
  }

  db(): SQLDatabaseControl<Connection> {
    return this.databaseControl;
  }

  closeConnection(): Promise<void>;
  closeConnection(callback: ErrorCallback): void;
  closeConnection(callback?: ErrorCallback): Promise<void> | void {
    return callback ? this.connectionPool.closeConnection(this.connection.url, callback) : this.connectionPool.closeConnection(this.connection.url);
  }

  configureColumns(columnDefinitions: ColumnDefinitions): void {
    this.columnDefinitions = columnDefinitions;
  }

  configureColumnAliases(aliases: Readonly<Record<string, string>>): void {
    Object.assign(this.columnAliases, aliases);
  }

  configuredColumnAliases(): Readonly<Record<string, string>> {
    return this.columnAliases;
  }

  configuredColumnDefinitions(): readonly SQLColumnDefinition[] {
    return typeof this.columnDefinitions === 'function' ? this.columnDefinitions() : this.columnDefinitions;
  }

  resetOwnedSchema(): Promise<void> {
    return this.schemaTraversal('reset', {});
  }

  adapter(method: string, target?: unknown, options?: unknown): unknown {
    return this.dispatch(method, target, options);
  }

  private dispatch(method: string, target: unknown, optionsValue: unknown): unknown {
    if (method === 'cursor') return this.cursor(target === undefined ? {} : this.requireCursorQuery(target));
    if (method === 'sync') return this;
    if (method === 'db') return this.db();
    if (method === 'schema') return this.ormSchema;
    if (method === 'tableName') return this.table;
    if (method === 'isRemote') return false;
    if (method === 'closeConnection') {
      if (target === undefined) return this.closeConnection();
      return this.closeConnection(requireErrorCallback(target, method));
    }
    if (method === 'resetSchema') return this.resetSchema(target, requireErrorCallback(optionsValue, method));
    if (method === 'destroy') return this.destroy(this.requireCursorQuery(target), requireErrorCallback(optionsValue, method));

    const options = requireOptions(optionsValue);
    if (method === 'read') return this.read(requireTarget(target), options);
    if (method === 'create') return this.create(requireModel(target), options);
    if (method === 'update' || method === 'patch') return this.update(requireModel(target), options);
    if (method === 'delete') return this.delete(requireModel(target), options);
    return undefined;
  }

  private requireCursorQuery(value: unknown): SQLiteCursorQuery {
    if (!isRecord(value)) throw new Error('SQLite cursor query must be an object');
    return value;
  }

  private read(target: Backbone.Model | Backbone.Collection, options: BackboneSyncOptions): Promise<void> {
    if (isBackboneCollection(target)) {
      return this.finish(this.cursor(options.query).toJSON(), options);
    }
    if (target.id === undefined || target.id === null) return this.finish(Promise.reject(new Error('Cannot read a model without an id')), options);
    const operation = this.query.select({ limit: 1, where: { [target.idAttribute]: target.id } }).then((rows) => {
      const row = rows[0];
      if (!row) throw new Error(`Model not found. Id ${target.id}`);
      nativeToAttributes(row, this.modelType.schema?.());
      return row;
    });
    return this.finish(operation, options);
  }

  private create(model: Backbone.Model, options: BackboneSyncOptions): Promise<void> {
    const operation = this.mutation(() => {
      const json = this.databaseJSON(model);
      const idAttribute = model.idAttribute;
      if (json[idAttribute] === undefined || json[idAttribute] === null) delete json[idAttribute];
      return this.query.insert(json, idAttribute).then((id) => {
        json[idAttribute] = id;
        return json;
      });
    });
    return this.finish(operation, options);
  }

  private update(model: Backbone.Model, options: BackboneSyncOptions): Promise<void> {
    if (model.id === undefined || model.id === null) return this.finish(Promise.reject(new Error('Cannot update a model without an id')), options);
    const operation = this.mutation(() => {
      const json = this.databaseJSON(model);
      return this.query.update({ [model.idAttribute]: model.id }, json).then((updated) => {
        if (updated === 0) throw new Error(`Model not found. Id ${model.id}`);
        return json;
      });
    });
    return this.finish(operation, options);
  }

  private delete(model: Backbone.Model, options: BackboneSyncOptions): Promise<void> {
    if (model.id === undefined || model.id === null) return this.finish(Promise.reject(new Error('Cannot delete a model without an id')), options);
    const operation = this.mutation(() => this.query.delete({ [model.idAttribute]: model.id })).then(async (deleted) => {
      if (deleted === 0) throw new Error(`Model not found. Id ${model.id}`);
      await this.removeRelations(model);
    });
    return this.finish(operation, options);
  }

  private resetSchema(options: unknown, callback: ErrorCallback): void {
    const worker = operationWorker(() => {
      if (!isRecord(options)) throw new Error('SQLite resetSchema options must be an object');
      if (options.verbose !== undefined && typeof options.verbose !== 'boolean') throw new Error('SQLite schema verbose must be a boolean');
      const schemaOptions: SQLSchemaControlOptions = { verbose: options.verbose };
      return this.schemaTraversal('reset', schemaOptions);
    });
    runErrorWorker(worker, callback);
  }

  private destroy(query: SQLiteCursorQuery, callback: ErrorCallback): void {
    const worker = operationWorker(async () => {
      this.beforeMutation?.();
      const selection = ordinaryDestroyQuery(this.modelType, query);
      const selected = await new Promise<unknown>((resolve, reject) => {
        this.destroyCursor(selection).toJSON((error, value) => (error ? reject(error) : resolve(value)));
      });
      const idAttribute = new this.modelType().idAttribute;
      const rows = requireDestroyRows(selected, idAttribute);
      const schema = this.modelType.schema?.();
      const models = rows.map((row) => {
        nativeToAttributes(row, schema);
        const model = this.runtimeUtils.updateOrNew(row, this.modelType);
        if (!model) throw new Error('SQLite destroy could not create a model for relation cleanup');
        if (model.idAttribute !== idAttribute || model.id !== row[idAttribute]) throw new Error('SQLite destroy model identity differs from the selected row; no rows were deleted');
        return { id: row[idAttribute], model };
      });
      await new Promise<void>((resolve, reject) => {
        this.runtimeUtils.each(
          models,
          ({ id, model }, next) => {
            runErrorWorker(
              operationWorker(async () => {
                this.beforeMutation?.();
                await this.query.delete({ [idAttribute]: id });
                await this.removeRelations(model);
              }),
              next
            );
          },
          (error) => (error ? reject(error) : resolve())
        );
      });
    });
    runErrorWorker(worker, callback);
  }

  private removeRelations(model: Backbone.Model): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!hasSchemaControl(this.modelType)) {
        reject(new Error('SQLite relation cleanup requires the configured Backbone ORM schema control'));
        return;
      }
      this.patchRemove(this.modelType, model, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private mutation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.beforeMutation) return operation();
    return Promise.resolve().then(() => {
      this.beforeMutation?.();
      return operation();
    });
  }

  private databaseJSON(model: Backbone.Model): Record<string, unknown> {
    const json = copyModelJSON(model);
    const definitions = this.configuredColumnDefinitions();
    if (definitions.length === 0) return json;
    const columns = new Set(definitions.map(({ name }) => name));
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json)) {
      if (columns.has(key)) result[key] = value;
    }
    for (const [key, value] of Object.entries(json)) {
      const column = this.columnAliases[key];
      // biome-ignore lint/suspicious/noPrototypeBuiltins: The existing TypeScript library target does not declare Object.hasOwn.
      if (column && columns.has(column) && !Object.prototype.hasOwnProperty.call(result, column)) result[column] = value;
    }
    return result;
  }

  private finish(operation: PromiseLike<unknown>, options: BackboneSyncOptions): Promise<void> {
    const request: Promise<void> = Promise.resolve(operation).then(
      (value) => {
        options.success?.(value);
      },
      (error: unknown) => {
        const operationError = toError(error);
        if (options.error) {
          options.error(operationError);
          // Backbone/ORM can install this notifier without an explicit caller callback.
          // A normally notified failure is observed internally; the same request still rejects.
          void request.catch(() => undefined);
        }
        throw operationError;
      }
    );
    return request;
  }
}
