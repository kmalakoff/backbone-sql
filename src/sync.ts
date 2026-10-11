import type Backbone from 'backbone';
import BackboneORM, { type AdapterSync, type CollectionConstructor, type ModelConstructor, type ModelSync, type SchemaInstance } from 'backbone-orm';

import SQLiteAdapterCursor from './adapterCursor.ts';
import { BackboneSQLiteSync } from './internal/backbone.ts';
import { PostgreSQLConnectionPool, requireOpenSQLConnection, SQLiteConnectionPool } from './internal/connection.ts';
import { isPostgreSQLURL, resolvePostgreSQLTarget } from './internal/postgresURL.ts';
import type SQLQuery from './internal/query.ts';
import { isSQLiteManyToManyRelation, requireSQLRelation } from './internal/relations.ts';
import { runSchemaTraversal, type SchemaTraversal, type SQLiteSchemaNode } from './internal/schemaTraversal.ts';
import type { ErrorCallback, SQLConnection, SQLConnectionPool } from './internal/types.ts';
import { requireSQLProtocol, resolveSQLiteTarget } from './internal/url.ts';
import { postgreSQLColumnDefinitions, sqliteColumnDefinitions } from './schemaDefinitions.ts';
import type { SQLDatabaseControl } from './types.ts';

export interface SQLSyncOptions {
  filename?: string;
  slaves?: readonly string[];
}

export interface SQLCapabilities {
  dynamic: false;
  embed: false;
  json: false;
  manual_ids: false;
  self_reference: false;
  unique: false;
}

export interface SQLSyncFactory {
  <M extends Backbone.Model>(modelType: ModelConstructor<M>, options?: SQLSyncOptions): ModelSync;
  <C extends Backbone.Collection>(collectionType: CollectionConstructor<C>, options?: SQLSyncOptions): Backbone.Collection['sync'];
  capabilities(url?: string): SQLCapabilities | Record<string, never>;
}

const SQLITE_CAPABILITIES: SQLCapabilities = {
  dynamic: false,
  embed: false,
  json: false,
  manual_ids: false,
  self_reference: false,
  unique: false,
};

const connectionPool = new SQLiteConnectionPool(BackboneORM.ConnectionPool, { DatabaseURL: BackboneORM.DatabaseURL });
const postgreSQLConnectionPool = new PostgreSQLConnectionPool(BackboneORM.ConnectionPool, { DatabaseURL: BackboneORM.DatabaseURL });

interface SQLiteModelRegistration {
  connection: SQLConnection;
  implementation: BackboneSQLiteSync<SQLConnection>;
  ormSchema: SchemaInstance;
  query: SQLQuery;
  schemaAccessor?: unknown;
  sync: ModelSync;
  url: string;
}

type SQLiteModelRegistry = WeakMap<ModelConstructor<Backbone.Model>, SQLiteModelRegistration>;

const SQLITE_MODEL_REGISTRY_KEY = Symbol.for('backbone-sql.sqlite-model-registry.v1');

function isSQLiteModelRegistry(value: unknown): value is SQLiteModelRegistry {
  return value instanceof WeakMap;
}

function sharedSQLiteModelRegistry(): SQLiteModelRegistry {
  const existing: unknown = Reflect.get(globalThis, SQLITE_MODEL_REGISTRY_KEY);
  if (existing !== undefined) {
    if (!isSQLiteModelRegistry(existing)) throw new Error('Invalid shared SQLite model registry');
    return existing;
  }

  const registry: SQLiteModelRegistry = new WeakMap();
  Object.defineProperty(globalThis, SQLITE_MODEL_REGISTRY_KEY, { value: registry });
  return registry;
}

const sqliteModels = sharedSQLiteModelRegistry();

function ownDataValue(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function registeredSchemaAuthority(modelType: ModelConstructor<Backbone.Model>): SchemaInstance | undefined {
  const registration = sqliteModels.get(modelType);
  if (!registration || typeof registration.schemaAccessor !== 'function') return undefined;
  if (ownDataValue(modelType.prototype, 'sync') !== registration.sync) return undefined;
  if (ownDataValue(modelType, 'schema') !== registration.schemaAccessor || ownDataValue(modelType.prototype, 'schema') !== registration.schemaAccessor) return undefined;
  return registration.ormSchema;
}

function modelURL(modelType: ModelConstructor<Backbone.Model>): string {
  const value: unknown = new modelType().url();
  if (typeof value !== 'string' || value.length === 0) throw new Error('Missing url for model');
  return value;
}

function isModelConstructor(value: unknown): value is ModelConstructor<Backbone.Model> {
  if (typeof value !== 'function') return false;
  const prototype: unknown = Reflect.get(value, 'prototype');
  return typeof prototype === 'object' && prototype !== null && typeof Reflect.get(prototype, 'toJSON') === 'function';
}

function isCollectionConstructor(value: ModelConstructor<Backbone.Model> | CollectionConstructor<Backbone.Collection>): value is CollectionConstructor<Backbone.Collection> {
  return Boolean(BackboneORM.Utils.isCollection(new value()));
}

function createModelSync(modelType: ModelConstructor<Backbone.Model>, options: SQLSyncOptions): ModelSync {
  const url = modelURL(modelType);
  requireSQLProtocol(url);
  const postgreSQL = isPostgreSQLURL(url);
  // Validate supported PostgreSQL input before the ORM name helper parses its secret-bearing URL.
  const postgreSQLTarget = postgreSQL ? resolvePostgreSQLTarget(url, BackboneORM.DatabaseURL) : undefined;
  modelType.model_name = BackboneORM.Utils.findOrGenerateModelName(modelType);
  if (options.slaves && options.slaves.length > 0) throw new Error(`${postgreSQL ? 'PostgreSQL' : 'SQLite'} slave connections are not implemented`);
  if (postgreSQL && options.filename !== undefined) throw new Error('PostgreSQL does not accept a SQLite filename option');
  const target = postgreSQLTarget ?? resolveSQLiteTarget(url, BackboneORM.DatabaseURL, options);
  if (!target.table) throw new Error(`Missing table in SQLite model URL: ${url}`);
  const ownedPool: SQLConnectionPool = postgreSQL ? postgreSQLConnectionPool : connectionPool;
  const connection: SQLConnection = postgreSQL ? postgreSQLConnectionPool.connect(url) : connectionPool.connect(url, options);
  const diagnosticURL = postgreSQL ? `${connection.url}/${target.table}` : url;
  const dialect = postgreSQL ? 'PostgreSQL' : 'SQLite';
  const ormSchema = registeredSchemaAuthority(modelType) ?? new BackboneORM.Schema(modelType, { id: { type: 'Integer' } });
  const relatedRegistration = (relatedModelType: ModelConstructor<Backbone.Model>): SQLiteModelRegistration => {
    const related = sqliteModels.get(relatedModelType);
    const relatedName = relatedModelType.model_name ?? relatedModelType.name;
    if (!related) throw new Error(`${dialect} related model is not configured by this adapter: ${relatedName}`);
    if (relatedModelType.prototype.sync !== related.sync) {
      throw new Error(`${dialect} related model is no longer configured by this adapter: ${related.url}`);
    }
    if (related.connection !== connection) {
      throw new Error(`${dialect} cross-database relations are not implemented: ${diagnosticURL} -> ${related.url}`);
    }
    if (postgreSQL) {
      requireOpenSQLConnection(connection);
      if (ownedPool.get(connection.url) !== connection) throw new Error(`PostgreSQL connection is closed: ${connection.url}`);
    }
    return related;
  };
  const verifyPostgreSQLGraph = (): void => {
    if (relatedRegistration(modelType).implementation !== implementation) throw new Error(`PostgreSQL schema sync was replaced: ${diagnosticURL}`);
    const visited = new Set<SchemaInstance>();
    const visit = (schema: SchemaInstance): void => {
      if (visited.has(schema)) return;
      visited.add(schema);
      for (const key of Object.keys(schema.relations)) {
        const relation = requireSQLRelation(schema, key, 'PostgreSQL');
        visit(relatedRegistration(relation.reverse_model_type).ormSchema);
        if (isSQLiteManyToManyRelation(relation)) visit(relatedRegistration(relation.join_table).ormSchema);
      }
    };
    visit(ormSchema);
  };
  const schemaTraversal: SchemaTraversal = (mode, options) =>
    runSchemaTraversal(connection, mode, options, () => {
      if (postgreSQL) verifyPostgreSQLGraph();
      const nodes = new Map<ModelConstructor<Backbone.Model>, SQLiteSchemaNode>();
      const visit = (type: ModelConstructor<Backbone.Model>): SQLiteSchemaNode => {
        const existing = nodes.get(type);
        if (existing) return existing;
        const registration = relatedRegistration(type);
        if (type === modelType && registration.implementation !== implementation) throw new Error(`SQLite schema sync was replaced: ${diagnosticURL}`);
        const node: SQLiteSchemaNode = {
          definitions: registration.implementation.configuredColumnDefinitions(),
          joins: [],
          ormSchema: registration.ormSchema,
          schema: registration.implementation.db().schema,
          verify: () => {
            if (postgreSQL) verifyPostgreSQLGraph();
            if (ownedPool.get(connection.url) !== connection) throw new Error(`${postgreSQL ? 'PostgreSQL' : 'SQLite'} connection is closed: ${connection.url}`);
            if (relatedRegistration(type) !== registration) throw new Error(`SQLite schema sync was replaced: ${registration.url}`);
          },
        };
        nodes.set(type, node);
        for (const join of registration.ormSchema.joinTables()) node.joins.push(visit(join));
        return node;
      };
      return visit(modelType);
    });
  const relatedSQLQuery = (relatedModelType: ModelConstructor<Backbone.Model>): SQLQuery => relatedRegistration(relatedModelType).query;
  const implementation: BackboneSQLiteSync<SQLConnection> = new BackboneSQLiteSync(
    modelType,
    connection,
    ownedPool,
    target.table,
    BackboneORM.Utils,
    ormSchema,
    [],
    schemaTraversal,
    (query) => new SQLiteAdapterCursor(query, implementation.db().query, modelType, relatedSQLQuery, implementation.configuredColumnAliases(), dialect),
    postgreSQL ? verifyPostgreSQLGraph : undefined
  );

  function adapter(method: 'cursor', query?: unknown): SQLiteAdapterCursor;
  function adapter(method: 'db'): SQLDatabaseControl<SQLConnection>;
  function adapter(method: 'schema'): SchemaInstance;
  function adapter(method: 'tableName'): string;
  function adapter(method: 'isRemote'): false;
  function adapter(method: 'resetSchema', controlOptions: object, callback: ErrorCallback): unknown;
  function adapter(method: 'destroy', query: unknown, callback: ErrorCallback): unknown;
  function adapter(method: string, targetValue?: unknown, optionsValue?: unknown): unknown;
  function adapter(method: string, targetValue?: unknown, optionsValue?: unknown): unknown {
    if (method === 'createSync') {
      if (!isModelConstructor(targetValue)) throw new Error('createSync requires a Backbone model constructor');
      return sync(targetValue, options);
    }
    if (method === 'cursor') {
      return new SQLiteAdapterCursor(targetValue, implementation.db().query, modelType, relatedSQLQuery, implementation.configuredColumnAliases(), dialect);
    }
    return implementation.adapter(method, targetValue, optionsValue);
  }

  const adapterContract: AdapterSync<SQLiteAdapterCursor, SQLDatabaseControl<SQLConnection>> = adapter;
  Reflect.set(modelType.prototype, 'sync', adapterContract);
  BackboneORM.Utils.configureModelType(modelType);
  const schemaAccessor = ownDataValue(modelType, 'schema');
  const installedSchemaAccessor = typeof schemaAccessor === 'function' && ownDataValue(modelType.prototype, 'schema') === schemaAccessor ? schemaAccessor : undefined;
  ormSchema.initialize();
  implementation.configureColumns(() => (postgreSQL ? postgreSQLColumnDefinitions(ormSchema) : sqliteColumnDefinitions(ormSchema)));
  implementation.configuredColumnDefinitions();
  for (const relation of Object.values(ormSchema.relations)) {
    if (!isSQLiteManyToManyRelation(relation)) continue;
    relatedRegistration(relation.join_table).implementation.configureColumnAliases({
      [relation.foreign_key]: relation.join_key,
      [relation.reverse_relation.foreign_key]: relation.reverse_relation.join_key,
    });
  }

  const configured = BackboneORM.model_cache.configureSync(modelType, modelType.prototype.sync);
  Reflect.set(modelType.prototype, 'sync', configured);
  sqliteModels.set(modelType, { connection, implementation, ormSchema, query: implementation.db().query, schemaAccessor: installedSchemaAccessor, sync: configured, url: diagnosticURL });
  return configured;
}

function sync<M extends Backbone.Model>(modelType: ModelConstructor<M>, options?: SQLSyncOptions): ModelSync;
function sync<C extends Backbone.Collection>(collectionType: CollectionConstructor<C>, options?: SQLSyncOptions): Backbone.Collection['sync'];
function sync(type: ModelConstructor<Backbone.Model> | CollectionConstructor<Backbone.Collection>, options: SQLSyncOptions = {}): ModelSync | Backbone.Collection['sync'] {
  if (isCollectionConstructor(type)) {
    preflightCollectionURL(type);
    const modelType = BackboneORM.Utils.configureCollectionModelType(type, syncFactory);
    return modelType.prototype.sync;
  }
  return createModelSync(type, options);
}

function preflightCollectionURL(type: CollectionConstructor<Backbone.Collection>): void {
  const modelType = type.prototype.model;
  // Match the ORM's existing route; configured models do not consume the collection URL.
  if (modelType && modelType !== BackboneORM.Backbone.Model && modelType.prototype.sync !== BackboneORM.Backbone.Model.prototype.sync) return;
  const underscore = BackboneORM._;
  if ((typeof underscore !== 'object' && typeof underscore !== 'function') || underscore === null) throw new Error('Missing ORM underscore provider');
  const result: unknown = Reflect.get(underscore, 'result');
  if (typeof result !== 'function') throw new Error('Missing ORM underscore result');
  const url: unknown = Reflect.apply(result, underscore, [type.prototype, 'url']);
  if (typeof url !== 'string' || url.length === 0) throw new Error('Missing url for model');
  requireSQLProtocol(url);
  if (isPostgreSQLURL(url)) resolvePostgreSQLTarget(url, BackboneORM.DatabaseURL);
}

const syncFactory: SQLSyncFactory = Object.assign(sync, {
  capabilities(url?: string): SQLCapabilities | Record<string, never> {
    if (!url) return SQLITE_CAPABILITIES;
    try {
      requireSQLProtocol(url);
      if (isPostgreSQLURL(url)) resolvePostgreSQLTarget(url, BackboneORM.DatabaseURL);
      else resolveSQLiteTarget(url, BackboneORM.DatabaseURL);
      return SQLITE_CAPABILITIES;
    } catch {
      return {};
    }
  },
});

export default syncFactory;
