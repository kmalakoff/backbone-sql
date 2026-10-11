import type Backbone from 'backbone';
import type { ConfiguredModelStatics } from 'backbone-orm';
import BackboneSQL, { type ErrorCallback, type OwnedPostgreSQLConnection, type OwnedSQLConnection, type PostgreSQLDatabaseControl, type ResultCallback, type SQLCapabilities, type SQLConnection, type SQLiteDatabaseControl, type SQLSyncOptions, sync } from 'backbone-sql';

interface PublicItemAttributes extends Backbone.ObjectHash {
  id?: number;
  name?: string;
}

class PublicItem extends BackboneSQL.Backbone.Model<PublicItemAttributes> {
  urlRoot = 'sqlite3:///public_items';
}

const options: SQLSyncOptions = { filename: '.tmp/public-items.sqlite3' };
const modelSync: Backbone.Model['sync'] = sync(PublicItem, options);
const capabilities: SQLCapabilities | Record<string, never> = sync.capabilities('sqlite3:///public_items');

// @ts-expect-error SQLite filenames are strings, not numeric handles.
const invalidOptions: SQLSyncOptions = { filename: 42 };
// @ts-expect-error SQL sync only accepts Backbone model or collection constructors.
sync(class InvalidConsumer {}, options);

void modelSync;
void capabilities;
void invalidOptions;

function useConfiguredControls(model: ConfiguredModelStatics<PublicItem, SQLiteDatabaseControl>): void {
  const db = model.db();
  const ownedConnection: OwnedSQLConnection = db.connection;
  const baseConnection: SQLConnection = ownedConnection;
  const connectionFilename: string = ownedConnection.filename;
  const namedErrorCallback: ErrorCallback = (error) => {
    const callbackError: Error | null | undefined = error;
    void callbackError;
  };
  const namedResultCallback: ResultCallback<boolean> = (error, value) => {
    const callbackError: Error | null = error;
    const callbackValue: boolean | undefined = value;
    void callbackError;
    void callbackValue;
  };
  const namedEnsured: void = db.ensureSchema(namedErrorCallback);
  const namedExists: Promise<boolean> = db.hasTable(namedResultCallback);
  const exists: Promise<boolean> = db.hasTable((error, value) => {
    const callbackError: Error | null = error;
    const callbackValue: boolean | undefined = value;
    void callbackError;
    void callbackValue;
  });
  const column: Promise<boolean> = db.hasColumn('name', () => {});
  const dropped: Promise<unknown> = db.dropTable(() => {});
  const droppedIfExists: Promise<unknown> = db.dropTableIfExists(() => {});
  const renamed: Promise<unknown> = db.renameTable('archived_items', () => {});
  const created: void = db.createOrUpdateTable({ verbose: false }, () => {});
  const ensured: void = db.ensureSchema(() => {});
  const ensuredWithOptions: void = db.ensureSchema({ verbose: false }, () => {});
  const reset: void = db.resetSchema(() => {});
  const resetWithOptions: void = db.resetSchema({ verbose: true }, (error) => {
    const callbackError: Error | null | undefined = error;
    void callbackError;
  });
  const destroyed: unknown = model.destroy({ $each: { threads: 1 }, $select: ['name'] }, (error) => {
    const callbackError: Error | null | undefined = error;
    void callbackError;
  });
  // @ts-expect-error Static destroy requires its callback for a query.
  model.destroy({ $select: ['name'] });
  // @ts-expect-error Static destroy does not declare a second success-count callback argument.
  model.destroy({}, (_error: Error | null, _count: number) => {});
  // @ts-expect-error The published destroy return is unknown, not a promised completion API.
  const invalidDestroyReturn: Promise<void> = model.destroy({}, () => {});

  // @ts-expect-error Direct restored controls require their callback.
  db.hasTable();
  // @ts-expect-error Direct column checks also require their callback.
  db.hasColumn('name');
  // @ts-expect-error Direct drops require their callback.
  db.dropTable();
  // @ts-expect-error Direct idempotent drops require their callback.
  db.dropTableIfExists();
  // @ts-expect-error Direct renames require their callback.
  db.renameTable('archived_items');
  // @ts-expect-error Direct column checks require a string identifier.
  db.hasColumn(42, () => {});
  // @ts-expect-error Table creation requires options and a callback.
  db.createOrUpdateTable(() => {});
  // @ts-expect-error Callback-mode direct wrappers return a Promise, not void.
  const invalidDropReturn: void = db.dropTable(() => {});
  // @ts-expect-error Raw driver DDL results are not promised to be void.
  const invalidDriverReturn: Promise<void> = db.dropTable(() => {});
  // @ts-expect-error Creation is callback-only and does not return a Promise.
  const invalidCreateReturn: Promise<void> = db.createOrUpdateTable({}, () => {});
  // @ts-expect-error Schema ensure requires a callback, not an options-only call.
  db.ensureSchema({});
  // @ts-expect-error Schema ensure does not have a no-callback form.
  db.ensureSchema();
  // @ts-expect-error Schema reset requires a callback.
  db.resetSchema();
  // @ts-expect-error Schema reset does not accept options without a callback.
  db.resetSchema({ verbose: false });
  // @ts-expect-error Schema options require Boolean verbosity.
  db.ensureSchema({ verbose: 'yes' }, () => {});
  // @ts-expect-error Reset options also require Boolean verbosity.
  db.resetSchema({ verbose: 1 }, () => {});
  // @ts-expect-error Schema reset is required-callback and returns void.
  const invalidResetReturn: Promise<void> = db.resetSchema({}, () => {});
  // @ts-expect-error Schema ensure is required-callback and returns void.
  const invalidEnsureReturn: Promise<void> = db.ensureSchema(() => {});

  void exists;
  void column;
  void dropped;
  void droppedIfExists;
  void renamed;
  void created;
  void ensured;
  void ensuredWithOptions;
  void reset;
  void resetWithOptions;
  void invalidDropReturn;
  void invalidDriverReturn;
  void invalidCreateReturn;
  void invalidResetReturn;
  void invalidEnsureReturn;
  void destroyed;
  void invalidDestroyReturn;
  void baseConnection;
  void connectionFilename;
  void namedEnsured;
  void namedExists;
}

// @ts-expect-error A plain model constructor has not acquired typed ORM statics.
PublicItem.db();
void useConfiguredControls;

function usePostgreSQLControls(model: ConfiguredModelStatics<PublicItem, PostgreSQLDatabaseControl>): void {
  const db = model.db();
  const ownedConnection: OwnedPostgreSQLConnection = db.connection;
  const baseConnection: SQLConnection = ownedConnection;
  const host: string = db.connection.host;
  const port: number = db.connection.port;
  const database: string = db.connection.databaseName;
  const exists: Promise<boolean> = db.hasTable(() => {});
  const ensured: void = db.ensureSchema({}, () => {});
  const closed: Promise<void> = db.connection.destroy();
  const callbackClosed: void = db.connection.destroy(() => {});
  // @ts-expect-error PostgreSQL connections have endpoint data, not a SQLite filename.
  const filename: string = db.connection.filename;
  // @ts-expect-error PostgreSQL schema controls still require a callback.
  db.resetSchema({});
  // @ts-expect-error Endpoint port remains numeric.
  const invalidPort: string = db.connection.port;
  void host;
  void port;
  void database;
  void exists;
  void ensured;
  void closed;
  void callbackClosed;
  void filename;
  void invalidPort;
  void baseConnection;
}
void usePostgreSQLControls;
