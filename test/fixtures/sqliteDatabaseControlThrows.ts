import assert from 'assert';
import BackboneORM from 'backbone-orm';
import BackboneSQL from 'backbone-sql';

function call(host: object, name: string, ...arguments_: unknown[]): unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing public operation: ${name}`);
  return Reflect.apply(method, host, arguments_);
}

function object(value: unknown): object {
  if (typeof value !== 'object' || value === null) throw new Error('Expected a public control object');
  return value;
}

async function run(): Promise<void> {
  const mode = process.argv[2];
  const filename = process.argv[3];
  if (!mode || !filename) throw new Error('Callback throw fixture requires mode and filename');
  class ControlThrowItem extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///control_throw_items';
    schema(): Record<string, unknown> {
      return { name: 'String' };
    }
  }
  ControlThrowItem.prototype.sync = BackboneSQL.sync(ControlThrowItem, { filename });
  const db = object(call(ControlThrowItem, 'db'));
  const connection = object(Reflect.get(db, 'connection'));
  const database: unknown = call(connection, 'knex');
  if (typeof database !== 'function') throw new Error('Public connection did not return Knex');
  const key: unknown = Reflect.get(connection, 'url');
  assert.strictEqual(typeof key, 'string');
  const sentinel = new Error(`caller callback threw: ${mode}`);
  let callbackCalls = 0;
  let callbackError: unknown;
  let driverError: unknown;
  call(database, 'on', 'query-error', (error: unknown) => {
    driverError = error;
  });

  try {
    if (mode !== 'dropTableError' && mode !== 'createOrUpdateTableError' && mode !== 'ensureSchemaError') {
      await new Promise<void>((resolve, reject) => {
        const returned = call(db, 'createOrUpdateTable', {}, (error: unknown) => (error ? reject(error) : resolve()));
        assert.strictEqual(returned, undefined);
      });
    }
    const readonlyFailure = mode === 'createOrUpdateTableError' || mode === 'ensureSchemaError' || mode === 'resetSchemaError';
    if (readonlyFailure) await call(database, 'raw', 'PRAGMA query_only = ON');

    const escaped = new Promise<Error>((resolve) => process.once('uncaughtException', resolve));
    const callback = (...arguments_: unknown[]): never => {
      const [error] = arguments_;
      callbackCalls += 1;
      callbackError = error;
      throw sentinel;
    };
    const name = mode.endsWith('Error') ? mode.slice(0, -5) : mode;
    const callbackOnly = name === 'createOrUpdateTable' || name === 'ensureSchema' || name === 'resetSchema';
    const arguments_ = name === 'hasColumn' ? ['name', callback] : name === 'renameTable' ? ['renamed_throw_items', callback] : callbackOnly ? [{}, callback] : [callback];
    const returned = call(db, name, ...arguments_);
    let operationError: unknown = null;
    if (callbackOnly) assert.strictEqual(returned, undefined);
    else {
      assert.ok(returned instanceof Promise);
      await returned.catch((error: unknown) => {
        operationError = error;
      });
    }
    assert.strictEqual(await escaped, sentinel);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(callbackCalls, 1);
    if (mode === 'dropTableError' || readonlyFailure) {
      assert.ok(callbackError instanceof Error);
      assert.strictEqual(callbackError, driverError);
      if (!callbackOnly) assert.strictEqual(operationError, callbackError);
    } else {
      assert.strictEqual(callbackError, null);
      assert.strictEqual(operationError, null);
    }
    if (name === 'ensureSchema' || name === 'resetSchema') {
      if (readonlyFailure) await call(database, 'raw', 'PRAGMA query_only = OFF');
      let recoveryCalls = 0;
      await new Promise<void>((resolve, reject) => {
        const recovery = call(db, 'ensureSchema', (error: unknown) => {
          recoveryCalls += 1;
          if (error) reject(error);
          else resolve();
        });
        assert.strictEqual(recovery, undefined);
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(recoveryCalls, 1);
    }
  } finally {
    await call(ControlThrowItem.prototype, 'sync', 'closeConnection');
  }
  assert.ok(typeof key === 'string');
  assert.strictEqual(BackboneORM.ConnectionPool.get(key), undefined);
  process.stdout.write('callback throw escaped once; connection cleanup confirmed\n');
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
