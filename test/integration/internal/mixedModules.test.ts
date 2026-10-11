import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'assert';

import { runOwnedProcess } from '../../lib/runOwnedProcess.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDirectory = path.join(repositoryRoot, 'test', 'fixtures', 'internal');
const typeScriptRunner = path.join(repositoryRoot, 'node_modules', 'ts-swc-loaders', 'bin', 'cli.js');

interface MixedModuleProof {
  destroyCalls: number;
  modelURL: string;
  normalizedKey: string;
  order: string;
  reused: boolean;
}

function parseProof(stdout: string): MixedModuleProof {
  const value: unknown = JSON.parse(stdout);
  if (typeof value !== 'object' || value === null) throw new Error('Mixed-module proof did not return an object');
  const destroyCalls: unknown = Reflect.get(value, 'destroyCalls');
  const modelURL: unknown = Reflect.get(value, 'modelURL');
  const normalizedKey: unknown = Reflect.get(value, 'normalizedKey');
  const order: unknown = Reflect.get(value, 'order');
  const reused: unknown = Reflect.get(value, 'reused');
  if (typeof destroyCalls !== 'number' || typeof modelURL !== 'string' || typeof normalizedKey !== 'string' || typeof order !== 'string' || typeof reused !== 'boolean') {
    throw new Error('Mixed-module proof returned an invalid result');
  }
  return { destroyCalls, modelURL, normalizedKey, order, reused };
}

describe('mixed CJS and ESM SQLite connection ownership', () => {
  for (const order of ['cjs-first', 'esm-first']) {
    it(`reuses and closes one real SQLite connection with ${order}`, async () => {
      const result = await runOwnedProcess(process.execPath, [typeScriptRunner, path.join(fixtureDirectory, `mixed-${order}.mjs`)], { cwd: repositoryRoot, timeoutMs: 30_000 });
      assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`);
      const proof = parseProof(result.stdout);
      assert.deepStrictEqual(proof, {
        destroyCalls: 1,
        modelURL: 'sqlite3:///primary_mixed_probe',
        normalizedKey: 'sqlite3://',
        order,
        reused: true,
      });
    });
  }
});
