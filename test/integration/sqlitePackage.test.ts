import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BackboneORM from 'backbone-orm';
import BackboneSQL from 'backbone-sql';
import { safeRmSync } from 'fs-remove-compat';
import knexFactory, { type Knex } from 'knex';

import { runOwnedProcess } from '../lib/runOwnedProcess.ts';
import { CALLBACK_REQUEST_MODES, FATAL_CALLBACK_REQUEST_MODES } from '../lib/sqliteCallbackRequest.ts';

interface ItemAttributes extends Backbone.ObjectHash {
  group_id?: number;
  id?: number;
  name?: string;
  score?: number;
}

function callbackResult(invoke: (callback: (error: unknown, value?: unknown) => void) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const returned = invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
    assert.strictEqual(returned, undefined);
  });
}

function callbackCompletion(invoke: (callback: (error?: unknown) => void) => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function callStatic(host: object, name: string, arguments_: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing static ORM method: ${name}`);
  return Reflect.apply(method, host, arguments_);
}

function callControl(host: object, method: string, ...arguments_: unknown[]): unknown {
  const syncMethod: unknown = Reflect.get(Reflect.get(host, 'prototype'), 'sync');
  if (typeof syncMethod !== 'function') throw new Error('Missing configured model sync');
  return Reflect.apply(syncMethod, host, [method, ...arguments_]);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof Reflect.get(value, 'then') === 'function';
}

function object(value: unknown): object {
  if (typeof value !== 'object' || value === null) throw new Error('Expected a public control object');
  return value;
}

function detachedControl(host: object, name: string): (...arguments_: unknown[]) => unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing direct database control: ${name}`);
  return (...arguments_) => Reflect.apply(method, undefined, arguments_);
}

function nativeSchemaOperation(connection: object, name: string, arguments_: readonly unknown[]): unknown {
  const database: unknown = callStatic(connection, 'knex', []);
  if (typeof database !== 'function') throw new Error('Public connection did not return Knex');
  return callStatic(object(Reflect.get(database, 'schema')), name, arguments_);
}

async function observeThenable(invoke: (callback: (error: unknown, value?: unknown) => void) => unknown): Promise<{ error: unknown; value: unknown }> {
  let calls = 0;
  const order: string[] = [];
  let complete: (result: { error: unknown; value: unknown }) => void = () => {};
  const callbackResult = new Promise<{ error: unknown; value: unknown }>((resolve) => {
    complete = resolve;
  });
  const returned = invoke((...arguments_) => {
    const [error, value] = arguments_;
    assert.strictEqual(arguments_.length, error === null ? 2 : 1);
    calls += 1;
    order.push('callback');
    complete({ error, value });
  });
  assert.ok(returned instanceof Promise);
  const thenObserver = returned.then(
    () => {
      order.push('then');
    },
    () => undefined
  );
  const catchObserver = returned.catch(() => {
    order.push('catch');
  });
  let outcome: { error: unknown; value: unknown };
  try {
    outcome = { error: null, value: await returned };
  } catch (error: unknown) {
    outcome = { error, value: undefined };
  }
  assert.deepStrictEqual(order, ['callback', outcome.error === null ? 'then' : 'catch']);
  order.push('await');
  await Promise.all([thenObserver, catchObserver]);
  assert.deepStrictEqual(order, ['callback', outcome.error === null ? 'then' : 'catch', 'await']);
  const notified = await callbackResult;
  assert.strictEqual(notified.error, outcome.error);
  assert.strictEqual(notified.value, outcome.value);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1);
  return notified;
}

async function observeCreation(db: object): Promise<unknown> {
  let calls = 0;
  const error = await new Promise<unknown>((resolve) => {
    const returned = callStatic(db, 'createOrUpdateTable', [
      {},
      (error: unknown) => {
        calls += 1;
        resolve(error);
      },
    ]);
    assert.strictEqual(returned, undefined);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1);
  return error;
}

async function cleanupSQLiteFixture(resources: { cacheConfigured: boolean; connection: unknown; database: Knex | undefined; poolKey: string | undefined; root: string }, failure: { present: boolean; value: unknown }): Promise<void> {
  const errors: unknown[] = [];
  const handles = await Promise.allSettled([
    Promise.resolve().then(() => resources.database?.destroy()),
    Promise.resolve().then(() => {
      if (resources.poolKey === undefined || resources.connection === undefined) return;
      assert.strictEqual(BackboneORM.ConnectionPool.get(resources.poolKey), resources.connection);
      return BackboneORM.ConnectionPool.dispose(resources.poolKey);
    }),
  ]);
  for (const result of handles) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  const retainRoot = errors.length !== 0;
  if (resources.cacheConfigured) {
    try {
      BackboneSQL.configure({ model_cache: { enabled: false } });
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (!retainRoot) {
    try {
      safeRmSync(resources.root);
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length === 0) {
    if (failure.present) throw failure.value;
    return;
  }
  if (failure.present) errors.unshift(failure.value);
  const aggregateError: unknown = Reflect.get(globalThis, 'AggregateError');
  assert.ok(typeof aggregateError === 'function');
  throw Reflect.construct(aggregateError, [errors, retainRoot ? `SQLite fixture cleanup failed; scratch retained at ${resources.root}` : `SQLite fixture cleanup failed for ${resources.root}`]);
}

describe('public package SQLite adapter', () => {
  for (const cacheEnabled of [false, true]) {
    it(`restores flat bound database controls with cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-controls-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      mkdirSync(root, { recursive: true });
      const database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });

      class FlatControlItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///flat_control_items';

        schema(): Record<string, unknown> {
          return { added: ['Text', { nullable: true }], name: ['String', { nullable: true }] };
        }
      }

      BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
      FlatControlItem.prototype.sync = BackboneSQL.sync(FlatControlItem, { filename });
      const db = object(callStatic(FlatControlItem, 'db', []));
      const connection = object(Reflect.get(db, 'connection'));
      const key: unknown = Reflect.get(connection, 'url');
      const query = Reflect.get(db, 'query');
      const schema = Reflect.get(db, 'schema');
      const hasTable = detachedControl(db, 'hasTable');
      const hasColumn = detachedControl(db, 'hasColumn');
      const dropTable = detachedControl(db, 'dropTable');
      const dropTableIfExists = detachedControl(db, 'dropTableIfExists');
      const renameTable = detachedControl(db, 'renameTable');
      const createOrUpdateTable = detachedControl(db, 'createOrUpdateTable');
      for (const operation of [hasTable, hasColumn, dropTable, dropTableIfExists, renameTable, createOrUpdateTable]) assert.strictEqual(typeof operation, 'function');

      try {
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasTable, undefined, [callback]))).value, false);
        await database.schema.createTable('flat_control_items', (table) => {
          table.increments('id');
          table.text('name');
          table.text('extra');
        });
        await database('flat_control_items').insert({ extra: 'preserved', name: 'existing' });
        await database.schema.createTable('unrelated', (table) => table.text('value'));
        await database('unrelated').insert({ value: 'keep' });
        await nativeSchemaOperation(connection, 'createTable', ['oracle_drop', (table: Knex.TableBuilder) => table.integer('value')]);
        const nativeDropResult = await nativeSchemaOperation(connection, 'dropTable', ['oracle_drop']);
        const nativeDropIfExistsResult = await nativeSchemaOperation(connection, 'dropTableIfExists', ['oracle_missing']);
        await nativeSchemaOperation(connection, 'createTable', ['oracle_rename', (table: Knex.TableBuilder) => table.integer('value')]);
        const nativeRenameResult = await nativeSchemaOperation(connection, 'renameTable', ['oracle_rename', 'oracle_renamed']);
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasColumn, undefined, ['added', callback]))).value, false);
        let creationCalls = 0;
        await new Promise<void>((resolve, reject) => {
          const returned = Reflect.apply(createOrUpdateTable, undefined, [
            {},
            (error: unknown) => {
              creationCalls += 1;
              if (error) reject(error);
              else resolve();
            },
          ]);
          assert.strictEqual(returned, undefined);
        });
        assert.strictEqual(creationCalls, 1);
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasColumn, undefined, ['added', callback]))).value, true);
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasColumn, undefined, ['extra', callback]))).value, true);
        assert.deepStrictEqual(await database('flat_control_items').select('*'), [{ added: null, extra: 'preserved', id: 1, name: 'existing' }]);
        assert.strictEqual(await observeCreation(db), null);
        assert.deepStrictEqual(await database('flat_control_items').select('extra', 'name'), [{ extra: 'preserved', name: 'existing' }]);
        const fetched = new FlatControlItem({ id: 1 });
        await fetched.fetch();
        assert.strictEqual(fetched.get('name'), 'existing');
        await fetched.save({ added: 'saved' });
        assert.deepStrictEqual(await database('flat_control_items').select('added', 'extra'), [{ added: 'saved', extra: 'preserved' }]);

        const renamed = await observeThenable((callback) => Reflect.apply(renameTable, undefined, ['archived_control_items', callback]));
        assert.strictEqual(renamed.error, null);
        assert.deepStrictEqual(renamed.value, nativeRenameResult);
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasTable, undefined, [callback]))).value, false);
        assert.strictEqual(await database.schema.hasTable('archived_control_items'), true);
        assert.strictEqual(callStatic(FlatControlItem, 'tableName', []), 'flat_control_items');
        assert.strictEqual(Reflect.get(object(schema), 'table'), 'flat_control_items');
        assert.strictEqual(Reflect.get(object(query), 'table'), 'flat_control_items');
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(dropTableIfExists, undefined, [callback]))).error, null);
        assert.strictEqual(await database.schema.hasTable('archived_control_items'), true);
        assert.strictEqual(await observeCreation(db), null);
        assert.deepStrictEqual(await database('flat_control_items').select('*'), []);
        const dropped = await observeThenable((callback) => Reflect.apply(dropTable, undefined, [callback]));
        assert.strictEqual(dropped.error, null);
        assert.deepStrictEqual(dropped.value, nativeDropResult);
        assert.strictEqual((await observeThenable((callback) => Reflect.apply(hasTable, undefined, [callback]))).value, false);
        const droppedIfExists = await observeThenable((callback) => Reflect.apply(dropTableIfExists, undefined, [callback]));
        assert.strictEqual(droppedIfExists.error, null);
        assert.deepStrictEqual(droppedIfExists.value, nativeDropIfExistsResult);
        assert.deepStrictEqual(await database('archived_control_items').select('added', 'extra'), [{ added: 'saved', extra: 'preserved' }]);
        assert.deepStrictEqual(await database('unrelated').select('*'), [{ value: 'keep' }]);
        assert.strictEqual(callStatic(FlatControlItem, 'db', []), db);
        assert.strictEqual(Reflect.get(db, 'connection'), connection);
        assert.strictEqual(Reflect.get(db, 'query'), query);
        assert.strictEqual(Reflect.get(db, 'schema'), schema);
        assert.strictEqual(typeof Reflect.get(db, 'resetSchema'), 'function');
        assert.strictEqual(typeof Reflect.get(db, 'ensureSchema'), 'function');
      } finally {
        try {
          await callControl(FlatControlItem, 'closeConnection');
        } finally {
          await database.destroy();
          BackboneSQL.configure({ model_cache: { enabled: false } });
          safeRmSync(root);
        }
      }
      assert.ok(typeof key === 'string');
      assert.strictEqual(BackboneORM.ConnectionPool.get(key), undefined);
    });
  }

  it('reports direct schema failures once with the same native error and thenable rejection', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-controls-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    class FailingControlItem extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3:///failing_control_items';
      schema(): Record<string, unknown> {
        return { name: 'String' };
      }
    }
    FailingControlItem.prototype.sync = BackboneSQL.sync(FailingControlItem, { filename: path.join(root, 'database.sqlite3') });
    const db = object(callStatic(FailingControlItem, 'db', []));
    const database: unknown = callStatic(object(Reflect.get(db, 'connection')), 'knex', []);
    if (typeof database !== 'function') throw new Error('Public connection did not return Knex');
    let driverError: unknown;
    let queryCalls = 0;
    callStatic(database, 'on', [
      'query-error',
      (error: unknown) => {
        driverError = error;
      },
    ]);
    callStatic(database, 'on', [
      'query',
      () => {
        queryCalls += 1;
      },
    ]);
    try {
      const dropped = await observeThenable((callback) => callStatic(db, 'dropTable', [callback]));
      assert.ok(dropped.error instanceof Error);
      assert.strictEqual(dropped.error, driverError);
      assert.match(dropped.error.message, /no such table/);
      assert.strictEqual((await observeThenable((callback) => callStatic(db, 'dropTableIfExists', [callback]))).error, null);
      const beforeInvalid = queryCalls;
      const invalid = await observeThenable((callback) => callStatic(db, 'hasColumn', ['bad name', callback]));
      assert.ok(invalid.error instanceof Error);
      assert.match(invalid.error.message, /Column name is invalid/);
      const invalidRename = await observeThenable((callback) => callStatic(db, 'renameTable', ['bad name', callback]));
      assert.ok(invalidRename.error instanceof Error);
      assert.match(invalidRename.error.message, /Table name is invalid/);
      assert.strictEqual(queryCalls, beforeInvalid);
      await callStatic(database, 'raw', ['PRAGMA query_only = ON']);
      const creationError = await observeCreation(db);
      assert.ok(creationError instanceof Error);
      assert.strictEqual(creationError, driverError);
      assert.match(creationError.message, /readonly/);
      assert.strictEqual((await observeThenable((callback) => callStatic(db, 'hasTable', [callback]))).value, false);
    } finally {
      await callControl(FailingControlItem, 'closeConnection');
      safeRmSync(root);
    }
  });

  it('does not swallow or renotify caller callback throws and keeps schema jobs runnable', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const root = path.join(repositoryRoot, '.tmp/public-sql-controls-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    try {
      for (const mode of ['hasTable', 'hasColumn', 'dropTable', 'dropTableError', 'dropTableIfExists', 'renameTable', 'createOrUpdateTable', 'createOrUpdateTableError', 'ensureSchema', 'ensureSchemaError', 'resetSchema', 'resetSchemaError']) {
        const result = await runOwnedProcess(process.execPath, [path.join(repositoryRoot, 'node_modules/ts-swc-loaders/bin/cli.js'), path.join(repositoryRoot, 'test/fixtures/sqliteDatabaseControlThrows.ts'), mode, path.join(root, `${mode}.sqlite3`)], { cwd: repositoryRoot, timeoutMs: 15_000 });
        assert.strictEqual(result.status, 0, `${mode}: ${result.stdout}${result.stderr}`);
        assert.match(result.stdout, /callback throw escaped once; connection cleanup confirmed/);
      }
    } finally {
      safeRmSync(root);
    }
  });

  for (const enabled of [false, true]) {
    for (const mode of CALLBACK_REQUEST_MODES) {
      it(`preserves callback request ${mode} with cache ${enabled}`, async () => {
        const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
        const root = path.join(repositoryRoot, '.tmp/public-sql-callback-request-tests', randomUUID());
        const filename = path.join(root, 'database.sqlite3');
        mkdirSync(root, { recursive: true });
        try {
          const result = await runOwnedProcess(process.execPath, ['--unhandled-rejections=strict', path.join(repositoryRoot, 'node_modules/ts-swc-loaders/bin/cli.js'), path.join(repositoryRoot, 'test/fixtures/sqliteCallbackRequests.ts'), mode, filename, String(enabled)], { cwd: repositoryRoot, timeoutMs: 15_000 });
          const fatal = FATAL_CALLBACK_REQUEST_MODES.has(mode);
          const prefix = fatal ? 'callback-request-fatal ' : 'callback-request-proof ';
          const proof = result.stdout.split('\n').find((line) => line.startsWith(prefix));
          assert.ok(proof, `${mode}: ${result.stdout}${result.stderr}`);
          const successCalls = mode.startsWith('success-throw') ? 1 : 0;
          const errorCalls = mode.startsWith('raw-') || mode === 'await-only' || successCalls === 1 ? 0 : 1;
          if (fatal) {
            assert.notStrictEqual(result.status, 0, `${mode}: ignored errors must remain fatal`);
            assert.deepStrictEqual(JSON.parse(proof.slice(prefix.length)), { mode, enabled, sameError: true, errorCalls, successCalls });
            assert.match(result.stderr, mode === 'raw-ignored' ? /no such table/ : /owned caller notification threw/);
          } else {
            assert.strictEqual(result.status, 0, `${mode}: ${result.stdout}${result.stderr}`);
            assert.deepStrictEqual(JSON.parse(proof.slice(prefix.length)), { mode, enabled, errorCalls, successCalls, cleanup: true });
          }
          // The owned child has closed or exited before opening this independent verification handle.
          const database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
          try {
            if (mode.startsWith('raw-')) assert.strictEqual(await database.schema.hasTable('callback_request_items'), false);
            else assert.deepStrictEqual(await database('callback_request_items').select('id', 'name'), [{ id: 1, name: 'seeded' }]);
          } finally {
            await database.destroy();
          }
        } finally {
          safeRmSync(root);
        }
      });
    }
  }

  it('runs model, collection, cursor, controls, cache, and teardown through the package name', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    class Item extends BackboneSQL.Backbone.Model<ItemAttributes> {
      urlRoot = 'sqlite3:///items';
    }

    class Items extends BackboneSQL.Backbone.Collection<Item> {}

    BackboneORM.configure({ model_cache: { enabled: true, max: 100 } });
    Reflect.set(Item.prototype, 'schema', {
      group_id: ['Integer', { nullable: false }],
      name: ['String', { nullable: false, unique: true }],
      score: ['Integer', { nullable: false }],
    });
    Item.prototype.sync = BackboneSQL.sync(Item, { filename });
    Items.prototype.model = Item;
    Items.prototype.sync = BackboneSQL.sync(Items);
    try {
      await callbackCompletion((callback) => callStatic(Item, 'resetSchema', [{}, callback]));

      const alpha = new Item({ group_id: 1, name: 'alpha', score: 10 });
      const beta = new Item({ group_id: 1, name: 'beta', score: 20 });
      await alpha.save();
      await beta.save();
      assert.strictEqual(alpha.id, 1);
      assert.strictEqual(beta.id, 2);

      const fetched = new Item({ id: alpha.id });
      await fetched.fetch();
      assert.deepStrictEqual(fetched.toJSON(), { group_id: 1, id: 1, name: 'alpha', score: 10 });
      await fetched.save({ score: 30 });

      const collection = new Items();
      await collection.fetch();
      assert.deepStrictEqual(collection.pluck('name').sort(), ['alpha', 'beta']);

      const cursor: unknown = callStatic(Item, 'cursor', [{ $sort: ['-score', 'id'] }]);
      if (typeof cursor !== 'object' || cursor === null) throw new Error('cursor control did not return an object');
      const toJSON: unknown = Reflect.get(cursor, 'toJSON');
      if (typeof toJSON !== 'function') throw new Error('cursor control did not return toJSON');
      const rows = await callbackResult((callback) => Reflect.apply(toJSON, cursor, [callback]));
      assert.deepStrictEqual(rows, [
        { group_id: 1, id: 1, name: 'alpha', score: 30 },
        { group_id: 1, id: 2, name: 'beta', score: 20 },
      ]);

      const relationCursor: unknown = callStatic(Item, 'cursor', [{ $include: ['owner'] }]);
      if (typeof relationCursor !== 'object' || relationCursor === null) throw new Error('relation cursor control did not return an object');
      const relationToJSON: unknown = Reflect.get(relationCursor, 'toJSON');
      if (typeof relationToJSON !== 'function') throw new Error('relation cursor control did not return toJSON');
      await assert.rejects(
        callbackResult((callback) => Reflect.apply(relationToJSON, relationCursor, [callback])),
        /Included relation 'owner' is not a relation/
      );

      assert.strictEqual(await callbackResult((callback) => callStatic(Item, 'count', [{ group_id: 1 }, callback])), 2);
      const existing = await callbackResult((callback) => callStatic(Item, 'findOrCreate', [{ group_id: 1, name: 'beta', score: 20 }, callback]));
      assert.strictEqual(existing, beta);
      assert.strictEqual(callStatic(Item, 'tableName', []), 'items');

      const duplicate = new Item({ group_id: 2, name: 'beta', score: 5 });
      let databaseError: unknown;
      const duplicateRequest: unknown = duplicate.save(null, {
        error(_model, error: unknown) {
          databaseError = error;
        },
      });
      assert.strictEqual(isPromiseLike(duplicateRequest), true);
      await assert.rejects(Promise.resolve(duplicateRequest), (error: unknown) => error === databaseError);
      assert.ok(databaseError instanceof Error);
      assert.match(databaseError.message, /UNIQUE constraint failed/);

      await fetched.destroy();
      await callbackCompletion((callback) => callStatic(Item, 'destroy', [{ name: 'beta' }, callback]));
      assert.strictEqual(await callbackResult((callback) => callStatic(Item, 'count', [callback])), 0);
    } finally {
      try {
        await callControl(Item, 'closeConnection');
      } finally {
        BackboneORM.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('rejects malformed supported PostgreSQL URLs and unsupported dialects while preserving filename semantics', () => {
    class PostgreSQLItem extends BackboneSQL.Backbone.Model {
      urlRoot = 'postgres://localhost/items';
    }

    class MySQLItem extends BackboneSQL.Backbone.Model {
      urlRoot = 'mysql://localhost/database/items';
    }

    assert.throws(() => BackboneSQL.sync(PostgreSQLItem), /Invalid PostgreSQL model URL/);
    assert.deepStrictEqual(BackboneSQL.sync.capabilities('postgres://localhost/items'), {});
    assert.throws(() => BackboneSQL.sync(MySQLItem), /Unrecognized sql variant/);
    assert.deepStrictEqual(BackboneSQL.sync.capabilities('mysql://localhost/database/items'), {});
    assert.strictEqual(BackboneSQL.sync.capabilities('sqlite3:///items').embed, false);
  });

  it('rejects secret-bearing unknown schemes and malformed PostgreSQL inputs before name parsing or pool admission', async () => {
    const secret = `sql-secret-${randomUUID()}`;
    const user = `sql-user-${randomUUID()}`;
    const unsupportedSchemes = [
      `postgresql://${user}:${secret}@localhost/database/items`,
      `postgres+ssl://${user}:${secret}@localhost/database/items`,
      `postgres.foo://${user}:${secret}@localhost/database/items`,
      `postgres-test://${user}:${secret}@localhost/database/items`,
      `arbitrary://${user}:${secret}@localhost/database/items`,
      `postgres//${user}:${secret}@localhost/database/items`,
      ` pg://${user}:${secret}@localhost/database/items`,
      `post\ngres://${user}:${secret}@localhost/database/items`,
      `p\tg://${user}:${secret}@localhost/database/items`,
    ];
    const inputs = [
      ...unsupportedSchemes,
      `postgres://${user}:${secret}@localhost:70000/database/items`,
      `pg://${user}:${secret}@localhost/items`,
      `postgres://${user}:${secret}@one:5432,two:5433/database/items`,
      `postgres://${user}:${secret}@localhost/database/items?sslmode=require`,
      `postgres://${user}:${secret}@localhost/database/items#fragment`,
    ];
    const poolEntries = (): Map<unknown, unknown> => {
      const entries = new Map<unknown, unknown>();
      BackboneORM.ConnectionPool.forEach((value, key) => entries.set(key, value));
      return entries;
    };
    const before = poolEntries();
    const assertPoolUnchanged = (): void => {
      const after = poolEntries();
      assert.deepStrictEqual([...after.keys()], [...before.keys()]);
      for (const [key, value] of before) assert.strictEqual(after.get(key), value);
    };
    let failure: { value: unknown } | undefined;
    try {
      for (const input of inputs) {
        class Invalid extends BackboneSQL.Backbone.Model {
          urlRoot = input;
        }
        const originalSync = Invalid.prototype.sync;
        const originalName = Reflect.getOwnPropertyDescriptor(Invalid, 'model_name');
        const rejected = (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          if (unsupportedSchemes.includes(input)) assert.strictEqual(error.message, 'Unrecognized sql variant');
          assert.strictEqual('cause' in error, false);
          assert.strictEqual('input' in error, false);
          assert.strictEqual('url' in error, false);
          const pending: unknown[] = [error];
          const visited = new Set<object>();
          while (pending.length) {
            const value = pending.pop();
            if (typeof value === 'string') {
              assert.ok(!value.includes(secret));
              assert.ok(!value.includes(user));
              assert.notStrictEqual(value, input);
            } else if ((typeof value === 'object' || typeof value === 'function') && value !== null && !visited.has(value)) {
              visited.add(value);
              for (const key of Reflect.ownKeys(value)) {
                const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
                if (descriptor && 'value' in descriptor) pending.push(descriptor.value);
              }
            }
          }
          return true;
        };
        assert.throws(() => BackboneSQL.sync(Invalid), rejected);
        assert.deepStrictEqual(Reflect.getOwnPropertyDescriptor(Invalid, 'model_name'), originalName);
        assert.strictEqual(Invalid.prototype.sync, originalSync);
        assertPoolUnchanged();
        assert.deepStrictEqual(BackboneSQL.sync.capabilities(input), {});
        assertPoolUnchanged();

        for (const mode of ['absent', 'default', 'unconfigured', 'default-id']) {
          class Unconfigured extends BackboneSQL.Backbone.Model {
            urlRoot = 'sqlite3:///unused_model_items';
            defaults(): Backbone.ObjectHash {
              return mode === 'default-id' ? { id: 17 } : {};
            }
          }
          class InvalidCollection extends BackboneSQL.Backbone.Collection<Unconfigured> {}
          const model = mode === 'absent' ? undefined : mode === 'default' ? BackboneSQL.Backbone.Model : Unconfigured;
          Reflect.set(InvalidCollection.prototype, 'model', model);
          Reflect.set(InvalidCollection.prototype, 'url', input);
          const owners = [InvalidCollection, InvalidCollection.prototype, Unconfigured, Unconfigured.prototype];
          const descriptors = owners.map((owner) => Object.getOwnPropertyDescriptors(owner));
          assert.strictEqual(new Unconfigured().isNew(), mode !== 'default-id');
          assert.throws(() => BackboneSQL.sync(InvalidCollection), rejected);
          owners.forEach((owner, index) => assert.deepStrictEqual(Object.getOwnPropertyDescriptors(owner), descriptors[index]));
          assertPoolUnchanged();
        }
      }

      class ConsumedGetter extends BackboneSQL.Backbone.Collection {}
      const original = new Error('owned collection URL getter failure');
      Object.defineProperty(ConsumedGetter.prototype, 'url', {
        get() {
          throw original;
        },
      });
      const descriptors = Object.getOwnPropertyDescriptors(ConsumedGetter.prototype);
      assert.throws(
        () => BackboneSQL.sync(ConsumedGetter),
        (error: unknown) => error === original
      );
      assert.deepStrictEqual(Object.getOwnPropertyDescriptors(ConsumedGetter.prototype), descriptors);
      assertPoolUnchanged();
    } catch (value) {
      failure = { value };
    }
    const errors: unknown[] = [];
    for (const [key, connection] of poolEntries()) {
      if (before.has(key)) continue;
      try {
        assert.ok(typeof key === 'string');
        if (BackboneORM.ConnectionPool.get(key) !== connection) throw new Error('Rejected URL pool entry was replaced; replacement not disposed');
        await BackboneORM.ConnectionPool.dispose(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (!errors.length) {
      if (failure) throw failure.value;
      return;
    }
    if (failure) errors.unshift(failure.value);
    const aggregateError: unknown = Reflect.get(globalThis, 'AggregateError');
    assert.ok(typeof aggregateError === 'function');
    throw Reflect.construct(aggregateError, [errors, 'Rejected PostgreSQL URL fixture cleanup failed']);
  });

  for (const enabled of [false, true]) {
    it(`keeps configured collection model routing without reading an unused URL with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      const modelURL = `sqlite3://collection-${randomUUID()}/routing_items`;
      class RoutingItem extends BackboneSQL.Backbone.Model<ItemAttributes> {
        urlRoot = modelURL;
      }
      class NoURL extends BackboneSQL.Backbone.Collection<RoutingItem> {}
      class ThrowingUnusedURL extends BackboneSQL.Backbone.Collection<RoutingItem> {}
      Reflect.set(NoURL.prototype, 'model', RoutingItem);
      Reflect.set(ThrowingUnusedURL.prototype, 'model', RoutingItem);
      const unused = new Error('unused collection URL getter must not run');
      let reads = 0;
      Object.defineProperty(ThrowingUnusedURL.prototype, 'url', {
        get() {
          reads += 1;
          throw unused;
        },
      });
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL(modelURL).format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        cacheConfigured = true;
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        Reflect.set(RoutingItem.prototype, 'schema', { name: 'String' });
        try {
          RoutingItem.prototype.sync = BackboneSQL.sync(RoutingItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((callback) => callStatic(RoutingItem, 'resetSchema', [{}, callback]));
        const item = new RoutingItem({ name: 'configured' });
        await item.save();
        assert.strictEqual(typeof item.id, 'number');
        assert.strictEqual(Reflect.get(NoURL.prototype, 'url'), undefined);
        const noURLSync = BackboneSQL.sync(NoURL);
        const unusedURLSync = BackboneSQL.sync(ThrowingUnusedURL);
        assert.strictEqual(noURLSync, RoutingItem.prototype.sync);
        assert.strictEqual(unusedURLSync, RoutingItem.prototype.sync);
        NoURL.prototype.sync = noURLSync;
        ThrowingUnusedURL.prototype.sync = unusedURLSync;
        const first = new NoURL();
        const second = new ThrowingUnusedURL();
        await first.fetch();
        await second.fetch();
        assert.deepStrictEqual(first.toJSON(), [{ id: item.id, name: 'configured' }]);
        assert.deepStrictEqual(second.toJSON(), first.toJSON());
        assert.deepStrictEqual(await database('routing_items').select(), first.toJSON());
        assert.strictEqual(reads, 0);
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), connection);
      } catch (value) {
        failure.present = true;
        failure.value = value;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`covers missing SQLite flat query boundaries with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');

      class QueryItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///query_boundary_items';
      }

      const read = (query: Record<string, unknown>): Promise<unknown> => callbackResult((callback) => callStatic(object(callStatic(QueryItem, 'cursor', [query])), 'toJSON', [callback]));
      const names = (query: Record<string, unknown>): Promise<unknown> => read({ $sort: 'id', $values: ['name'], ...query });
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///query_boundary_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(QueryItem.prototype, 'schema', { name: 'String', note: ['String', { nullable: true }], score: 'Integer' });
        try {
          QueryItem.prototype.sync = BackboneSQL.sync(QueryItem, { filename });
        } finally {
          // Sync can acquire its pool entry before later schema setup throws.
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((callback) => callStatic(QueryItem, 'resetSchema', [{}, callback]));
        const input = [
          { name: 'a', note: null, score: 10 },
          { name: 'b', note: 'x', score: 20 },
          { name: 'c', note: null, score: 15 },
          { name: 'd', note: 'y', score: 5 },
        ];
        const models: QueryItem[] = [];
        for (const attributes of input) {
          const model = new QueryItem(attributes);
          await model.save();
          models.push(model);
        }

        assert.deepStrictEqual(await names({ score: { $gte: 10, $lt: 20 } }), ['a', 'c']);
        assert.deepStrictEqual(await names({ score: { $lte: 10 } }), ['a', 'd']);
        assert.deepStrictEqual(await names({ score: { $gt: 10, $lte: 20 } }), ['b', 'c']);
        assert.deepStrictEqual(await names({ note: { $ne: 'x' } }), ['a', 'c', 'd']);
        assert.deepStrictEqual(await names({ note: { $ne: null } }), ['b', 'd']);
        assert.deepStrictEqual(await names({ note: { $exists: false } }), ['a', 'c']);
        assert.deepStrictEqual(await names({ note: { $exists: true } }), ['b', 'd']);
        assert.deepStrictEqual(await names({ name: { $in: ['a', 'c'] } }), ['a', 'c']);
        assert.deepStrictEqual(await names({ name: { $nin: ['a', 'c'] } }), ['b', 'd']);
        assert.deepStrictEqual(await names({ name: { $nin: [] } }), ['a', 'b', 'c', 'd']);
        assert.deepStrictEqual(await names({ name: { $in: [] } }), []);
        assert.strictEqual(await names({ $one: true, name: { $in: [] } }), null);
        assert.strictEqual(await read({ $count: true, name: { $in: [] } }), 0);
        assert.strictEqual(await read({ $exists: true, name: { $in: [] } }), false);
        assert.deepStrictEqual(await names({ $or: [] }), ['a', 'b', 'c', 'd']);
        assert.deepStrictEqual(await names({ $or: [{ name: 'a' }, { name: 'b' }], score: { $gte: 10 } }), ['a', 'b']);
        assert.deepStrictEqual(await names({ $ids: [models[2].id, models[0].id] }), ['a', 'c']);
        assert.deepStrictEqual(await names({ $ids: [] }), []);
        assert.deepStrictEqual(await read({ $zero: true }), []);
        assert.strictEqual(await read({ $one: true, $zero: true }), null);
        assert.strictEqual(await read({ $one: true, name: 'absent' }), null);
        assert.deepStrictEqual(await read({ $limit: 0 }), []);
        assert.deepStrictEqual(await read({ $limit: 2, $offset: 4, $page: true, $sort: 'id' }), { offset: 4, rows: [], total_rows: 4 });

        const fields = Object.freeze(['name', 'score']);
        const whitelist = Object.freeze(['name']);
        const query = Object.freeze({ $select: fields, $sort: 'id', $whitelist: whitelist });
        assert.deepStrictEqual(await read(query), [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]);
        assert.deepStrictEqual(await read({ $sort: 'id', $values: fields, $whitelist: whitelist }), [['a'], ['b'], ['c'], ['d']]);
        assert.deepStrictEqual(fields, ['name', 'score']);
        assert.deepStrictEqual(whitelist, ['name']);

        await assert.rejects(read({ $limit: -1 }), /non-negative safe integer/);
        await assert.rejects(read({ score: { $lt: null } }), /Unexpected null/);
        await assert.rejects(read({ $select: ['name; DROP TABLE query_boundary_items'] }), /invalid/);
        await assert.rejects(read({ missing_column: 'not a row' }), /no such column/);
        assert.deepStrictEqual(await database('query_boundary_items').select('name', 'note', 'score').orderBy('id'), input);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`preserves legacy scalar schema types and aliases with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      class ScalarItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///scalar_items';
      }
      const stringDefinition = Object.freeze({ indexed: true, length: 37, nullable: false, type: 'VarChar' });
      const decimalOptions = Object.freeze({ precision: 9, scale: 3 });
      const fields = {
        alias_big: 'bIgInT',
        alias_bool: 'Bool',
        alias_string: stringDefinition,
        canonical_bool: 'Boolean',
        clock: 'Time',
        decimal_value: ['Decimal', decimalOptions],
        float_value: ['Float', { precision: 8, scale: 2 }],
        medium: 'MediumInt',
        small: 'SmallInt',
        tiny: ['tInYiNt', { length: 4 }],
        token: ['UUID', { unique: true }],
        wide: 'Double',
      };
      const firstInput = Object.freeze({ alias_big: 1099511627776, alias_bool: true, alias_string: 'first', canonical_bool: false, clock: '12:34:56', decimal_value: 4.125, float_value: 2.5, medium: 70000, small: 30000, tiny: -3, token: '01234567-89ab-4cde-8fab-0123456789ab', wide: 1.125 });
      const secondInput = Object.freeze({ ...firstInput, alias_bool: false, alias_string: 'second', canonical_bool: true, clock: null, small: -30000, token: 'fedcba98-7654-4abc-8def-0123456789ab', wide: -1.5 });
      const nativeRows = [
        { ...firstInput, alias_bool: 1, canonical_bool: 0, id: 1 },
        { ...secondInput, alias_bool: 0, canonical_bool: 1, id: 2 },
      ];
      const read = (query: Record<string, unknown>): Promise<unknown> => callbackResult((callback) => callStatic(object(callStatic(ScalarItem, 'cursor', [query])), 'toJSON', [callback]));
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///scalar_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(ScalarItem.prototype, 'schema', fields);
        try {
          ScalarItem.prototype.sync = BackboneSQL.sync(ScalarItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((callback) => callStatic(ScalarItem, 'resetSchema', [{}, callback]));
        await database.schema.createTable('scalar_sentinel', (table) => table.text('value'));
        await database('scalar_sentinel').insert({ value: 'keep' });
        const metadata: unknown = await database.raw('PRAGMA table_info(scalar_items)');
        assert.ok(Array.isArray(metadata));
        assert.deepStrictEqual(metadata.map((row: Record<string, unknown>) => {
          assert.ok(typeof row.type === 'string');
          return [row.name, row.type.toLowerCase(), row.notnull, row.pk];
        }).sort((left, right) => String(left[0]).localeCompare(String(right[0]))), [
          ['alias_big', 'bigint', 0, 0], ['alias_bool', 'boolean', 0, 0], ['alias_string', 'varchar(37)', 1, 0],
          ['canonical_bool', 'boolean', 0, 0], ['clock', 'time', 0, 0], ['decimal_value', 'float', 0, 0],
          ['float_value', 'float', 0, 0], ['id', 'integer', 1, 1], ['medium', 'integer', 0, 0],
          ['small', 'integer', 0, 0], ['tiny', 'tinyint', 0, 0], ['token', 'char(36)', 0, 0], ['wide', 'float', 0, 0],
        ]);
        const indexes: unknown = await database.raw('PRAGMA index_list(scalar_items)');
        assert.ok(Array.isArray(indexes));
        assert.ok(indexes.some((row: Record<string, unknown>) => row.name === 'scalar_items_alias_string_index' && row.unique === 0));
        assert.ok(indexes.some((row: Record<string, unknown>) => row.name === 'scalar_items_token_unique' && row.unique === 1));
        const first = new ScalarItem(firstInput);
        const second = new ScalarItem(secondInput);
        await first.save();
        await second.save();
        assert.strictEqual(first.id, 1);
        assert.strictEqual(second.id, 2);
        assert.deepStrictEqual(await database('scalar_items').select('*').orderBy('id'), nativeRows);
        const fetched = new ScalarItem({ id: first.id });
        await fetched.fetch();
        assert.strictEqual(fetched.get('alias_bool'), enabled ? true : 1);
        assert.strictEqual(fetched.get('canonical_bool'), false);
        assert.deepStrictEqual(await read({ $sort: 'id' }), [
          { ...nativeRows[0], canonical_bool: false },
          { ...nativeRows[1], canonical_bool: true },
        ]);
        const found = await callbackResult((callback) => callStatic(ScalarItem, 'findOne', [{ id: first.id }, callback]));
        assert.ok(found instanceof ScalarItem);
        assert.strictEqual(found.get('alias_bool'), 1);
        if (enabled) assert.strictEqual(found, first);
        else assert.notStrictEqual(found, first);
        for (const [attributes, code] of [
          [{ ...firstInput, alias_string: 'duplicate token' }, 'SQLITE_CONSTRAINT_UNIQUE'],
          [{ ...firstInput, alias_string: null, token: '11111111-1111-4111-8111-111111111111' }, 'SQLITE_CONSTRAINT_NOTNULL'],
        ] as const) {
          let calls = 0;
          let notified: unknown;
          const returned = new ScalarItem(attributes).save(null, { error: (_model, error) => { calls += 1; notified = error; } });
          assert.strictEqual(isPromiseLike(returned), true);
          await assert.rejects(Promise.resolve(returned), (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === code);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.deepStrictEqual(await database('scalar_items').select('*').orderBy('id'), nativeRows);
        }
        await second.save({ alias_string: 'x'.repeat(38), clock: 'not-a-time', token: 'not-a-uuid' });
        const permissiveRow = { ...nativeRows[1], alias_string: 'x'.repeat(38), clock: 'not-a-time', token: 'not-a-uuid' };
        assert.deepStrictEqual(await database('scalar_items').select('*').orderBy('id'), [nativeRows[0], permissiveRow]);
        assert.deepStrictEqual(await read({ id: 2, $select: ['alias_string', 'clock', 'token'] }), [{ alias_string: 'x'.repeat(38), clock: 'not-a-time', token: 'not-a-uuid' }]);
        const sync = ScalarItem.prototype.sync;
        Reflect.set(ScalarItem.prototype, 'schema', { ...fields, extra_clock: ['Time', { nullable: true }] });
        assert.strictEqual(BackboneSQL.sync(ScalarItem, { filename }), sync);
        await callbackCompletion((callback) => callStatic(ScalarItem, 'ensureSchema', [callback]));
        await callbackCompletion((callback) => callStatic(ScalarItem, 'ensureSchema', [callback]));
        assert.deepStrictEqual(await database('scalar_items').select('*').orderBy('id'), [
          { ...nativeRows[0], extra_clock: null }, { ...permissiveRow, extra_clock: null },
        ]);
        assert.deepStrictEqual(await database('scalar_sentinel').select('*'), [{ value: 'keep' }]);
        assert.deepStrictEqual(stringDefinition, { indexed: true, length: 37, nullable: false, type: 'VarChar' });
        assert.deepStrictEqual(decimalOptions, { precision: 9, scale: 3 });
        assert.strictEqual(firstInput.alias_bool, true);
        assert.strictEqual(secondInput.alias_bool, false);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });


    it(`preserves authored SQLite BigIncrements IDs through the safe boundary with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      class BigItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///big_increment_items';
      }
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const reads: string[] = [];
      const getterError = new Error('SQLite BigIncrements losing getter identity');
      let failGetter = false;
      let coercions = 0;
      const ignored = {
        get primaryKey(): never { coercions += 1; throw new Error('BigIncrements must not forward primaryKey options'); },
        toString(): never { coercions += 1; throw new Error('BigIncrements arguments must not be coerced'); },
      };
      const idField = { type: 'bIgInCrEmEnTs', primary: true, indexed: true, unique: true };
      for (const key of optionKeys) Object.defineProperty(idField, key, { enumerable: true, get(): unknown {
        reads.push(key);
        if (key === 'values' && failGetter) throw getterError;
        return ignored;
      } });
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///big_increment_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(BigItem.prototype, 'schema', { id: idField, name: ['String', { nullable: false }] });
        try {
          BigItem.prototype.sync = BackboneSQL.sync(BigItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        assert.deepStrictEqual(reads, []);
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((done) => callStatic(BigItem, 'resetSchema', [{}, done]));
        assert.deepStrictEqual(reads, optionKeys);
        reads.length = 0;
        failGetter = true;
        const metadata: unknown = await database.raw('PRAGMA table_info(big_increment_items)');
        assert.ok(Array.isArray(metadata));
        assert.deepStrictEqual(metadata.map((row: Record<string, unknown>) => [row.name, row.type, row.notnull, row.pk]), [
          ['id', 'INTEGER', 1, 1], ['name', 'varchar(255)', 1, 0],
        ]);
        const ddl = await database('sqlite_schema').where({ name: 'big_increment_items', type: 'table' }).first('sql');
        assert.ok(typeof ddl.sql === 'string' && /\bid\b[^,]*primary key autoincrement/i.test(ddl.sql));
        assert.deepStrictEqual(await database.raw('PRAGMA index_list(big_increment_items)'), []);
        await database.schema.createTable('big_increment_sentinel', (table) => table.text('value'));
        await database('big_increment_sentinel').insert({ value: 'keep' });
        const first = new BigItem({ name: 'first' });
        const second = new BigItem({ name: 'second' });
        let successCalls = 0;
        await first.save(null, { success: () => { successCalls += 1; } });
        await second.save();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(successCalls, 1);
        assert.strictEqual(first.id, 1);
        assert.strictEqual(second.id, 2);
        assert.deepStrictEqual(await database('big_increment_items').select('*').orderBy('id'), [{ id: 1, name: 'first' }, { id: 2, name: 'second' }]);
        assert.deepStrictEqual(await database('sqlite_sequence').where({ name: 'big_increment_items' }).select('seq'), [{ seq: 2 }]);
        await assert.rejects(database('big_increment_items').insert({ id: 1, name: 'duplicate' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_CONSTRAINT_PRIMARYKEY');
        await first.save({ name: 'updated first' });
        const fetched = new BigItem({ id: 1 });
        await fetched.fetch();
        assert.strictEqual(fetched.id, 1);
        assert.strictEqual(fetched.get('name'), 'updated first');
        await database('sqlite_sequence').where({ name: 'big_increment_items' }).update({ seq: Number.MAX_SAFE_INTEGER - 2 });
        const highFirst = new BigItem({ name: 'safe penultimate' });
        const highSecond = new BigItem({ name: 'safe last' });
        await highFirst.save();
        await highSecond.save();
        assert.strictEqual(highFirst.id, 9007199254740990);
        assert.strictEqual(highSecond.id, 9007199254740991);
        await highFirst.save({ name: 'updated safe penultimate' });
        const highFetched = new BigItem({ id: 9007199254740991 });
        await highFetched.fetch();
        assert.strictEqual(highFetched.id, 9007199254740991);
        assert.strictEqual(highFetched.get('name'), 'safe last');
        const found = await callbackResult((done) => callStatic(BigItem, 'findOne', [{ id: 9007199254740990 }, done]));
        assert.ok(found instanceof BigItem);
        assert.strictEqual(found.id, 9007199254740990);
        assert.strictEqual(found.get('name'), 'updated safe penultimate');
        if (enabled) assert.strictEqual(found, highFirst);
        else assert.notStrictEqual(found, highFirst);
        const expected = [{ id: 1, name: 'updated first' }, { id: 2, name: 'second' }, { id: 9007199254740990, name: 'updated safe penultimate' }, { id: 9007199254740991, name: 'safe last' }];
        assert.deepStrictEqual(await database('big_increment_items').select('*').orderBy('id'), expected);
        assert.deepStrictEqual(await callbackResult((done) => callStatic(object(callStatic(BigItem, 'cursor', [{ $sort: 'id', $select: ['id', 'name'] }])), 'toJSON', [done])), expected);
        assert.deepStrictEqual(await database('sqlite_sequence').where({ name: 'big_increment_items' }).select('seq'), [{ seq: 9007199254740991 }]);
        const db = object(callControl(BigItem, 'db'));
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        assert.deepStrictEqual(reads, []);
        assert.deepStrictEqual(await database('big_increment_items').select('*').orderBy('id'), expected);
        await assert.rejects(callbackCompletion((done) => callStatic(db, 'resetSchema', [{}, done])), (error: unknown) => error === getterError);
        assert.deepStrictEqual(reads, optionKeys);
        assert.strictEqual(await database.schema.hasTable('big_increment_items'), false);
        assert.deepStrictEqual(await database('big_increment_sentinel').select('*'), [{ value: 'keep' }]);
        assert.strictEqual(coercions, 0);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`preserves authored SQLite increments and temporal constructor reads with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      class ConstructorItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///constructor_items';
      }
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const reads: Record<string, string[]> = { id: [], observed_date: [], observed_stamp: [] };
      const getterError = new Error('SQLite losing scalar constructor getter identity');
      let failGetter = false;
      let coercions = 0;
      const ignored = {
        get primaryKey(): never { coercions += 1; throw new Error('Original increments must not forward primaryKey options'); },
        get useTz(): never { coercions += 1; throw new Error('Original temporal objects must not become modern options'); },
        toString(): never { coercions += 1; throw new Error('SQLite scalar constructor arguments must not be coerced'); },
      };
      const fields: Record<string, unknown> = { name: ['String', { nullable: false }] };
      for (const [name, type] of [['id', 'iNcReMeNtS'], ['observed_date', 'DateTime'], ['observed_stamp', 'Timestamp']]) {
        const field = { type };
        for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
          reads[name].push(key);
          if (key === 'values' && failGetter) throw getterError;
          return ignored;
        } });
        fields[name] = field;
      }
      for (const [prefix, type] of [['date', 'DateTime'], ['stamp', 'Timestamp']]) {
        fields[`${prefix}_default`] = type;
        fields[`${prefix}_true`] = { type, value: true };
        fields[`${prefix}_false`] = { type, value: false };
        fields[`${prefix}_null`] = { type, value: null };
        fields[`${prefix}_undefined`] = { type, length: undefined, value: true };
        fields[`${prefix}_precision`] = { type, precision: 3, value: false };
        fields[`${prefix}_earlier`] = { type, textType: false, length: 5, value: true };
        fields[`${prefix}_object`] = { type, value: ignored };
        fields[`${prefix}_value_first`] = { type, value: false, values: true };
        fields[`${prefix}_values`] = { type, values: [] };
      }
      const temporalNames = Object.keys(fields).filter((name) => name !== 'id' && name !== 'name');
      const input = Object.fromEntries(temporalNames.map((name) => [name, '2026-10-01 12:34:56.789']));
      const rows = [{ id: 1, name: 'first', ...input }, { id: 2, name: 'second', ...input }];
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///constructor_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(ConstructorItem.prototype, 'schema', fields);
        try {
          ConstructorItem.prototype.sync = BackboneSQL.sync(ConstructorItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((done) => callStatic(ConstructorItem, 'resetSchema', [{}, done]));
        for (const list of Object.values(reads)) {
          assert.deepStrictEqual(list, optionKeys);
          list.length = 0;
        }
        failGetter = true;
        await database.schema.createTable('constructor_sentinel', (table) => table.text('value'));
        await database('constructor_sentinel').insert({ value: 'keep' });
        const metadata: unknown = await database.raw('PRAGMA table_info(constructor_items)');
        assert.ok(Array.isArray(metadata));
        assert.deepStrictEqual(metadata.map((row: Record<string, unknown>) => [row.name, row.type, row.notnull, row.pk]).sort(), [
          ['id', 'INTEGER', 1, 1], ['name', 'varchar(255)', 1, 0],
          ...temporalNames.map((name) => [name, 'datetime', 0, 0]),
        ].sort());
        const ddl = await database('sqlite_schema').where({ name: 'constructor_items', type: 'table' }).first('sql');
        assert.ok(typeof ddl.sql === 'string' && /\bid\b[^,]*primary key autoincrement/i.test(ddl.sql));
        const first = new ConstructorItem({ name: 'first', ...input });
        const second = new ConstructorItem({ name: 'second', ...input });
        let successCalls = 0;
        await first.save(null, { success: () => { successCalls += 1; } });
        await second.save();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(successCalls, 1);
        assert.strictEqual(first.id, 1);
        assert.strictEqual(second.id, 2);
        assert.deepStrictEqual(await database('constructor_items').select('*').orderBy('id'), rows);
        assert.deepStrictEqual(await database('sqlite_sequence').where({ name: 'constructor_items' }).select('seq'), [{ seq: 2 }]);
        await assert.rejects(database('constructor_items').insert({ id: 1, name: 'duplicate' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_CONSTRAINT_PRIMARYKEY');
        const fetched = new ConstructorItem({ id: 1 });
        await fetched.fetch();
        assert.strictEqual(fetched.get('name'), 'first');
        assert.deepStrictEqual(await callbackResult((done) => callStatic(object(callStatic(ConstructorItem, 'cursor', [{ $sort: 'id', $select: ['id', 'name'] }])), 'toJSON', [done])), [{ id: 1, name: 'first' }, { id: 2, name: 'second' }]);
        let errorCalls = 0;
        let notified: unknown;
        const returned = new ConstructorItem({ name: null }).save(null, { error: (_model, error) => { errorCalls += 1; notified = error; } });
        assert.ok(returned instanceof Promise);
        await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_CONSTRAINT_NOTNULL');
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(errorCalls, 1);
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        const extraReads: string[] = [];
        const extra = { type: 'Timestamp' };
        for (const key of optionKeys) Object.defineProperty(extra, key, { enumerable: true, get(): unknown { extraReads.push(key); return ignored; } });
        const sync = ConstructorItem.prototype.sync;
        Reflect.set(ConstructorItem.prototype, 'schema', { ...fields, extra_stamp: extra });
        assert.strictEqual(BackboneSQL.sync(ConstructorItem, { filename }), sync);
        assert.deepStrictEqual(extraReads, []);
        const db = object(callControl(ConstructorItem, 'db'));
        assert.strictEqual(await observeCreation(db), null);
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        assert.deepStrictEqual(extraReads, optionKeys);
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        const extended = rows.map((row) => ({ ...row, extra_stamp: null }));
        const parsed = object(Reflect.get(object(callControl(ConstructorItem, 'schema')), 'fields'));
        Reflect.set(parsed, 'missing_date', fields.observed_date);
        assert.strictEqual(await observeCreation(db), getterError);
        assert.deepStrictEqual(reads.observed_date, optionKeys);
        assert.deepStrictEqual(reads.id, []);
        assert.deepStrictEqual(reads.observed_stamp, []);
        assert.strictEqual(await database.schema.hasColumn('constructor_items', 'missing_date'), false);
        assert.deepStrictEqual(await database('constructor_items').select('*').orderBy('id'), extended);
        reads.observed_date.length = 0;
        failGetter = false;
        assert.strictEqual(await observeCreation(db), null);
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        assert.deepStrictEqual(reads.observed_date, optionKeys);
        assert.deepStrictEqual(reads.id, []);
        assert.deepStrictEqual(reads.observed_stamp, []);
        assert.deepStrictEqual(await database('constructor_items').select('*').orderBy('id'), extended.map((row) => ({ ...row, missing_date: null })));
        failGetter = true;
        await assert.rejects(callbackCompletion((done) => callStatic(db, 'resetSchema', [{}, done])), (error: unknown) => error === getterError);
        assert.strictEqual(await database.schema.hasTable('constructor_items'), false);
        assert.deepStrictEqual(await database('constructor_sentinel').select('*'), [{ value: 'keep' }]);
        assert.strictEqual(coercions, 0);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`preserves unchecked SQLite enum constructors with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      class EnumItem extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///enum_items';
      }
      const labels = Object.freeze(['ready', "can't", "x'); DROP TABLE enum_sentinel; --"]);
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const constructorReads: string[] = [];
      const getterError = new Error('SQLite losing enum getter identity');
      let failGetter = false;
      let coercions = 0;
      const ignored = { toString(): string { coercions += 1; throw new Error('SQLite enum coercion must not run'); } };
      const observed = { type: 'Enum' };
      for (const key of optionKeys) {
        Object.defineProperty(observed, key, { enumerable: true, get(): unknown {
          constructorReads.push(key);
          if (key === 'values' && failGetter) throw getterError;
          return ignored;
        } });
      }
      const fields: Record<string, unknown> = {
        omitted: 'Enum',
        listed: ['eNu', { indexed: true, nullable: false, unique: true, values: labels }],
        empty: { type: 'Enum', values: Object.freeze([]) },
        null_value: { type: 'Enu', value: null, values: labels },
        undefined_value: { type: 'Enum', value: undefined, values: labels },
        scalar: { type: 'Enu', values: 7 },
        string_value: { type: 'Enum', value: 'ready' },
        boolean_value: { type: 'Enu', value: false },
        object_value: { type: 'Enum', value: ignored },
        throwing_entry: { type: 'Enu', values: [ignored, Symbol('ignored')] },
        custom_join: { type: 'Enum', value: { join(): never { coercions += 1; throw new Error('SQLite enum join must not run'); } } },
        typed: { type: 'Enu', values: new Uint8Array([1, 2]) },
        observed,
      };
      for (const key of optionKeys) fields[`first_${key.toLowerCase()}`] = { type: 'Enum', [key]: ignored, values: ignored };
      const attributes = Object.fromEntries(Object.keys(fields).map((key) => [key, `outside:${key}`]));
      const nativeRows = [{ id: 1, ...attributes }];
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///enum_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(EnumItem.prototype, 'schema', fields);
        try {
          EnumItem.prototype.sync = BackboneSQL.sync(EnumItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        assert.deepStrictEqual(constructorReads, []);
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((done) => callStatic(EnumItem, 'resetSchema', [{}, done]));
        assert.deepStrictEqual(constructorReads, optionKeys);
        constructorReads.length = 0;
        failGetter = true;
        await database.schema.createTable('enum_sentinel', (table) => table.text('value'));
        await database('enum_sentinel').insert({ value: 'keep' });
        const metadata: unknown = await database.raw('PRAGMA table_info(enum_items)');
        assert.ok(Array.isArray(metadata));
        assert.deepStrictEqual(metadata.filter((row: Record<string, unknown>) => row.name !== 'id').map((row: Record<string, unknown>) => [row.name, row.type, row.notnull]).sort(),
          Object.keys(fields).sort().map((name) => [name, 'varchar', name === 'listed' ? 1 : 0]));
        const ddl = await database('sqlite_schema').where({ name: 'enum_items', type: 'table' }).first('sql');
        assert.ok(typeof ddl.sql === 'string' && !/\bcheck\b/i.test(ddl.sql));
        const indexes: unknown = await database.raw('PRAGMA index_list(enum_items)');
        assert.ok(Array.isArray(indexes));
        assert.ok(indexes.some((row: Record<string, unknown>) => row.name === 'enum_items_listed_index' && row.unique === 0));
        assert.ok(indexes.some((row: Record<string, unknown>) => row.name === 'enum_items_listed_unique' && row.unique === 1));
        const saved = new EnumItem(attributes);
        await saved.save();
        assert.strictEqual(saved.id, 1);
        assert.deepStrictEqual(await database('enum_items').select('*'), nativeRows);
        const fetched = new EnumItem({ id: saved.id });
        await fetched.fetch();
        assert.strictEqual(fetched.get('listed'), attributes.listed);
        assert.deepStrictEqual(await callbackResult((done) => callStatic(object(callStatic(EnumItem, 'cursor', [{ $sort: 'id' }])), 'toJSON', [done])), nativeRows);
        for (const input of [attributes, { ...attributes, listed: null }]) {
          let calls = 0;
          let notified: unknown;
          const returned = new EnumItem(input).save(null, { error: (_model, error) => { calls += 1; notified = error; } });
          assert.ok(returned instanceof Promise);
          await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.deepStrictEqual(await database('enum_items').select('*'), nativeRows);
        }
        const sync = EnumItem.prototype.sync;
        const extraReads: string[] = [];
        const extra = { type: 'Enum', nullable: true };
        for (const key of optionKeys) Object.defineProperty(extra, key, { enumerable: true, get(): unknown { extraReads.push(key); return ignored; } });
        Reflect.set(EnumItem.prototype, 'schema', { ...fields, extra_enum: extra });
        assert.strictEqual(BackboneSQL.sync(EnumItem, { filename }), sync);
        assert.deepStrictEqual(constructorReads, []);
        assert.deepStrictEqual(extraReads, []);
        const db = object(callControl(EnumItem, 'db'));
        assert.strictEqual(await observeCreation(db), null);
        assert.deepStrictEqual(extraReads, optionKeys);
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        assert.deepStrictEqual(extraReads, optionKeys);
        assert.deepStrictEqual(constructorReads, []);
        assert.deepStrictEqual(await database('enum_items').select('*'), nativeRows.map((row) => ({ ...row, extra_enum: null })));
        const parsed = object(Reflect.get(object(callControl(EnumItem, 'schema')), 'fields'));
        Reflect.set(parsed, 'missing_enum', observed);
        assert.strictEqual(await observeCreation(db), getterError);
        assert.deepStrictEqual(constructorReads, optionKeys);
        assert.strictEqual(await database.schema.hasColumn('enum_items', 'missing_enum'), false);
        Reflect.deleteProperty(parsed, 'missing_enum');
        await callbackCompletion((done) => callStatic(db, 'ensureSchema', [done]));
        assert.deepStrictEqual(constructorReads, optionKeys);
        assert.deepStrictEqual(await database('enum_items').select('*'), nativeRows.map((row) => ({ ...row, extra_enum: null })));
        assert.deepStrictEqual(await database('enum_sentinel').select('*'), [{ value: 'keep' }]);
        assert.deepStrictEqual(labels, ['ready', "can't", "x'); DROP TABLE enum_sentinel; --"]);
        assert.strictEqual(coercions, 0);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`covers missing SQLite DateTime binding and native read boundaries with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');

      interface DateTimeAttributes extends Backbone.ObjectHash {
        id?: number;
        name?: string;
        occurred_at?: Date | number | null;
      }
      class DateTimeItem extends BackboneSQL.Backbone.Model<DateTimeAttributes> {
        urlRoot = 'sqlite3:///date_time_items';
      }

      const read = (query: Record<string, unknown>): Promise<unknown> => callbackResult((callback) => callStatic(object(callStatic(DateTimeItem, 'cursor', [query])), 'toJSON', [callback]));
      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///date_time_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(DateTimeItem.prototype, 'schema', { name: 'String', occurred_at: ['DateTime', { nullable: true }] });
        try {
          DateTimeItem.prototype.sync = BackboneSQL.sync(DateTimeItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((callback) => callStatic(DateTimeItem, 'resetSchema', [{}, callback]));
        const epoch = new Date(0);
        const later = new Date('2026-09-30T00:00:00.000Z');
        const updated = new Date('2026-10-01T00:00:00.000Z');
        const first = new DateTimeItem({ name: 'epoch', occurred_at: epoch });
        const second = new DateTimeItem({ name: 'later', occurred_at: later });
        const empty = new DateTimeItem({ name: 'empty', occurred_at: null });
        for (const model of [first, second, empty]) await model.save();

        // The SQLite driver binds Date as milliseconds; nativeToAttributes does not hydrate DateTime.
        const initial = [
          { name: 'epoch', occurred_at: 0 },
          { name: 'later', occurred_at: later.valueOf() },
          { name: 'empty', occurred_at: null },
        ];
        assert.deepStrictEqual(await database('date_time_items').select('name', 'occurred_at').orderBy('id'), initial);
        assert.deepStrictEqual(await read({ $select: ['name', 'occurred_at'], $sort: 'id' }), initial);
        assert.deepStrictEqual(await read({ $sort: 'id', $values: ['occurred_at'] }), [0, later.valueOf(), null]);
        assert.deepStrictEqual(await read({ $sort: 'id', $values: ['name', 'occurred_at'] }), [
          ['epoch', 0],
          ['later', later.valueOf()],
          ['empty', null],
        ]);
        assert.strictEqual(await read({ $one: true, $values: ['occurred_at'], id: first.id }), 0);
        assert.strictEqual(await read({ $one: true, $values: ['occurred_at'], id: empty.id }), null);
        assert.deepStrictEqual(await read({ $values: ['name'], occurred_at: epoch }), ['epoch']);
        assert.deepStrictEqual(await read({ $values: ['name'], occurred_at: { $gte: epoch, $lt: later } }), ['epoch']);
        assert.deepStrictEqual(await read({ $values: ['name'], occurred_at: { $in: [later] } }), ['later']);
        assert.strictEqual(await callbackResult((callback) => callStatic(DateTimeItem, 'count', [{ occurred_at: { $exists: false } }, callback])), 1);

        const beforeFindID = second.id;
        assert.ok(typeof beforeFindID === 'number');
        const beforeFind = new DateTimeItem({ id: beforeFindID });
        await beforeFind.fetch();
        const beforeFindValue = beforeFind.get('occurred_at');
        // A cache hit returns the saved model JSON; a database read returns the native number.
        if (enabled) {
          assert.ok(beforeFindValue instanceof Date);
          assert.strictEqual(beforeFindValue.valueOf(), later.valueOf());
        } else assert.strictEqual(beforeFindValue, later.valueOf());

        const found = await callbackResult((callback) => callStatic(DateTimeItem, 'findOne', [{ id: second.id }, callback]));
        assert.ok(found instanceof DateTimeItem);
        assert.strictEqual(found.get('occurred_at'), later.valueOf());
        if (enabled) assert.strictEqual(found, second);
        await found.save({ occurred_at: updated });
        const refreshed = await callbackResult((callback) => callStatic(DateTimeItem, 'findOne', [{ id: second.id }, callback]));
        assert.ok(refreshed instanceof DateTimeItem);
        assert.strictEqual(refreshed.get('occurred_at'), updated.valueOf());
        const fetchedID = second.id;
        assert.ok(typeof fetchedID === 'number');
        const fetched = new DateTimeItem({ id: fetchedID });
        await fetched.fetch();
        assert.strictEqual(fetched.get('occurred_at'), updated.valueOf());
        const fetchedNullID = empty.id;
        assert.ok(typeof fetchedNullID === 'number');
        const fetchedNull = new DateTimeItem({ id: fetchedNullID });
        await fetchedNull.fetch();
        assert.strictEqual(fetchedNull.get('occurred_at'), null);
        assert.deepStrictEqual(await read({ $limit: 1, $offset: 1, $page: true, $sort: 'occurred_at', $values: ['occurred_at'], occurred_at: { $exists: true } }), { offset: 1, rows: [updated.valueOf()], total_rows: 2 });
        assert.deepStrictEqual(await database('date_time_items').select('name', 'occurred_at').orderBy('id'), [initial[0], { name: 'later', occurred_at: updated.valueOf() }, initial[2]]);
        assert.strictEqual(epoch.valueOf(), 0);
        assert.strictEqual(later.valueOf(), Date.parse('2026-09-30T00:00:00.000Z'));
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });

    it(`covers missing SQLite creation-side findOrCreate boundaries with cache ${enabled}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');

      class CreatedItem extends BackboneSQL.Backbone.Model<ItemAttributes> {
        urlRoot = 'sqlite3:///find_or_create_items';
      }

      let database: Knex | undefined;
      let connection: unknown;
      let poolKey: string | undefined;
      let cacheConfigured = false;
      const failure: { present: boolean; value: unknown } = { present: false, value: undefined };
      const findOrCreate = async (attributes: Record<string, unknown>): Promise<unknown> => {
        let calls = 0;
        try {
          return await callbackResult((callback) =>
            callStatic(CreatedItem, 'findOrCreate', [
              attributes,
              (error: unknown, value?: unknown) => {
                calls += 1;
                callback(error, value);
              },
            ])
          );
        } finally {
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
        }
      };
      try {
        mkdirSync(root, { recursive: true });
        poolKey = new BackboneORM.DatabaseURL('sqlite3:///find_or_create_items').format({ exclude_query: true, exclude_table: true });
        assert.strictEqual(BackboneORM.ConnectionPool.get(poolKey), undefined);
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        cacheConfigured = true;
        Reflect.set(CreatedItem.prototype, 'schema', {
          group_id: 'Integer',
          name: ['String', { nullable: false, unique: true }],
          score: 'Integer',
        });
        try {
          CreatedItem.prototype.sync = BackboneSQL.sync(CreatedItem, { filename });
        } finally {
          connection = BackboneORM.ConnectionPool.get(poolKey);
        }
        database = knexFactory({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
        await callbackCompletion((callback) => callStatic(CreatedItem, 'resetSchema', [{}, callback]));
        const input = Object.freeze({ group_id: 1, name: 'created', score: 10 });
        const created = await findOrCreate(input);
        assert.ok(created instanceof CreatedItem);
        assert.strictEqual(typeof created.id, 'number');
        assert.deepStrictEqual(created.toJSON(), { ...input, id: created.id });
        assert.deepStrictEqual(await database('find_or_create_items').select('*'), [{ ...input, id: created.id }]);

        const existing = await findOrCreate(input);
        assert.ok(existing instanceof CreatedItem);
        assert.strictEqual(existing.id, created.id);
        if (enabled) assert.strictEqual(existing, created);
        else assert.notStrictEqual(existing, created);
        const independent = await findOrCreate({ group_id: 2, name: 'independent', score: 20 });
        assert.ok(independent instanceof CreatedItem);
        assert.notStrictEqual(independent.id, created.id);
        assert.deepStrictEqual(input, { group_id: 1, name: 'created', score: 10 });

        // Full-data lookup misses this row; the creation branch must expose the real UNIQUE failure.
        await assert.rejects(findOrCreate({ ...input, score: 99 }), (error: unknown) => error instanceof Error && /UNIQUE constraint failed/.test(error.message));
        await assert.rejects(findOrCreate({ missing_column: 'not a row' }), /no such column/);
        assert.strictEqual(await callbackResult((callback) => callStatic(CreatedItem, 'count', [callback])), 2);
        assert.deepStrictEqual(await database('find_or_create_items').select('*').orderBy('id'), [
          { ...input, id: created.id },
          { group_id: 2, id: independent.id, name: 'independent', score: 20 },
        ]);
      } catch (error: unknown) {
        failure.present = true;
        failure.value = error;
      }
      await cleanupSQLiteFixture({ cacheConfigured, connection, database, poolKey, root }, failure);
    });
  }
});
