import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeRmSync } from 'fs-remove-compat';

import { runOwnedProcess } from '../../lib/runOwnedProcess.ts';

const BUILD_TIMEOUT_MS = 30_000;
const GATE_TIMEOUT_MS = 60_000;
const typeGateDirectory = path.dirname(fileURLToPath(import.meta.url));
const toolchainDirectory = path.resolve(typeGateDirectory, '../../..');
const tsds = path.join(toolchainDirectory, 'node_modules', 'ts-dev-stack', 'bin', 'cli.js');
const positiveOutput = path.join(typeGateDirectory, 'dist');
const sentinelDirectory = path.join(typeGateDirectory, 'sentinel');
const sentinelOutputDirectory = path.join(sentinelDirectory, 'dist');

function output(result: { stderr: string; stdout: string }): string {
  return `${result.stdout}${result.stderr}`;
}

async function checkTypes(): Promise<void> {
  safeRmSync(positiveOutput);
  safeRmSync(sentinelOutputDirectory);
  try {
    const positive = await runOwnedProcess(process.execPath, [tsds, 'build'], { cwd: typeGateDirectory, timeoutMs: BUILD_TIMEOUT_MS });
    process.stdout.write(output(positive));
    if (positive.status !== 0) throw new Error(`Authored tsds type gate failed with status ${String(positive.status)}`);

    const sentinel = await runOwnedProcess(process.execPath, [tsds, 'build'], { cwd: sentinelDirectory, timeoutMs: BUILD_TIMEOUT_MS });
    const sentinelOutput = output(sentinel);
    process.stdout.write(sentinelOutput);
    if (sentinel.status === 0) throw new Error('Invalid sentinel unexpectedly passed the tsds type gate');
    if (!/index\.ts\(1,7\): error TS2322/.test(sentinelOutput)) throw new Error('Invalid sentinel failed without the expected TS2322 diagnostic');

    process.stdout.write('Authored tsds type gate passed; invalid sentinel failed with TS2322 as expected.\n');
  } finally {
    safeRmSync(positiveOutput);
    safeRmSync(sentinelOutputDirectory);
  }
}

if (typeof describe === 'function') {
  describe('authored tsds type gate', () => {
    it('checks authored package-name consumers and rejects the invalid sentinel', checkTypes);
  });
} else {
  // The normal tsds test runner owns the temporary package link and its restoration.
  const result = await runOwnedProcess(process.execPath, [tsds, 'test:node', '--no-timeouts', fileURLToPath(import.meta.url)], {
    cwd: toolchainDirectory,
    timeoutMs: GATE_TIMEOUT_MS,
  });
  process.stdout.write(output(result));
  if (result.status !== 0) throw new Error(`Managed authored type gate failed with status ${String(result.status)}`);
}
