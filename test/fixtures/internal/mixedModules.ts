import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'assert';
import BackboneORM from 'backbone-orm';
import { safeRmSync } from 'fs-remove-compat';

import type { SQLiteConnectionPool } from '../../../src/internal/connection.ts';
import type { ErrorCallback } from '../../../src/internal/types.ts';

type ImportOrder = 'cjs-first' | 'esm-first';
type SQLiteConnectionPoolConstructor = typeof SQLiteConnectionPool;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratchRoot = path.join(repositoryRoot, '.tmp', 'mixed-module-sql-tests');
const require = createRequire(import.meta.url);

function isPoolConstructor(value: unknown): value is SQLiteConnectionPoolConstructor {
  if (typeof value !== 'function') return false;
  const prototype: unknown = Reflect.get(value, 'prototype');
  return typeof prototype === 'object' && prototype !== null && typeof Reflect.get(prototype, 'connect') === 'function' && typeof Reflect.get(prototype, 'closeConnection') === 'function';
}

function poolConstructor(module: unknown): SQLiteConnectionPoolConstructor {
  if (typeof module !== 'object' || module === null) throw new Error('SQL build did not export a module object');
  const direct: unknown = Reflect.get(module, 'SQLiteConnectionPool');
  const defaultExport: unknown = Reflect.get(module, 'default');
  const constructorValue: unknown = direct ?? (typeof defaultExport === 'object' && defaultExport !== null ? Reflect.get(defaultExport, 'SQLiteConnectionPool') : undefined);
  if (!isPoolConstructor(constructorValue)) throw new Error('SQL build did not export a valid SQLiteConnectionPool');
  return constructorValue;
}

async function loadConnectionModule(format: 'cjs' | 'esm'): Promise<unknown> {
  const filename = path.join(repositoryRoot, 'dist', format, 'internal', 'connection.js');
  if (format === 'cjs') return require(filename);
  return import(pathToFileURL(filename).href);
}

export async function runMixedModuleProof(order: ImportOrder): Promise<Record<string, unknown>> {
  const root = path.join(scratchRoot, `${order}-${randomUUID()}`);
  const filename = path.join(root, 'database.sqlite3');
  const modelURL = 'sqlite3:///primary_mixed_probe';
  mkdirSync(root, { recursive: true });

  const firstFormat = order === 'cjs-first' ? 'cjs' : 'esm';
  const secondFormat = order === 'cjs-first' ? 'esm' : 'cjs';
  const FirstPool = poolConstructor(await loadConnectionModule(firstFormat));
  const SecondPool = poolConstructor(await loadConnectionModule(secondFormat));
  const dependencies = { DatabaseURL: BackboneORM.DatabaseURL };
  const firstPool = new FirstPool(BackboneORM.ConnectionPool, dependencies);
  const secondPool = new SecondPool(BackboneORM.ConnectionPool, dependencies);
  const connection = firstPool.connect(modelURL, { filename });
  let closed = false;
  let destroyCalls = 0;

  try {
    await connection.knex().schema.createTable('primary_mixed_probe', (table) => {
      table.increments('id').primary();
      table.text('value').notNullable();
    });
    await connection.knex()('primary_mixed_probe').insert({ value: order });

    const reused = secondPool.connect(modelURL, { filename });
    assert.strictEqual(reused, connection);
    assert.strictEqual(connection.url, 'sqlite3://');
    assert.notStrictEqual(modelURL, connection.url);
    assert.deepStrictEqual(await reused.knex()('primary_mixed_probe').select('value'), [{ value: order }]);

    const originalDestroy: unknown = Reflect.get(connection, 'destroy');
    if (typeof originalDestroy !== 'function') throw new Error('SQLite connection destroy must be a function');
    Reflect.set(connection, 'destroy', (callback?: ErrorCallback) => {
      destroyCalls += 1;
      if (callback) {
        Reflect.apply(originalDestroy, connection, [callback]);
        return;
      }
      return Reflect.apply(originalDestroy, connection, []);
    });

    const promiseClose = secondPool.closeConnection(modelURL);
    const callbackClose = new Promise<void>((resolve, reject) => {
      const result = firstPool.closeConnection(connection.url, (error) => {
        if (error) reject(error);
        else resolve();
      });
      assert.strictEqual(result, undefined);
    });
    await Promise.all([promiseClose, callbackClose]);
    closed = true;

    assert.strictEqual(destroyCalls, 1);
    assert.strictEqual(firstPool.get(connection.url), undefined);
    assert.strictEqual(secondPool.get(connection.url), undefined);
    return { destroyCalls, modelURL, normalizedKey: connection.url, order, reused: true };
  } finally {
    await firstPool.closeConnection(modelURL).catch(() => undefined);
    if (!closed) await connection.destroy().catch(() => undefined);
    safeRmSync(root);
  }
}
