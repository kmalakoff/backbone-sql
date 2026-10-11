import type { ErrorCallback, ResultCallback } from './types.ts';

export type WorkerResult<T> = { error: Error } | { value: T };
export type CallbackWorker<T> = (complete: (result: WorkerResult<T>) => void) => void;

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new Error(String(error));
  Object.defineProperty(wrapped, 'cause', { configurable: true, value: error });
  return wrapped;
}

export function operationWorker<T>(operation: () => PromiseLike<T> | T): CallbackWorker<T> {
  return (complete) => {
    void Promise.resolve()
      .then(operation)
      .then(
        (value) => queueMicrotask(() => complete({ value })),
        (error: unknown) => queueMicrotask(() => complete({ error: toError(error) }))
      );
  };
}

function invokeWorker<T>(worker: CallbackWorker<T>, complete: (result: WorkerResult<T>) => void): void {
  let completed = false;
  const noNotificationError = Symbol('no notification error');
  let notificationError: unknown = noNotificationError;
  const completeOnce = (result: WorkerResult<T>): void => {
    if (completed) return;
    completed = true;
    try {
      complete(result);
    } catch (error: unknown) {
      notificationError = error;
      throw error;
    }
  };

  try {
    worker(completeOnce);
  } catch (error: unknown) {
    if (notificationError !== noNotificationError) throw notificationError;
    completeOnce({ error: toError(error) });
  }
  if (notificationError !== noNotificationError) throw notificationError;
}

export function runWorker<T>(worker: CallbackWorker<T>): Promise<T>;
export function runWorker<T>(worker: CallbackWorker<T>, callback: ResultCallback<T>): void;
export function runWorker<T>(worker: CallbackWorker<T>, callback?: ResultCallback<T>): Promise<T> | void {
  if (callback) {
    invokeWorker(worker, (result) => {
      if ('error' in result) callback(result.error);
      else callback(null, result.value);
    });
    return;
  }

  return new Promise<T>((resolve, reject) => {
    invokeWorker(worker, (result) => {
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    });
  });
}

export function runErrorWorker(worker: CallbackWorker<void>): Promise<void>;
export function runErrorWorker(worker: CallbackWorker<void>, callback: ErrorCallback): void;
export function runErrorWorker(worker: CallbackWorker<void>, callback?: ErrorCallback): Promise<void> | void {
  if (!callback) return runWorker(worker);
  return runWorker(worker, (error) => callback(error));
}

// Direct database controls require a callback and also return the operation's thenable.
export function runCallbackThenable<T>(worker: CallbackWorker<T>, callback: ResultCallback<T>): Promise<T> {
  const result = runWorker(worker);
  const notify = (error: Error | null, value?: T): void => {
    try {
      if (error) callback(error);
      else callback(null, value);
    } catch (notificationError: unknown) {
      queueMicrotask(() => {
        throw notificationError;
      });
    }
  };
  void result.then(
    (value) => notify(null, value),
    (error: unknown) => notify(toError(error))
  );
  return result;
}
