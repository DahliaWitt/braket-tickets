import {fileURLToPath} from 'node:url';

import {syncHelpCenterShipping} from './help-center-shipping';

const args = new Set(process.argv.slice(2));

function sync(): void {
  syncHelpCenterShipping();
}

async function main(): Promise<void> {
  sync();

  if (!args.has('--watch')) return;

  const {default: chokidar} = await import('chokidar');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const watcher = chokidar.watch(['public/**', '../docs/**/*.md'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    ignoreInitial: true,
    ignored: [
      '.generated-public/**',
      'public/docs/developers/**',
      'public/docs/manifest.json',
    ],
  });
  watcher.on('all', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sync, 200);
  });
}

void main();
