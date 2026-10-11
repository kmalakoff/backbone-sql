import assert from 'assert';
import BackboneORM from 'backbone-orm';
import BackboneSQL from 'backbone-sql';

import { FATAL_CALLBACK_REQUEST_MODES, isCallbackRequestMode } from '../lib/sqliteCallbackRequest.ts';

function call(host: object, name: string, ...arguments_: unknown[]): unknown {
  const operation: unknown = Reflect.get(host, name);
  if (typeof operation !== 'function') throw new Error(`Missing public operation: ${name}`);
  return Reflect.apply(operation, host, arguments_);
}

function object(value: unknown): object {
  assert.ok(typeof value === 'object' && value !== null);
  return value;
}

async function run(): Promise<void> {
  const [mode, filename, cache] = process.argv.slice(2);
  if (!isCallbackRequestMode(mode) || !filename || (cache !== 'true' && cache !== 'false')) throw new Error('Expected callback request mode, SQLite filename and cache true/false');
  const enabled = cache === 'true';
  BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
  assert.strictEqual(BackboneSQL.Backbone, BackboneORM.Backbone);
  assert.strictEqual(BackboneSQL.modules['backbone-orm'], BackboneORM);
  class RequestItem extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///callback_request_items';
    schema(): Record<string, unknown> {
      return { name: ['String', { nullable: false, unique: true }] };
    }
  }
  RequestItem.prototype.sync = BackboneSQL.sync(RequestItem, { filename });
  const db = object(call(RequestItem, 'db'));
  const connection = object(Reflect.get(db, 'connection'));
  const key: unknown = Reflect.get(connection, 'url');
  assert.strictEqual(typeof key, 'string');
  let driverError: unknown;
  const database = call(connection, 'knex');
  assert.ok(typeof database === 'function');
  call(database, 'on', 'query-error', (error: unknown) => {
    driverError = error;
  });
  let errorCalls = 0;
  let successCalls = 0;
  let callbackError: unknown;
  const sentinel = new Error(`owned caller notification threw: ${mode}`);
  const fatal = FATAL_CALLBACK_REQUEST_MODES.has(mode);
  let releaseNotification: () => void = () => assert.fail('Callback observer is not initialized');
  const notified = new Promise<void>((resolve) => {
    releaseNotification = resolve;
  });
  const notifyError = (error: unknown): void => {
    errorCalls += 1;
    callbackError = error;
    assert.ok(error instanceof Error);
    releaseNotification();
    if (mode.startsWith('error-throw')) throw sentinel;
  };
  const notifySuccess = (): void => {
    successCalls += 1;
    releaseNotification();
    if (mode.startsWith('success-throw')) throw sentinel;
    assert.fail('A missing SQLite row unexpectedly succeeded');
  };
  if (fatal) {
    // This monitor only records evidence; strict unhandled rejection still terminates the child.
    process.once('uncaughtExceptionMonitor', (error: unknown) => {
      const expected = mode === 'raw-ignored' ? driverError : sentinel;
      process.stdout.write(`callback-request-fatal ${JSON.stringify({ mode, enabled, sameError: error === expected, errorCalls, successCalls })}\n`);
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const returned = call(db, 'createOrUpdateTable', {}, (error: unknown) => (error ? reject(error) : resolve()));
      assert.strictEqual(returned, undefined);
    });
    const seeded = new RequestItem({ name: 'seeded' });
    await call(seeded, 'save');
    assert.strictEqual(seeded.id, 1);
    // A cache hit notifies synchronously; this fixture exercises the SQL request instead.
    if (enabled && mode.startsWith('success-throw')) call(object(call(seeded, 'cache')), 'destroy', seeded.id);
    const model = new RequestItem({ id: mode.startsWith('success-throw') ? 1 : 999999 });
    let returned: unknown;
    if (mode.startsWith('raw-')) {
      const dropping = call(db, 'dropTable', (error: unknown) => assert.ifError(error));
      await dropping;
      returned = call(RequestItem.prototype, 'sync', 'read', model, {});
    } else if (mode === 'await-only') {
      returned = call(model, 'fetch');
    } else if (mode === 'trailing-ignored' || mode === 'both-trailing') {
      returned = call(model, 'fetch', (error: unknown, callbackModel: unknown) => {
        assert.strictEqual(callbackModel, model);
        notifyError(error);
      });
    } else {
      returned = call(model, 'fetch', {
        error: (callbackModel: unknown, error: unknown) => {
          assert.strictEqual(callbackModel, model);
          notifyError(error);
        },
        success: (callbackModel: unknown) => {
          assert.strictEqual(callbackModel, model);
          notifySuccess();
        },
      });
    }
    assert.ok(returned instanceof Promise);
    let requestError: unknown;
    if (!mode.endsWith('ignored')) {
      const outcome = returned.then(
        () => assert.fail('Expected the same request to reject'),
        (error: unknown) => error
      );
      requestError = await outcome;
      if (mode.startsWith('raw-')) {
        assert.strictEqual(requestError, driverError);
        assert.ok(requestError instanceof Error);
        assert.strictEqual(Reflect.get(requestError, 'code'), 'SQLITE_ERROR');
      } else if (mode.includes('-throw-')) {
        assert.strictEqual(requestError, sentinel);
      } else {
        assert.ok(requestError instanceof Error);
        assert.match(requestError.message, /Model not found/);
        if (mode !== 'await-only') assert.strictEqual(requestError, callbackError);
      }
    }
    if (!mode.startsWith('raw-') && mode !== 'await-only') await notified;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const expectedSuccessCalls = mode.startsWith('success-throw') ? 1 : 0;
    const expectedErrorCalls = mode.startsWith('raw-') || mode === 'await-only' || expectedSuccessCalls === 1 ? 0 : 1;
    assert.strictEqual(errorCalls, expectedErrorCalls);
    assert.strictEqual(successCalls, expectedSuccessCalls);
    if (callbackError) {
      assert.ok(callbackError instanceof Error);
      assert.match(callbackError.message, /Model not found/);
    }
    assert.strictEqual(fatal, false, 'An ignored raw rejection or caller throw must terminate the owned child');
  } finally {
    await call(RequestItem.prototype, 'sync', 'closeConnection');
  }
  assert.ok(typeof key === 'string');
  assert.strictEqual(BackboneORM.ConnectionPool.get(key), undefined);
  process.stdout.write(`callback-request-proof ${JSON.stringify({ mode, enabled, errorCalls, successCalls, cleanup: true })}\n`);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
