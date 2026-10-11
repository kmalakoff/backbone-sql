import assert from 'assert';

import { type CallbackWorker, runCallbackThenable, runWorker, toError } from '../../../src/internal/settle.ts';

describe('callback worker facade', () => {
  it('notifies synchronously settled success before later then and await observers', async () => {
    const order: string[] = [];
    let calls = 0;
    const returned = runCallbackThenable<number>(
      (complete) => complete({ value: 42 }),
      (...arguments_) => {
        const [error, value] = arguments_;
        assert.strictEqual(arguments_.length, 2);
        calls += 1;
        assert.strictEqual(error, null);
        assert.strictEqual(value, 42);
        order.push('callback');
      }
    );
    assert.deepStrictEqual(order.slice(), []);
    const observed = returned.then((value) => {
      assert.deepStrictEqual(order.slice(), ['callback']);
      order.push('then');
      return value;
    });
    const value = await returned;
    assert.strictEqual(value, 42);
    assert.deepStrictEqual(order.slice(), ['callback', 'then']);
    order.push('await');
    assert.strictEqual(await observed, 42);
    assert.deepStrictEqual(order.slice(), ['callback', 'then', 'await']);
    assert.strictEqual(calls, 1);
  });

  it('notifies synchronously settled failure before later catch and await observers', async () => {
    const order: string[] = [];
    const original = new Error('synchronously settled original failure');
    let calls = 0;
    const returned = runCallbackThenable<number>(
      (complete) => complete({ error: original }),
      (...arguments_) => {
        const [error] = arguments_;
        assert.strictEqual(arguments_.length, 1);
        calls += 1;
        assert.strictEqual(error, original);
        order.push('callback');
      }
    );
    assert.deepStrictEqual(order.slice(), []);
    const observed = returned.catch((error: unknown) => {
      assert.strictEqual(error, original);
      assert.deepStrictEqual(order.slice(), ['callback']);
      order.push('catch');
      return error;
    });
    let awaitedError: unknown;
    try {
      await returned;
    } catch (error: unknown) {
      awaitedError = error;
    }
    assert.strictEqual(awaitedError, original);
    assert.deepStrictEqual(order.slice(), ['callback', 'catch']);
    order.push('await');
    assert.strictEqual(await observed, original);
    assert.deepStrictEqual(order.slice(), ['callback', 'catch', 'await']);
    assert.strictEqual(calls, 1);
  });

  it('returns an operation Promise alongside the required legacy callback without changing callback-void forms', async () => {
    for (const result of [{ value: 42 }, { error: new Error('legacy operation failed') }]) {
      let calls = 0;
      let notify: () => void = () => {};
      const notified = new Promise<void>((resolve) => {
        notify = resolve;
      });
      const returned = runCallbackThenable<number>(
        (complete) => {
          complete(result);
          complete({ value: 99 });
        },
        (...arguments_) => {
          const [error, value] = arguments_;
          assert.strictEqual(arguments_.length, 'error' in result ? 1 : 2);
          calls += 1;
          if ('error' in result) assert.strictEqual(error, result.error);
          else {
            assert.strictEqual(error, null);
            assert.strictEqual(value, result.value);
          }
          notify();
        }
      );
      assert.ok(returned instanceof Promise);
      if ('error' in result) await assert.rejects(returned, (error: unknown) => error === result.error);
      else assert.strictEqual(await returned, 42);
      await notified;
      assert.strictEqual(calls, 1);
    }
    assert.strictEqual(
      runWorker(
        (complete) => complete({ value: 1 }),
        () => {}
      ),
      undefined
    );
  });

  it('preserves the first Error and completes callback and Promise facades once', async () => {
    const original = new Error('original failure');
    const later = new Error('later failure');
    const worker: CallbackWorker<number> = (complete) => {
      complete({ error: original });
      complete({ value: 1 });
      throw later;
    };

    await assert.rejects(runWorker(worker), (error: unknown) => error === original);

    let callbackCalls = 0;
    runWorker(worker, (error) => {
      callbackCalls += 1;
      assert.strictEqual(error, original);
    });
    assert.strictEqual(callbackCalls, 1);
  });

  it('rethrows a caller callback exception without invoking the callback twice', () => {
    const sentinel = new Error('caller callback failed');
    let callbackCalls = 0;

    assert.throws(
      () =>
        runWorker(
          (complete) => complete({ value: 1 }),
          () => {
            callbackCalls += 1;
            throw sentinel;
          }
        ),
      (error: unknown) => error === sentinel
    );
    assert.strictEqual(callbackCalls, 1);
  });

  it('rethrows a caller callback exception even when the worker catches completion errors', () => {
    const sentinel = new Error('caught caller callback failure');
    let callbackCalls = 0;

    assert.throws(
      () =>
        runWorker(
          (complete) => {
            try {
              complete({ value: 1 });
            } catch (error: unknown) {
              void error;
            }
          },
          () => {
            callbackCalls += 1;
            throw sentinel;
          }
        ),
      (error: unknown) => error === sentinel
    );
    assert.strictEqual(callbackCalls, 1);
  });

  it('keeps the no-callback form Promise-only for synchronous completion and failure', async () => {
    const sentinel = new Error('worker failed');
    const valueResult = runWorker<number>((complete) => complete({ value: 1 }));
    const errorResult = runWorker<number>(() => {
      throw sentinel;
    });

    assert.ok(valueResult instanceof Promise);
    assert.ok(errorResult instanceof Promise);
    assert.strictEqual(await valueResult, 1);
    await assert.rejects(errorResult, (error: unknown) => error === sentinel);
  });

  it('retains a non-Error rejection as the normalized Error cause', () => {
    const original = { code: 'SQLITE_TEST' };
    const normalized = toError(original);
    assert.strictEqual(Reflect.get(normalized, 'cause'), original);
  });
});
