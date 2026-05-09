#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'resume admin env readiness',
    cmd: 'npm',
    args: ['run', 'env:check:resume-admin'],
  },
  {
    name: 'resumes module tests',
    cmd: 'npm',
    args: ['run', 'test', '--', 'src/modules/resumes/parser.test.ts', 'src/modules/resumes/importer.test.ts', 'src/modules/resumes/dryRun.test.ts'],
  },
  {
    name: 'development build',
    cmd: 'npm',
    args: ['run', 'build:dev'],
  },
];

for (const step of steps) {
  console.log(`\n[precutover-resumes] running: ${step.name}`);
  const res = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: false });
  if ((res.status ?? 1) !== 0) {
    console.error(`[precutover-resumes] failed at step: ${step.name}`);
    process.exit(res.status ?? 1);
  }
}

console.log('\n[precutover-resumes] all checks passed.');
process.exit(0);

