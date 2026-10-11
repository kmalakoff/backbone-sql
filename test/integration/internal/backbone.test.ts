import assert from 'assert';
import BackboneORM from 'backbone-orm';

import { BackboneSQLiteSync } from '../../../src/internal/backbone.ts';
import SQLQuery from '../../../src/internal/query.ts';
import SQLSchema from '../../../src/internal/schema.ts';
import type { SQLColumnDefinition } from '../../../src/internal/types.ts';
import { createPooledTestConnection, createTestConnectionPool, disposeTestConnection } from '../../lib/internalSQLite.ts';

interface ItemAttributes extends Backbone.ObjectHash {
  group_id?: number;
  id?: number;
  name?: string;
  score?: number;
}

class Item extends BackboneORM.Backbone.Model<ItemAttributes> {
  urlRoot = 'sqlite3:///items';
}

class Items extends BackboneORM.Backbone.Collection<Item> {
  model = Item;
}

const itemColumns: readonly SQLColumnDefinition[] = [
  { name: 'id', primary: true, type: 'increments' },
  { name: 'group_id', nullable: false, type: 'integer' },
  { name: 'name', nullable: false, type: 'string', unique: true },
  { name: 'score', nullable: false, type: 'integer' },
];

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';
}

function callStatic(host: object, name: string, arguments_: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing static ORM method: ${name}`);
  return Reflect.apply(method, host, arguments_);
}

function callbackResult(invoke: (callback: (error: unknown, value?: unknown) => void) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const result = invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
    assert.strictEqual(result, undefined);
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

describe('internal Backbone SQLite sync', () => {
  it('snapshots current definitions for fallback DDL and each real write', async () => {
    const connectionPool = createTestConnectionPool();
    const fixture = createPooledTestConnection(connectionPool, 'current-column-supplier', 'items');
    class SupplierItem extends BackboneORM.Backbone.Model {}
    let definitions: readonly SQLColumnDefinition[] = [
      { name: 'id', type: 'increments' },
      { name: 'name', type: 'string' },
    ];
    let snapshots = 0;
    const sync = new BackboneSQLiteSync(SupplierItem, fixture.connection, connectionPool, 'items', BackboneORM.Utils, undefined, () => {
      snapshots += 1;
      return definitions;
    });
    const query = new SQLQuery(fixture.connection.knex(), 'items');
    try {
      await sync.resetOwnedSchema();
      assert.strictEqual(snapshots, 1);
      definitions = [...definitions, { name: 'score', type: 'integer' }];
      assert.strictEqual(await new SQLSchema(fixture.connection.knex(), 'items').hasColumn('score'), false);
      await callbackCompletion((callback) => sync.db().createOrUpdateTable({}, callback));
      assert.strictEqual(snapshots, 2);
      const model = new SupplierItem({ ignored: 'not a column', name: 'retained', score: 10 });
      let created: unknown;
      await sync.adapter('create', model, {
        success: (value: unknown) => {
          created = value;
        },
      });
      assert.strictEqual(snapshots, 3);
      assert.deepStrictEqual(created, { id: 1, name: 'retained', score: 10 });
      assert.deepStrictEqual(await query.select(), [{ id: 1, name: 'retained', score: 10 }]);
      model.set({ id: 1, score: 20 });
      await sync.adapter('patch', model, {});
      assert.strictEqual(snapshots, 4);
      assert.deepStrictEqual(await query.select(), [{ id: 1, name: 'retained', score: 20 }]);
      await sync.adapter('update', model, {});
      assert.strictEqual(snapshots, 5);
      await sync.resetOwnedSchema();
      assert.strictEqual(snapshots, 6);
      assert.strictEqual(await new SQLSchema(fixture.connection.knex(), 'items').hasColumn('score'), true);
      assert.deepStrictEqual(await query.select(), []);
    } finally {
      try {
        await connectionPool.disposeAll();
      } finally {
        await disposeTestConnection(fixture);
      }
    }
  });

  it('runs accepted-ORM model CRUD, collection fetch, cursor reads, and driver errors on real SQLite', async () => {
    const connectionPool = createTestConnectionPool();
    const fixture = createPooledTestConnection(connectionPool, 'backbone-sync', 'items');
    const schema = new SQLSchema(fixture.connection.knex(), 'items');
    const query = new SQLQuery(fixture.connection.knex(), 'items');
    BackboneORM.configure({ model_cache: { enabled: true, max: 100 } });
    const ormSchema = new BackboneORM.Schema(Item, { id: { type: 'Integer' } });
    const ConfiguredItem = BackboneORM.configureModel(Item);
    Items.prototype.model = ConfiguredItem;
    const sync = new BackboneSQLiteSync(ConfiguredItem, fixture.connection, connectionPool, 'items', BackboneORM.Utils, ormSchema, itemColumns);

    try {
      await schema.ensureSchema(itemColumns);
      sync.install(BackboneORM.model_cache);
      sync.installCollection(Items);

      const alpha = new ConfiguredItem({ group_id: 1, name: 'alpha', score: 10 });
      const beta = new ConfiguredItem({ group_id: 1, name: 'beta', score: 20 });
      const createRequest: unknown = alpha.save();
      assert.strictEqual(isPromiseLike(createRequest), true);
      await createRequest;
      await beta.save();
      assert.strictEqual(alpha.id, 1);
      assert.strictEqual(beta.id, 2);

      const fetched = new ConfiguredItem({ id: alpha.id });
      await fetched.fetch();
      assert.deepStrictEqual(fetched.toJSON(), { group_id: 1, id: 1, name: 'alpha', score: 10 });

      fetched.set('score', 30);
      await fetched.save();
      assert.deepStrictEqual(await query.select({ columns: ['id', 'score'], where: { id: alpha.id } }), [{ id: 1, score: 30 }]);

      const collection = new Items();
      await collection.fetch();
      assert.strictEqual(collection.length, 2);
      assert.deepStrictEqual(collection.pluck('name').sort(), ['alpha', 'beta']);

      assert.deepStrictEqual(await sync.cursor({ $limit: 1, $sort: '-score', group_id: 1 }).toJSON(), [{ group_id: 1, id: 1, name: 'alpha', score: 30 }]);
      const found = await ConfiguredItem.find({ group_id: 1 });
      assert.strictEqual(found.length, 2);
      assert.strictEqual(
        found.every((model) => model instanceof BackboneORM.Backbone.Model),
        true
      );

      assert.strictEqual(await callbackResult((callback) => callStatic(ConfiguredItem, 'count', [{ group_id: 1 }, callback])), 2);
      assert.strictEqual(await callbackResult((callback) => callStatic(ConfiguredItem, 'exists', [{ name: 'alpha' }, callback])), true);
      const all = await callbackResult((callback) => callStatic(ConfiguredItem, 'all', [callback]));
      assert.ok(Array.isArray(all));
      assert.strictEqual(all.length, 2);
      assert.strictEqual(
        all.every((model) => model instanceof BackboneORM.Backbone.Model),
        true
      );
      const one = await callbackResult((callback) => callStatic(ConfiguredItem, 'findOne', [{ name: 'beta' }, callback]));
      assert.ok(one instanceof ConfiguredItem);
      assert.strictEqual(one.get('name'), 'beta');
      const existing = await callbackResult((callback) => callStatic(ConfiguredItem, 'findOrCreate', [{ group_id: 1, name: 'beta', score: 20 }, callback]));
      assert.ok(existing instanceof ConfiguredItem);
      assert.strictEqual(existing.id, beta.id);
      const created = await callbackResult((callback) => callStatic(ConfiguredItem, 'findOrCreate', [{ group_id: 2, name: 'delta', score: 7 }, callback]));
      assert.ok(created instanceof ConfiguredItem);
      if (typeof created.id !== 'number') throw new Error('findOrCreate must return the generated numeric SQLite id');
      const createdID = created.id;
      assert.strictEqual(created.get('name'), 'delta');
      assert.deepStrictEqual(await query.select({ where: { id: createdID } }), [{ group_id: 2, id: createdID, name: 'delta', score: 7 }]);
      const cached = await callbackResult((callback) => callStatic(ConfiguredItem, 'findOrCreate', [{ group_id: 2, name: 'delta', score: 7 }, callback]));
      assert.strictEqual(cached, created);
      await query.update({ id: createdID }, { score: 8 });
      const refreshedCached = await callbackResult((callback) => callStatic(ConfiguredItem, 'findOne', [{ id: createdID }, callback]));
      assert.strictEqual(refreshedCached, created);
      assert.strictEqual(created.get('score'), 8);
      await query.update({ id: createdID }, { score: 9 });
      const cacheRead = new ConfiguredItem({ id: createdID });
      await cacheRead.fetch();
      assert.strictEqual(cacheRead.get('score'), 8);
      assert.deepStrictEqual(await query.select({ columns: ['score'], where: { id: createdID } }), [{ score: 9 }]);
      assert.strictEqual(callStatic(ConfiguredItem, 'schema', []), ormSchema);
      assert.strictEqual(callStatic(ConfiguredItem, 'tableName', []), 'items');
      const databaseControl = callStatic(ConfiguredItem, 'db', []);
      if (typeof databaseControl !== 'object' || databaseControl === null) throw new Error('db must return a database control object');
      assert.strictEqual(Reflect.get(databaseControl, 'connection'), fixture.connection);
      assert.strictEqual(Reflect.get(databaseControl, 'schema').table, 'items');

      const successSentinel = new Error('success callback failed');
      let successErrorCalls = 0;
      const successRequest: unknown = fetched.save(
        { score: 31 },
        {
          error() {
            successErrorCalls += 1;
          },
          success() {
            throw successSentinel;
          },
        }
      );
      assert.strictEqual(isPromiseLike(successRequest), true);
      await assert.rejects(Promise.resolve(successRequest), (error: unknown) => error === successSentinel);
      assert.strictEqual(successErrorCalls, 0);
      assert.deepStrictEqual(await query.select({ columns: ['score'], where: { id: alpha.id } }), [{ score: 31 }]);

      let duplicateError: unknown;
      let duplicateErrorCalls = 0;
      const errorSentinel = new Error('error callback failed');
      const duplicate = new ConfiguredItem({ group_id: 2, name: 'beta', score: 5 });
      const duplicateRequest: unknown = duplicate.save(null, {
        error(_model, response: unknown) {
          duplicateErrorCalls += 1;
          duplicateError = response;
          throw errorSentinel;
        },
      });
      assert.strictEqual(isPromiseLike(duplicateRequest), true);
      await assert.rejects(Promise.resolve(duplicateRequest), (error: unknown) => error === errorSentinel);
      assert.strictEqual(duplicateErrorCalls, 1);
      assert.ok(duplicateError instanceof Error);
      assert.match(duplicateError.message, /UNIQUE constraint failed/);
      assert.strictEqual(Reflect.get(duplicateError, 'code'), 'SQLITE_CONSTRAINT_UNIQUE');

      let missingError: unknown;
      const missing = new ConfiguredItem({ id: 999 });
      const missingRequest: unknown = missing.fetch({
        error(_model, response: unknown) {
          missingError = response;
        },
      });
      assert.strictEqual(isPromiseLike(missingRequest), true);
      await assert.rejects(Promise.resolve(missingRequest), (error: unknown) => error === missingError);
      assert.ok(missingError instanceof Error);
      assert.match(missingError.message, /Model not found\. Id 999/);

      await fetched.destroy();
      assert.strictEqual(await query.count(), 2);
      await callbackCompletion((callback) => callStatic(ConfiguredItem, 'destroy', [{ name: 'beta' }, callback]));
      assert.strictEqual(await query.count(), 1);
      await created.destroy();
      assert.strictEqual(await query.count(), 0);

      await new ConfiguredItem({ group_id: 2, name: 'gamma', score: 7 }).save();
      await callbackCompletion((callback) => callStatic(ConfiguredItem, 'resetSchema', [{}, callback]));
      assert.strictEqual(await schema.hasTable(), true);
      assert.strictEqual(await query.count(), 0);
    } finally {
      try {
        await new Promise<void>((resolve, reject) => {
          const result = sync.closeConnection((error) => {
            if (error) reject(error);
            else resolve();
          });
          assert.strictEqual(result, undefined);
        });
        await connectionPool.disposeAll();
      } finally {
        BackboneORM.configure({ model_cache: { enabled: false } });
        await disposeTestConnection(fixture);
      }
    }
  });
});
