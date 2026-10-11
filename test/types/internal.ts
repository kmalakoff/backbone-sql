import type { BackboneSQLiteSync, SQLiteCursor, SQLiteCursorJSON } from '../../src/internal/backbone.ts';
import type { SQLiteConnection, SQLiteConnectionPool } from '../../src/internal/connection.ts';
import type SQLQuery from '../../src/internal/query.ts';
import type SQLSchema from '../../src/internal/schema.ts';
import type { ResultCallback, SQLPage, SQLPredicateGroup, SQLRelatedPredicate, SQLRelatedThrough, SQLRow } from '../../src/internal/types.ts';

declare const connection: SQLiteConnection;
declare const connectionPool: SQLiteConnectionPool;
declare const query: SQLQuery;
declare const schema: SQLSchema;
declare const rowsCallback: ResultCallback<SQLRow[]>;
declare const sync: BackboneSQLiteSync;
declare const cursor: SQLiteCursor;

const connectionPromise: Promise<void> = connection.destroy();
const connectionCallback: void = connection.destroy(() => undefined);
const pooledConnection = connectionPool.connect('sqlite3:///items');
const ownedConnection = connectionPool.setOwned(connection);
const closeConnectionPromise: Promise<void> = connectionPool.closeConnection('sqlite3://');
const closeConnectionCallback: void = connectionPool.closeConnection('sqlite3://', () => undefined);
const disposeAllPromise: Promise<void> = connectionPool.disposeAll();
const disposeAllCallback: void = connectionPool.disposeAll(() => undefined);
const rowsPromise: Promise<SQLRow[]> = query.select({ where: { id: 1 } });
const rowsCallbackResult: void = query.select(undefined, rowsCallback);
const relatedPredicate: SQLRelatedPredicate = { innerColumn: 'id', outerColumn: 'owner_id', table: 'owners', where: { active: true } };
const relatedThrough: SQLRelatedThrough = { joinColumn: 'course_id', relatedColumn: 'id', table: 'courses' };
const throughPredicate: SQLRelatedPredicate = {
  innerColumn: 'student_id',
  outerColumn: 'id',
  table: 'course_students',
  through: relatedThrough,
  where: { active: true },
};
const predicateGroup: SQLPredicateGroup = { related: [relatedPredicate], where: { published: true } };
const relatedRowsPromise: Promise<SQLRow[]> = query.select({ or: [predicateGroup], related: [relatedPredicate, throughPredicate] });
const countPromise: Promise<number> = query.count();
const pagePromise: Promise<SQLPage> = query.page({ limit: 10 });
const schemaPromise: Promise<void> = schema.ensureSchema([{ name: 'id', type: 'increments' }]);
const schemaCallback: void = schema.hasTable(() => undefined);
const cursorPromise: Promise<SQLiteCursorJSON> = cursor.toJSON();
const resetOwnedSchemaPromise: Promise<void> = sync.resetOwnedSchema();
const closeSyncPromise: Promise<void> = sync.closeConnection();
const closeSyncCallback: void = sync.closeConnection(() => undefined);
const configuredColumns: void = sync.configureColumns(() => [{ name: 'id', type: 'increments' }]);
const fixedColumns: void = sync.configureColumns([{ name: 'id', type: 'increments' }]);

// @ts-expect-error The callback facade returns void, never the Promise facade.
const invalidRowsCallbackPromise: Promise<SQLRow[]> = query.select(undefined, rowsCallback);
// @ts-expect-error The callback teardown form returns void.
const invalidCloseCallbackPromise: Promise<void> = sync.closeConnection(() => undefined);
// @ts-expect-error The pool callback form returns void.
const invalidDisposeAllCallbackPromise: Promise<void> = connectionPool.disposeAll(() => undefined);
// @ts-expect-error A through predicate requires the physical pivot join column.
const invalidRelatedThrough: SQLRelatedThrough = { relatedColumn: 'id', table: 'courses' };
// @ts-expect-error A current-definition supplier must return supported SQL column types.
sync.configureColumns(() => [{ name: 'id', type: 'unsupported' }]);
// @ts-expect-error A current-definition supplier must return a column array, not a Promise.
sync.configureColumns(async () => [{ name: 'id', type: 'increments' }]);

void connectionPromise;
void connectionCallback;
void pooledConnection;
void ownedConnection;
void closeConnectionPromise;
void closeConnectionCallback;
void disposeAllPromise;
void disposeAllCallback;
void rowsPromise;
void rowsCallbackResult;
void relatedRowsPromise;
void countPromise;
void pagePromise;
void schemaPromise;
void schemaCallback;
void cursorPromise;
void resetOwnedSchemaPromise;
void closeSyncPromise;
void closeSyncCallback;
void invalidRowsCallbackPromise;
void invalidCloseCallbackPromise;
void invalidDisposeAllCallbackPromise;
void invalidRelatedThrough;
void configuredColumns;
void fixedColumns;
