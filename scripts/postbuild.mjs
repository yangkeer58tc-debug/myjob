import { spawn } from 'node:child_process';

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: node ${args.join(' ')}`));
    });
  });

await run(['scripts/prerender-jobs.mjs']);

if (String(process.env.GOOGLE_INDEXING_ENABLED || '').trim() === '1') {
  await run(['scripts/google-indexing-from-sitemap.mjs']);
}

