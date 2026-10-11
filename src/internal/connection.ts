import BackboneORM, { type ConnectionDisposer, type ConnectionPoolInstance, type QueueInstance } from 'backbone-orm';
import knexFactory, { type Knex } from 'knex';
import { resolvePostgreSQLTarget } from './postgresURL.ts';
import { operationWorker, runErrorWorker } from './settle.ts';
import type { ErrorCallback, OwnedPostgreSQLConnection, OwnedSQLConnection, SQLConnection, SQLiteConnectionDependencies, SQLiteConnectionOptions } from './types.ts';
import { resolveSQLiteTarget } from './url.ts';

const SQLITE_CONNECTION_OWNERSHIP_KEY = Symbol.for('backbone-sql.sqlite-connection-ownership.v1');

interface SQLiteConnectionOwnership {
  readonly closingConnections: WeakSet<object>;
  readonly connections: WeakSet<object>;
  readonly disposer: ConnectionDisposer<OwnedSQLConnection>;
  readonly schemaQueues: WeakMap<SQLConnection, QueueInstance>;
}

function isSQLConnection(value: unknown): value is OwnedSQLConnection {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'destroy') === 'function' && typeof Reflect.get(value, 'filename') === 'string' && typeof Reflect.get(value, 'knex') === 'function' && (typeof Reflect.get(value, 'table') === 'string' || Reflect.get(value, 'table') === null) && typeof Reflect.get(value, 'url') === 'string';
}

function isSQLiteConnectionOwnership(value: unknown): value is SQLiteConnectionOwnership {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'connections') instanceof WeakSet && Reflect.get(value, 'closingConnections') instanceof WeakSet && Reflect.get(value, 'schemaQueues') instanceof WeakMap && typeof Reflect.get(value, 'disposer') === 'function';
}

function createSQLiteConnectionOwnership(): SQLiteConnectionOwnership {
  const connections = new WeakSet<object>();
  return {
    closingConnections: new WeakSet(),
    connections,
    schemaQueues: new WeakMap(),
    disposer(connection, callback): void {
      if (!isSQLConnection(connection) || !connections.has(connection)) {
        callback(new Error('SQLite connection disposer received an unowned connection'));
        return;
      }
      connection.destroy(callback);
    },
  };
}

function getSQLiteConnectionOwnership(): SQLiteConnectionOwnership {
  const existing: unknown = Reflect.get(globalThis, SQLITE_CONNECTION_OWNERSHIP_KEY);
  if (existing !== undefined) {
    if (!isSQLiteConnectionOwnership(existing)) throw new Error('Invalid shared SQLite connection ownership state');
    return existing;
  }

  const ownership = createSQLiteConnectionOwnership();
  Object.defineProperty(globalThis, SQLITE_CONNECTION_OWNERSHIP_KEY, { value: ownership });
  return ownership;
}

const sqliteConnectionOwnership = getSQLiteConnectionOwnership();

function isOwnedSQLConnection(value: unknown): value is OwnedSQLConnection {
  return isSQLConnection(value) && sqliteConnectionOwnership.connections.has(value);
}

function connectionOwnership(connection: SQLConnection): SQLiteConnectionOwnership | PostgreSQLConnectionOwnership {
  if (isOwnedSQLConnection(connection)) return sqliteConnectionOwnership;
  if (isOwnedPostgreSQLConnection(connection)) return postgreSQLConnectionOwnership;
  throw new Error('SQLite schema traversal requires an owned connection');
}

export function requireOpenSQLConnection(connection: SQLConnection): void {
  const ownership = connectionOwnership(connection);
  if (ownership.closingConnections.has(connection)) throw new Error(`${ownership === sqliteConnectionOwnership ? 'SQLite' : 'PostgreSQL'} connection is closed: ${connection.url}`);
}

export function scheduleSchemaOperation(connection: SQLConnection, operation: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    requireOpenSQLConnection(connection);
    const ownership = connectionOwnership(connection);
    let queue = ownership.schemaQueues.get(connection);
    if (!queue) {
      queue = new BackboneORM.Queue(1);
      ownership.schemaQueues.set(connection, queue);
    }
    queue.defer((done) => {
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        // Queue errors are sticky; the job's original failure belongs to its own Promise.
        done(null);
      };
      void Promise.resolve()
        .then(() => {
          requireOpenSQLConnection(connection);
          return operation();
        })
        .then(
          () => {
            release();
            resolve();
          },
          (error: unknown) => {
            release();
            reject(error);
          }
        );
    });
  });
}

export class SQLiteConnection implements OwnedSQLConnection {
  readonly filename: string;
  readonly table: string | null;
  readonly url: string;

  private readonly database: Knex;
  private destroyPromise?: Promise<void>;

  constructor(fullURL: string, dependencies: SQLiteConnectionDependencies, options: SQLiteConnectionOptions = {}) {
    const target = resolveSQLiteTarget(fullURL, dependencies.DatabaseURL, options);
    this.filename = target.filename;
    this.table = target.table;
    this.url = target.poolKey;
    this.database = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: this.filename },
      pool: { max: 1, min: 0 },
      useNullAsDefault: true,
    });
    sqliteConnectionOwnership.connections.add(this);
  }

  knex(): Knex {
    return this.database;
  }

  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
  destroy(callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => this.destroyOperation());
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }

  private destroyOperation(): Promise<void> {
    sqliteConnectionOwnership.closingConnections.add(this);
    this.destroyPromise ??= this.database.destroy();
    return this.destroyPromise;
  }
}

export class SQLiteConnectionPool {
  private readonly dependencies: SQLiteConnectionDependencies;
  private readonly pool: ConnectionPoolInstance;

  constructor(pool: ConnectionPoolInstance, dependencies: SQLiteConnectionDependencies) {
    this.dependencies = dependencies;
    this.pool = pool;
  }

  connect(fullURL: string, options: SQLiteConnectionOptions = {}): OwnedSQLConnection {
    const target = resolveSQLiteTarget(fullURL, this.dependencies.DatabaseURL, options);
    const existing = this.get(target.poolKey);
    if (existing) {
      if (existing.filename !== target.filename) {
        throw new Error(`SQLite connection ${target.poolKey} is already registered for a different filename`);
      }
      this.pool.setOwned(target.poolKey, existing, sqliteConnectionOwnership.disposer);
      return existing;
    }

    const connection = new SQLiteConnection(fullURL, this.dependencies, options);
    this.pool.setOwned(connection.url, connection, sqliteConnectionOwnership.disposer);
    return connection;
  }

  get(key: string): OwnedSQLConnection | undefined {
    const connection = this.pool.get(key);
    if (connection === undefined) return;
    if (!isOwnedSQLConnection(connection)) throw new Error(`ConnectionPool entry does not satisfy the SQL connection contract: ${key}`);
    return connection;
  }

  setOwned(connection: OwnedSQLConnection): OwnedSQLConnection {
    if (!isSQLConnection(connection)) throw new Error('Owned SQLite connection does not satisfy the SQL connection contract');
    this.pool.setOwned(connection.url, connection, sqliteConnectionOwnership.disposer);
    sqliteConnectionOwnership.connections.add(connection);
    return connection;
  }

  closeConnection(fullURL: string): Promise<void>;
  closeConnection(fullURL: string, callback: ErrorCallback): void;
  closeConnection(fullURL: string, callback?: ErrorCallback): Promise<void> | void {
    const key = this.pool.get(fullURL) === undefined ? resolveSQLiteTarget(fullURL, this.dependencies.DatabaseURL).poolKey : fullURL;
    return callback ? this.pool.dispose(key, callback) : this.pool.dispose(key);
  }

  disposeAll(): Promise<void>;
  disposeAll(callback: ErrorCallback): void;
  disposeAll(callback?: ErrorCallback): Promise<void> | void {
    return callback ? this.pool.disposeAll(callback) : this.pool.disposeAll();
  }
}

const POSTGRESQL_CONNECTION_OWNERSHIP_KEY = Symbol.for('backbone-sql.postgresql-connection-ownership.v1');

interface PostgreSQLConnectionOwnership {
  readonly closingConnections: WeakSet<object>;
  readonly connections: WeakSet<object>;
  readonly disposer: ConnectionDisposer<OwnedPostgreSQLConnection>;
  readonly schemaQueues: WeakMap<SQLConnection, QueueInstance>;
}

function isPostgreSQLConnectionOwnership(value: unknown): value is PostgreSQLConnectionOwnership {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'connections') instanceof WeakSet && Reflect.get(value, 'closingConnections') instanceof WeakSet && Reflect.get(value, 'schemaQueues') instanceof WeakMap && typeof Reflect.get(value, 'disposer') === 'function';
}

function isPostgreSQLConnection(value: unknown): value is OwnedPostgreSQLConnection {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'databaseName') === 'string' &&
    typeof Reflect.get(value, 'host') === 'string' &&
    typeof Reflect.get(value, 'port') === 'number' &&
    typeof Reflect.get(value, 'destroy') === 'function' &&
    typeof Reflect.get(value, 'knex') === 'function' &&
    typeof Reflect.get(value, 'table') === 'string' &&
    typeof Reflect.get(value, 'url') === 'string'
  );
}

function sharedPostgreSQLConnectionOwnership(): PostgreSQLConnectionOwnership {
  const existing: unknown = Reflect.get(globalThis, POSTGRESQL_CONNECTION_OWNERSHIP_KEY);
  if (existing !== undefined) {
    if (!isPostgreSQLConnectionOwnership(existing)) throw new Error('Invalid shared PostgreSQL connection ownership state');
    return existing;
  }
  const connections = new WeakSet<object>();
  const ownership: PostgreSQLConnectionOwnership = {
    closingConnections: new WeakSet(),
    connections,
    schemaQueues: new WeakMap(),
    disposer(connection, callback): void {
      if (!isPostgreSQLConnection(connection) || !connections.has(connection)) {
        callback(new Error('PostgreSQL connection disposer received an unowned connection'));
        return;
      }
      connection.destroy(callback);
    },
  };
  Object.defineProperty(globalThis, POSTGRESQL_CONNECTION_OWNERSHIP_KEY, { value: ownership });
  return ownership;
}

const postgreSQLConnectionOwnership = sharedPostgreSQLConnectionOwnership();

function isOwnedPostgreSQLConnection(value: unknown): value is OwnedPostgreSQLConnection {
  return isPostgreSQLConnection(value) && postgreSQLConnectionOwnership.connections.has(value);
}

export class PostgreSQLConnection implements OwnedPostgreSQLConnection {
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
  readonly table: string;
  readonly url: string;
  private readonly database: Knex;
  private destroyPromise?: Promise<void>;

  constructor(fullURL: string, dependencies: SQLiteConnectionDependencies) {
    const target = resolvePostgreSQLTarget(fullURL, dependencies.DatabaseURL);
    this.databaseName = target.database;
    this.host = target.host;
    this.port = target.port;
    this.table = target.table;
    this.url = target.poolKey;
    this.database = knexFactory({
      client: 'pg',
      connection: { database: target.database, host: target.host, password: target.password, port: target.port, ssl: false, user: target.user },
      pool: { max: 1, min: 0 },
    });
    postgreSQLConnectionOwnership.connections.add(this);
  }

  knex(): Knex {
    return this.database;
  }

  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
  destroy(callback?: ErrorCallback): Promise<void> | void {
    const worker = operationWorker(() => {
      postgreSQLConnectionOwnership.closingConnections.add(this);
      this.destroyPromise ??= this.database.destroy();
      return this.destroyPromise;
    });
    return callback ? runErrorWorker(worker, callback) : runErrorWorker(worker);
  }
}

export class PostgreSQLConnectionPool {
  private readonly pool: ConnectionPoolInstance;
  private readonly dependencies: SQLiteConnectionDependencies;

  constructor(pool: ConnectionPoolInstance, dependencies: SQLiteConnectionDependencies) {
    this.pool = pool;
    this.dependencies = dependencies;
  }

  connect(fullURL: string): OwnedPostgreSQLConnection {
    const target = resolvePostgreSQLTarget(fullURL, this.dependencies.DatabaseURL);
    const existing = this.get(target.poolKey);
    if (existing) {
      this.pool.setOwned(target.poolKey, existing, postgreSQLConnectionOwnership.disposer);
      return existing;
    }
    const connection = new PostgreSQLConnection(fullURL, this.dependencies);
    this.pool.setOwned(connection.url, connection, postgreSQLConnectionOwnership.disposer);
    return connection;
  }

  get(key: string): OwnedPostgreSQLConnection | undefined {
    const connection = this.pool.get(key);
    if (connection === undefined) return;
    if (!isOwnedPostgreSQLConnection(connection)) throw new Error('ConnectionPool entry is not owned by the PostgreSQL adapter');
    return connection;
  }

  closeConnection(fullURL: string): Promise<void>;
  closeConnection(fullURL: string, callback: ErrorCallback): void;
  closeConnection(fullURL: string, callback?: ErrorCallback): Promise<void> | void {
    const key = this.pool.get(fullURL) === undefined ? resolvePostgreSQLTarget(fullURL, this.dependencies.DatabaseURL).poolKey : fullURL;
    return callback ? this.pool.dispose(key, callback) : this.pool.dispose(key);
  }

  disposeAll(): Promise<void>;
  disposeAll(callback: ErrorCallback): void;
  disposeAll(callback?: ErrorCallback): Promise<void> | void {
    return callback ? this.pool.disposeAll(callback) : this.pool.disposeAll();
  }
}
