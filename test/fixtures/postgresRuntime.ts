import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'assert';
import BackboneORM from 'backbone-orm';
import { withPostgres } from '../lib/postgres.ts';

export async function postgresRuntimeSmoke(runtimeDirectory: string) {
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  assert.strictEqual(require('pg/package.json').version, '8.20.0');
  assert.strictEqual(BackboneORM.Backbone, require('backbone'));
  assert.strictEqual(require('backbone-orm').default?.Backbone ?? require('backbone-orm').Backbone, BackboneORM.Backbone);
  assert.ok(!require.resolve('pg').includes('/.iml/'));
  assert.ok(!require.resolve('backbone-orm').includes('/.iml/'));
  let clusterRoot: string | undefined;
  const result = await withPostgres(runtimeDirectory, async (fixture) => {
    clusterRoot = fixture.root;
    assert.strictEqual((await lstat(fixture.root)).mode & 0o777, 0o700);
    assert.strictEqual((await lstat(path.join(fixture.root, 'password'))).mode & 0o777, 0o600);
    const native = await fixture.database.raw(
      `select version() as version, current_setting('server_version') as server_version,
      current_setting('shared_preload_libraries') as shared_preload,
      current_setting('local_preload_libraries') as local_preload,
      current_setting('session_preload_libraries') as session_preload,
      current_setting('max_connections') as max_connections, current_setting('shared_buffers') as shared_buffers,
      current_setting('unix_socket_directories') as socket_directory,
      true as truth, false as falsehood, null::boolean as nullable,
      ?::timestamptz as instant, ?::json as object`,
      [new Date('2026-10-01T12:34:56.789Z'), JSON.stringify({ native: true, count: 7 })]
    );
    const row = native.rows[0];
    assert.strictEqual(row.server_version, '18.4');
    assert.strictEqual(row.shared_preload, '');
    assert.strictEqual(row.local_preload, '');
    assert.strictEqual(row.session_preload, '');
    assert.strictEqual(row.max_connections, '10');
    assert.strictEqual(row.shared_buffers, '32MB');
    assert.strictEqual(row.socket_directory, 'socket');
    assert.strictEqual(row.truth, true);
    assert.strictEqual(row.falsehood, false);
    assert.strictEqual(row.nullable, null);
    assert.ok(row.instant instanceof Date);
    assert.strictEqual(row.instant.toISOString(), '2026-10-01T12:34:56.789Z');
    assert.deepStrictEqual(row.object, { native: true, count: 7 });
    const auth = await fixture.database.raw("select (rolpassword like 'SCRAM-SHA-256$%') as scram from pg_authid where rolname = ?", ['sql_owner']);
    assert.strictEqual(auth.rows[0].scram, true);
    const hba = await readFile(path.join(fixture.data, 'pg_hba.conf'), 'utf8');
    assert.ok(!hba.split('\n').some((line) => !line.startsWith('#') && /\btrust\b/.test(line)));
    return { runtime: process.version, pg: '8.20.0', versions: fixture.versions, native: row, scram: true, rootMode: '0700', secretMode: '0600', oneBackbone: true, noIMLFallback: true, initialization: fixture.initialization };
  });
  assert.ok(clusterRoot);
  assert.strictEqual(existsSync(clusterRoot), false);
  return { ...result, clusterRootRemoved: true, initdbAndServerClosureConfirmed: true, excludedModulesEnabled: false, sqlProducerAcceptance: false };
}
