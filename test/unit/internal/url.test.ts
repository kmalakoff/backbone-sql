import { randomUUID } from 'node:crypto';
import assert from 'assert';
import BackboneORM from 'backbone-orm';

import { requireSQLProtocol, resolveSQLiteTarget } from '../../../src/internal/url.ts';

describe('resolveSQLiteTarget', () => {
  const DatabaseURL = BackboneORM.DatabaseURL;

  it('admits only existing SQL schemes with case-insensitive protocol names', () => {
    for (const [url, protocol] of [
      ['SQLITE:///items', 'sqlite:'],
      ['Sqlite3:///items', 'sqlite3:'],
      ['PG://localhost/database/items', 'pg:'],
      ['Postgres://localhost/database/items', 'postgres:'],
    ])
      assert.strictEqual(requireSQLProtocol(url), protocol);
    for (const url of [
      'postgresql://localhost/database/items',
      'postgres.foo://localhost/database/items',
      'postgres-test://localhost/database/items',
      'other://localhost/database/items',
      'postgres//localhost/database/items',
      ' pg://localhost/database/items',
      'post\ngres://localhost/database/items',
      'p\tg://localhost/database/items',
    ]) {
      assert.throws(
        () => requireSQLProtocol(url),
        (error: unknown) => error instanceof Error && error.message === 'Unrecognized sql variant' && !('cause' in error) && !('input' in error)
      );
    }
  });

  it('preserves the legacy in-memory URL forms', () => {
    assert.deepStrictEqual(resolveSQLiteTarget('sqlite3:///items', DatabaseURL), {
      filename: ':memory:',
      poolKey: 'sqlite3://',
      table: 'items',
    });
    assert.deepStrictEqual(resolveSQLiteTarget('sqlite:///items', DatabaseURL), {
      filename: ':memory:',
      poolKey: 'sqlite://',
      table: 'items',
    });
  });

  it('preserves host-as-filename and path-as-database behavior', () => {
    assert.deepStrictEqual(resolveSQLiteTarget('sqlite3://legacy.sqlite/items', DatabaseURL), {
      filename: 'legacy.sqlite',
      poolKey: 'sqlite3://legacy.sqlite',
      table: 'items',
    });
    assert.deepStrictEqual(resolveSQLiteTarget('sqlite3:///tmp/example.sqlite/items', DatabaseURL), {
      filename: ':memory:',
      poolKey: 'sqlite3:///tmp/example.sqlite',
      table: 'items',
    });
  });

  it('requires an explicit option for a file-backed path', () => {
    assert.deepStrictEqual(resolveSQLiteTarget('sqlite3:///items', DatabaseURL, { filename: '/private/example.sqlite3' }), {
      filename: '/private/example.sqlite3',
      poolKey: 'sqlite3://',
      table: 'items',
    });
  });

  it('rejects unsupported URLs and invalid ORM runtime values', () => {
    assert.throws(() => resolveSQLiteTarget('postgres://localhost/example/items', DatabaseURL), /Unrecognized sql variant/);
    assert.throws(() => resolveSQLiteTarget('sqlite3:///items', DatabaseURL, { filename: '' }), /must not be empty/);
    assert.throws(() => resolveSQLiteTarget('sqlite3:///items', undefined), /must be a constructor/);
    assert.throws(
      () =>
        resolveSQLiteTarget('sqlite3:///items', function InvalidDatabaseURL() {
          return {};
        }),
      /does not satisfy the SQL adapter contract/
    );
  });

  it('rejects non-SQLite schemes before ORM construction with a fixed secret-free diagnostic', () => {
    const secret = `direct-url-${randomUUID()}`;
    for (const url of [`postgres://owner:${secret}@localhost/database/items`, `pg://owner:${secret}@localhost/database/items`, `postgres.foo://owner:${secret}@localhost/database/items`, `arbitrary://owner:${secret}@localhost/database/items`, `sqlite3//owner:${secret}@localhost/items`]) {
      const rejected = (error: unknown): boolean => error instanceof Error && error.message === 'Unrecognized sql variant' && !('cause' in error) && !('input' in error) && !error.stack?.includes(secret);
      assert.throws(() => resolveSQLiteTarget(url, DatabaseURL), rejected);
      assert.throws(() => resolveSQLiteTarget(url, undefined), rejected);
    }
  });
});
