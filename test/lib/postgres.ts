import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'assert';
import { safeRm } from 'fs-remove-compat';
import knexFactory, { type Knex } from 'knex';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = '18.4';
const EXECUTABLE_HASHES: Readonly<Record<string, string>> = {
  initdb: 'b81069a19bcec5d2dd263f5c9bce2ce0b5075ae0f9b8a5c81b79f34bef503c39',
  postgres: '515d8e4c690ecd6ae86074eedd5d6d0ed50df434b3743274085b9692f1e923f9',
};
const STOP_TIMEOUT_MS = 10_000;

function aggregate(errors: unknown[], message: string): Error {
  const aggregateConstructor: unknown = Reflect.get(globalThis, 'AggregateError');
  if (typeof aggregateConstructor !== 'function') throw new Error('The PostgreSQL fixture requires native AggregateError');
  const error: unknown = Reflect.construct(aggregateConstructor, [errors, message]);
  if (!(error instanceof Error)) throw new Error('Native AggregateError did not return an Error');
  return error;
}

function groupExists(child: ChildProcess): boolean {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

function ownProcess(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, detached: true, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let originalError: Error | undefined;
  let intentionalStop = false;
  let outcome: { code: number | null; error?: Error } | undefined;
  child.stdout?.on('data', (value: Buffer) => {
    stdout += value.toString();
  });
  child.stderr?.on('data', (value: Buffer) => {
    stderr += value.toString();
  });
  child.once('error', (error) => {
    originalError = error;
  });
  const closed = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('close', (code, signal) => {
      if (!originalError && code !== 0 && !intentionalStop) originalError = new Error(`Owned PostgreSQL process ${signal ? `terminated by ${signal}` : `exited ${code}`}: ${stderr}`);
      outcome = { code, error: originalError };
      resolve(outcome);
    });
  });
  // Retain and observe the original outcome immediately, including early-parent failure.
  const observed = closed.then((result) => result);
  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        try {
          if (groupExists(child) && child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          reject(aggregate([new Error('PostgreSQL stop deadline expired'), error], 'PostgreSQL stop and fallback cleanup failed'));
          return;
        }
        reject(new Error('PostgreSQL SIGINT, close and descendant cleanup not confirmed within 10 seconds'));
      }, STOP_TIMEOUT_MS);
      try {
        if (!outcome) {
          intentionalStop = true;
          if (child.pid) child.kill('SIGINT');
        }
      } catch (error) {
        clearTimeout(deadline);
        reject(error);
        return;
      }
      void closed.then(async () => {
        try {
          if (groupExists(child) && child.pid) {
            process.kill(-child.pid, 'SIGKILL');
            const end = Date.now() + 1000;
            while (groupExists(child) && Date.now() < end) await new Promise<void>((complete) => setTimeout(complete, 20));
            if (groupExists(child)) throw new Error('Owned PostgreSQL descendants remain after parent close');
            if (!originalError) throw new Error('PostgreSQL required forced descendant cleanup after parent close');
          }
          clearTimeout(deadline);
          resolve();
        } catch (error) {
          clearTimeout(deadline);
          reject(error);
        }
      });
    });
    return stopping;
  }
  return { child, observed, stop, output: () => ({ stdout, stderr }), completed: () => outcome };
}

async function runTool(binary: string, args: string[]): Promise<string> {
  const owner = ownProcess(binary, args, PACKAGE_ROOT);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let failure: { value: unknown } | undefined;
  let stdout = '';
  try {
    const outcome = await Promise.race([
      owner.observed,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Owned PostgreSQL tool exceeded 30 seconds')), 30_000);
      }),
    ]);
    if (outcome.error) throw outcome.error;
    assert.strictEqual(outcome.code, 0);
    stdout = owner.output().stdout;
  } catch (value) {
    failure = { value };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  try {
    await owner.stop();
  } catch (cleanup) {
    throw failure ? aggregate([failure.value, cleanup], 'PostgreSQL tool and cleanup failed') : cleanup;
  }
  if (failure) throw failure.value;
  return stdout;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No private PostgreSQL port');
    return address.port;
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

export async function startPostgres(runtimeDirectory: string) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('PostgreSQL trial requires the reviewed Darwin ARM64 runtime');
  if (Object.keys(process.env).some((key) => key.startsWith('DYLD_') && process.env[key])) throw new Error('PostgreSQL trial does not permit DYLD workarounds');
  const binaries: Record<string, string> = {};
  for (const [name, expected] of Object.entries(EXECUTABLE_HASHES)) {
    const binary = path.join(runtimeDirectory, 'bin', name);
    assert.strictEqual(
      createHash('sha256')
        .update(await readFile(binary))
        .digest('hex'),
      expected
    );
    binaries[name] = binary;
  }
  const versions = {
    postgres: (await runTool(binaries.postgres, ['--version'])).trim(),
    initdb: (await runTool(binaries.initdb, ['--version'])).trim(),
  };
  assert.strictEqual(versions.postgres, `postgres (PostgreSQL) ${VERSION}`);
  assert.strictEqual(versions.initdb, `initdb (PostgreSQL) ${VERSION}`);
  const scratch = path.join(PACKAGE_ROOT, '.tmp');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'postgres-'));
  const data = path.join(root, 'data');
  let owner: ReturnType<typeof ownProcess> | undefined;
  let database: Knex | undefined;
  let stopped = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        await database?.destroy();
      } catch (error) {
        errors.push(error);
      }
      let closureConfirmed = !owner;
      if (owner) {
        try {
          await owner.stop();
          closureConfirmed = true;
        } catch (error) {
          errors.push(error);
        }
        const outcome = closureConfirmed ? await owner.observed : owner.completed();
        if (outcome?.error) errors.push(outcome.error);
      }
      stopped = closureConfirmed;
      if (closureConfirmed && !errors.length) {
        try {
          await new Promise<void>((resolve, reject) => safeRm(root, { recursive: true, force: true }, (error) => (error ? reject(error) : resolve())));
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw aggregate(errors, `PostgreSQL cleanup failed; retained private root ${root}`);
    })();
    return closing;
  };
  try {
    const port = await availablePort();
    const password = randomBytes(24).toString('hex');
    const passwordFile = path.join(root, 'password');
    await writeFile(passwordFile, `${password}\n`, { flag: 'wx', mode: 0o600 });
    const initialization = await runTool(binaries.initdb, ['-D', data, '-U', 'sql_owner', '--encoding=UTF8', '--locale=C', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', `--pwfile=${passwordFile}`]);
    await mkdir(path.join(data, 'socket'), { mode: 0o700 });
    const connection = { database: 'postgres', host: '127.0.0.1', password, port, ssl: false, user: 'sql_owner' };
    database = knexFactory({ client: 'pg', connection, acquireConnectionTimeout: 10_000, pool: { max: 1, min: 0 } });
    // Relative socket path stays inside PGDATA and avoids macOS sockaddr_un path limits.
    owner = ownProcess(binaries.postgres, ['-D', data, '-h', '127.0.0.1', '-p', String(port), '-k', 'socket', '-c', 'max_connections=10', '-c', 'shared_buffers=32MB', '-c', 'shared_preload_libraries=', '-c', 'local_preload_libraries=', '-c', 'session_preload_libraries='], data);
    const end = Date.now() + 15_000;
    while (!owner.output().stderr.includes('database system is ready to accept connections')) {
      const outcome = owner.completed();
      if (outcome) throw outcome.error ?? new Error('PostgreSQL exited before readiness');
      if (Date.now() >= end) throw new Error('PostgreSQL readiness exceeded 15 seconds');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    await database.raw('select 1 as ready');
    return { root, data, database, connection, versions, initialization, close, stopped: () => stopped, serverOutput: () => owner?.output(), modelURL: (table: string) => `postgres://sql_owner:${password}@127.0.0.1:${port}/postgres/${table}` };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw aggregate([error, cleanup], 'PostgreSQL setup and cleanup failed');
    }
    throw error;
  }
}

export async function withPostgres<T>(runtimeDirectory: string, exercise: (fixture: Awaited<ReturnType<typeof startPostgres>>) => Promise<T>): Promise<T> {
  const fixture = await startPostgres(runtimeDirectory);
  let outcome: { value: T } | { failure: unknown };
  try {
    outcome = { value: await exercise(fixture) };
  } catch (failure) {
    outcome = { failure };
  }
  try {
    await fixture.close();
  } catch (cleanup) {
    throw 'failure' in outcome ? aggregate([outcome.failure, cleanup], 'PostgreSQL operation and cleanup failed') : cleanup;
  }
  assert.strictEqual(existsSync(fixture.root), false);
  if ('failure' in outcome) throw outcome.failure;
  return outcome.value;
}
