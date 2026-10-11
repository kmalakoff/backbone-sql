import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import assert from 'assert';
import BackboneORM from 'backbone-orm';
import { safeRmSync } from 'fs-remove-compat';
import type { Knex } from 'knex';

import { SQLiteConnection } from '../../../src/internal/connection.ts';
import type { ErrorCallback, OwnedSQLConnection } from '../../../src/internal/types.ts';
import { createPooledTestConnection, createTestConnection, createTestConnectionPool } from '../../lib/internalSQLite.ts';

class ControlledRealConnection implements OwnedSQLConnection {
  readonly filename: string;
  readonly table: string | null;
  readonly url: string;
  closeCalls = 0;

  private readonly close: () => Promise<void>;
  private readonly connection: OwnedSQLConnection;
  private destroyPromise?: Promise<void>;

  constructor(connection: OwnedSQLConnection, url: string, close: () => Promise<void>) {
    this.close = close;
    this.connection = connection;
    this.filename = connection.filename;
    this.table = connection.table;
    this.url = url;
  }

  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
  destroy(callback?: ErrorCallback): Promise<void> | void {
    if (!this.destroyPromise) {
      this.closeCalls += 1;
      this.destroyPromise = this.close();
    }
    if (!callback) return this.destroyPromise;
    void this.destroyPromise.then(
      () => callback(null),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)))
    );
  }

  knex(): Knex {
    return this.connection.knex();
  }
}

describe('accepted ORM SQLite connection pool lifecycle', () => {
  it('rejects direct non-SQLite resolver paths before connection construction or pool adoption', async () => {
    const pool = createTestConnectionPool();
    const secret = `pool-secret-${randomUUID()}`;
    const entries = (): Map<unknown, unknown> => {
      const snapshot = new Map<unknown, unknown>();
      BackboneORM.ConnectionPool.forEach((value, key) => snapshot.set(key, value));
      return snapshot;
    };
    const before = entries();
    const standalone: OwnedSQLConnection[] = [];
    let failure: { value: unknown } | undefined;
    let calls = 0;
    try {
      for (const url of [
        `postgres://owner:${secret}@localhost/database/items`,
        `pg://owner:${secret}@localhost/database/items`,
        `postgres.foo://owner:${secret}@localhost/database/items`,
        `postgres-test://owner:${secret}@localhost/database/items`,
        `arbitrary://owner:${secret}@localhost/database/items`,
        `sqlite3//owner:${secret}@localhost/items`,
      ]) {
        const rejected = (error: unknown): boolean => {
          assert.ok(error instanceof Error);
          assert.strictEqual(error.message, 'Unrecognized sql variant');
          assert.strictEqual('cause' in error, false);
          assert.strictEqual('input' in error, false);
          assert.ok(!error.stack?.includes(secret));
          return true;
        };
        assert.throws(() => standalone.push(new SQLiteConnection(url, { DatabaseURL: BackboneORM.DatabaseURL })), rejected);
        assert.throws(() => pool.connect(url), rejected);
        assert.throws(() => pool.closeConnection(url), rejected);
        assert.throws(
          () =>
            pool.closeConnection(url, () => {
              calls += 1;
            }),
          rejected
        );
        const after = entries();
        assert.deepStrictEqual([...after.keys()], [...before.keys()]);
        for (const [key, value] of before) assert.strictEqual(after.get(key), value);
      }
      assert.strictEqual(calls, 0);
    } catch (value) {
      failure = { value };
    }
    const errors: unknown[] = failure ? [failure.value] : [];
    for (const connection of standalone) {
      try {
        await connection.destroy();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const [key, connection] of entries()) {
      if (before.has(key)) continue;
      try {
        assert.ok(typeof key === 'string');
        if (BackboneORM.ConnectionPool.get(key) !== connection) throw new Error('Rejected direct pool entry was replaced; replacement not disposed');
        await BackboneORM.ConnectionPool.dispose(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const aggregate: unknown = Reflect.get(globalThis, 'AggregateError');
      assert.ok(typeof aggregate === 'function');
      throw Reflect.construct(aggregate, [errors, 'Direct SQLite protocol fixture cleanup failed']);
    }
  });

  it('reuses real connections and closes owned entries through callback and Promise APIs', async () => {
    const pool = createTestConnectionPool();
    const first = createPooledTestConnection(pool, 'pool-first');
    const second = createPooledTestConnection(pool, 'pool-second');
    const foreignURL = `${first.connection.url}-foreign/items`;
    const foreignKey = new BackboneORM.DatabaseURL(foreignURL).format({ exclude_query: true, exclude_table: true });

    try {
      await first.connection.knex().raw('select 1 as value');
      await second.connection.knex().raw('select 2 as value');
      assert.strictEqual(existsSync(first.filename), true);
      assert.strictEqual(existsSync(second.filename), true);

      const reused = pool.connect(`${first.connection.url}/items`, { filename: first.filename });
      assert.strictEqual(reused, first.connection);
      assert.strictEqual(pool.get(first.connection.url), first.connection);
      assert.throws(() => pool.connect(`${first.connection.url}/items`, { filename: second.filename }), /different filename/);
      BackboneORM.ConnectionPool.set(foreignKey, first.connection.knex());
      assert.throws(() => pool.connect(foreignURL, { filename: first.filename }), /does not satisfy the SQL connection contract/);
      BackboneORM.ConnectionPool.del(foreignKey);

      assert.notStrictEqual(first.modelURL, first.connection.url);
      await new Promise<void>((resolve, reject) => {
        const result = pool.closeConnection(first.modelURL, (error) => {
          if (error) reject(error);
          else resolve();
        });
        assert.strictEqual(result, undefined);
      });
      assert.strictEqual(pool.get(first.connection.url), undefined);

      await pool.disposeAll();
      assert.strictEqual(pool.get(second.connection.url), undefined);
      await pool.closeConnection('sqlite3://missing/items');
    } finally {
      BackboneORM.ConnectionPool.del(foreignKey);
      await Promise.all([first.connection.destroy(), second.connection.destroy()]);
      safeRmSync(first.root);
      safeRmSync(second.root);
    }

    assert.strictEqual(existsSync(first.root), false);
    assert.strictEqual(existsSync(second.root), false);
  });

  it('coalesces concurrent disposal, waits for every real close, and retains failed entries', async () => {
    const pool = createTestConnectionPool();
    const failingFixture = createTestConnection('pool-failing');
    const delayedFixture = createTestConnection('pool-delayed');
    const original = new Error('injected close failure after real SQLite teardown');
    let releaseDelayed: (() => void) | undefined;
    let reportFailure: (() => void) | undefined;
    let delayedClosed = false;
    const delayedGate = new Promise<void>((resolve) => {
      releaseDelayed = resolve;
    });
    const failureReported = new Promise<void>((resolve) => {
      reportFailure = resolve;
    });
    const failing = new ControlledRealConnection(failingFixture.connection, 'sqlite3://failing', async () => {
      await failingFixture.connection.destroy();
      reportFailure?.();
      throw original;
    });
    const delayed = new ControlledRealConnection(delayedFixture.connection, 'sqlite3://delayed', async () => {
      await delayedGate;
      await delayedFixture.connection.destroy();
      delayedClosed = true;
    });

    try {
      await failing.knex().raw('select 1 as value');
      await delayed.knex().raw('select 2 as value');
      pool.setOwned(failing);
      pool.setOwned(delayed);

      const promiseDisposal = pool.disposeAll();
      const callbackDisposal = new Promise<void>((resolve, reject) => {
        const result = pool.disposeAll((error) => {
          if (error) reject(error);
          else resolve();
        });
        assert.strictEqual(result, undefined);
      });
      let promiseSettled = false;
      let callbackSettled = false;
      void promiseDisposal.then(
        () => {
          promiseSettled = true;
        },
        () => {
          promiseSettled = true;
        }
      );
      void callbackDisposal.then(
        () => {
          callbackSettled = true;
        },
        () => {
          callbackSettled = true;
        }
      );
      await failureReported;
      await Promise.resolve();
      assert.strictEqual(promiseSettled, false);
      assert.strictEqual(callbackSettled, false);

      releaseDelayed?.();
      await assert.rejects(promiseDisposal, (error: unknown) => error === original);
      await assert.rejects(callbackDisposal, (error: unknown) => error === original);
      assert.strictEqual(delayedClosed, true);
      assert.strictEqual(failing.closeCalls, 1);
      assert.strictEqual(delayed.closeCalls, 1);
      assert.strictEqual(pool.get('sqlite3://delayed'), undefined);
      assert.strictEqual(pool.get('sqlite3://failing'), failing);
      await assert.rejects(pool.closeConnection('sqlite3://failing/items'), (error: unknown) => error === original);
      assert.strictEqual(failing.closeCalls, 1);
    } finally {
      releaseDelayed?.();
      BackboneORM.ConnectionPool.del('sqlite3://failing');
      BackboneORM.ConnectionPool.del('sqlite3://delayed');
      await Promise.all([failingFixture.connection.destroy().catch(() => undefined), delayedFixture.connection.destroy()]);
      safeRmSync(failingFixture.root);
      safeRmSync(delayedFixture.root);
    }
  });
});
