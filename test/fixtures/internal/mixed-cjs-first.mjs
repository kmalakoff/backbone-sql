import { runMixedModuleProof } from './mixedModules.ts';

process.stdout.write(`${JSON.stringify(await runMixedModuleProof('cjs-first'))}\n`);
