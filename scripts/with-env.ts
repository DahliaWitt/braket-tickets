// with-env.ts — Doppler env wrapper. Replaces run-with-local-env.sh.
// Usage: tsx scripts/with-env.ts <command> [args...]
//
// Calls ensureDopplerEnv() which re-execs the current process through Doppler
// when not already injected. After re-exec, DOPPLER_INJECTED=1 is set and
// ensureDopplerEnv() returns, then the target command is spawned.
import {ensureDopplerEnv} from './lib/shared';
import {execFileSync} from 'node:child_process';

ensureDopplerEnv();

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Usage: tsx scripts/with-env.ts <command> [args...]\n');
  process.exit(1);
}

try {
  execFileSync(args[0], args.slice(1), {stdio: 'inherit', env: process.env});
} catch (err: unknown) {
  const code =
    err !== null && typeof err === 'object' && 'status' in err
      ? (((err as {status: unknown}).status as number | null) ?? 1)
      : 1;
  process.exit(code);
}
