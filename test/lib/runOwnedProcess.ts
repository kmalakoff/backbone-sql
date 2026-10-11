import { type ChildProcess, execFile, spawn } from 'node:child_process';

const TERMINATION_TIMEOUT_MS = 10_000;

export interface OwnedProcessOptions {
  cwd: string;
  timeoutMs: number;
}

export interface OwnedProcessResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'cause', { configurable: true, value: cause });
  return error;
}

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function terminateWindowsTree(processID: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('taskkill.exe', ['/pid', String(processID), '/T', '/F'], { timeout: TERMINATION_TIMEOUT_MS, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function terminateOwnedTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await terminateWindowsTree(child.pid);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

export async function runOwnedProcess(command: string, arguments_: readonly string[], options: OwnedProcessOptions): Promise<OwnedProcessResult> {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  let stdout = '';
  let spawnError: Error | undefined;
  child.stderr?.setEncoding('utf8');
  child.stdout?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  const closed = new Promise<OwnedProcessResult>((resolve) => {
    child.once('close', (status) => resolve({ status, stderr, stdout }));
  });
  const result = await waitWithTimeout(closed, options.timeoutMs);
  if (result) {
    if (spawnError) throw spawnError;
    return result;
  }

  let terminationError: unknown;
  try {
    await terminateOwnedTree(child);
  } catch (error: unknown) {
    terminationError = error;
  }
  const terminated = await waitWithTimeout(closed, TERMINATION_TIMEOUT_MS);
  if (!terminated) throw errorWithCause(`Owned process and its descendants remained alive after ${String(options.timeoutMs + TERMINATION_TIMEOUT_MS)}ms`, terminationError);
  throw errorWithCause(`Owned process exceeded ${String(options.timeoutMs)}ms`, terminationError);
}
