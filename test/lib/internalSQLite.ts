import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BackboneORM from 'backbone-orm';
import { safeRmSync } from 'fs-remove-compat';

import { SQLiteConnection, SQLiteConnectionPool } from '../../src/internal/connection.ts';
import type { OwnedSQLConnection } from '../../src/internal/types.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratchRoot = path.join(repositoryRoot, '.tmp', 'internal-sql-tests');

export interface TestConnection {
  connection: OwnedSQLConnection;
  filename: string;
  modelURL: string;
  root: string;
}

export function createTestConnectionPool(): SQLiteConnectionPool {
  return new SQLiteConnectionPool(BackboneORM.ConnectionPool, { DatabaseURL: BackboneORM.DatabaseURL });
}

export function createTestConnection(suite: string, table = 'items'): TestConnection {
  const root = path.join(scratchRoot, `${suite}-${randomUUID()}`);
  const filename = path.join(root, 'database.sqlite3');
  const modelURL = `sqlite3:///${table}`;
  mkdirSync(root, { recursive: true });
  return {
    connection: new SQLiteConnection(modelURL, { DatabaseURL: BackboneORM.DatabaseURL }, { filename }),
    filename,
    modelURL,
    root,
  };
}

export function createPooledTestConnection(pool: SQLiteConnectionPool, suite: string, table = 'items'): TestConnection {
  const root = path.join(scratchRoot, `${suite}-${randomUUID()}`);
  const filename = path.join(root, 'database.sqlite3');
  const poolHost = `${suite}-${randomUUID()}`;
  const modelURL = `sqlite3://${poolHost}/${table}`;
  mkdirSync(root, { recursive: true });
  return {
    connection: pool.connect(modelURL, { filename }),
    filename,
    modelURL,
    root,
  };
}

export async function disposeTestConnection(testConnection: TestConnection): Promise<void> {
  await testConnection.connection.destroy();
  safeRmSync(testConnection.root);
}
