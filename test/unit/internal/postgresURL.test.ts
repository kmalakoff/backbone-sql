import assert from 'assert';
import BackboneORM from 'backbone-orm';
import { resolvePostgreSQLTarget } from '../../../src/internal/postgresURL.ts';

describe('internal PostgreSQL URL owner', () => {
  it('preserves explicit endpoint and separately decoded credentials without putting secrets into pool keys', () => {
    const target = resolvePostgreSQLTarget('postgres://user%3Aname:pass%3Aword%40host@localhost:15432/database/items', BackboneORM.DatabaseURL);
    assert.strictEqual(target.host, 'localhost');
    assert.strictEqual(target.port, 15432);
    assert.strictEqual(target.database, 'database');
    assert.strictEqual(target.table, 'items');
    assert.strictEqual(target.user, 'user:name');
    assert.strictEqual(target.password, 'pass:word@host');
    assert.ok(!target.poolKey.includes('pass'));
    assert.ok(!target.poolKey.includes('user'));
    assert.strictEqual(resolvePostgreSQLTarget('pg://user%3Aname:pass%3Aword%40host@localhost:15432/database/other', BackboneORM.DatabaseURL).poolKey, target.poolKey);
    assert.notStrictEqual(resolvePostgreSQLTarget('postgres://user%3Aname:another@localhost:15432/database/items', BackboneORM.DatabaseURL).poolKey, target.poolKey);
    assert.notStrictEqual(resolvePostgreSQLTarget('postgres://user%3Aname:pass%3Aword%40host@localhost:15433/database/items', BackboneORM.DatabaseURL).poolKey, target.poolKey);
  });

  it('rejects list/query/SSL/fragment and incomplete URL inputs with secret-free diagnostics', () => {
    for (const url of [
      'postgres://owner:secret@one:5432,two:5433/database/items',
      'postgres://owner:secret@localhost/database/items?sslmode=require',
      'postgres://owner:secret@localhost/database/items?',
      'postgres://owner:secret@localhost/database/items#fragment',
      'postgres://owner:secret@localhost/items',
      'postgres://owner:secret@localhost/database/public.items',
      'postgres://owner:secret@localhost:70000/database/items',
    ]) {
      assert.throws(
        () => resolvePostgreSQLTarget(url, BackboneORM.DatabaseURL),
        (error: unknown) => error instanceof Error && !error.message.includes('secret') && !('cause' in error)
      );
    }
  });
});
