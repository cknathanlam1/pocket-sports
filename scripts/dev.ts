// Runs the ws server and the Vite dev server together; Ctrl+C stops both.
import { spawn, type ChildProcess } from 'node:child_process';
import { DEV_SERVER_PORT } from '../shared/constants.ts';

// PORT is pinned for the ws server: Vite owns 5173 and proxies /ws to it.
const serverEnv = { ...process.env, NODE_ENV: 'development', PORT: String(DEV_SERVER_PORT) };
const procs: ChildProcess[] = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', '--watch-path=engine', 'server/index.ts'], { stdio: 'inherit', env: serverEnv }),
  spawn('npx vite', { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
