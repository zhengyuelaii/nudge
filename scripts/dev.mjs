#!/usr/bin/env node
// Nudge 并行开发服务器：同时启动后端 (tsx watch) 与前端 (vite)，
// 带彩色前缀日志、就绪检测、Ctrl+C 优雅退出（进程组 SIGTERM → SIGKILL 兜底）。
// 零第三方依赖，仅用 Node 内置模块。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { platform } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const isWin = platform() === 'win32';

const C = {
  server: (s) => `\x1b[36m${s}\x1b[0m`,
  web: (s) => `\x1b[35m${s}\x1b[0m`,
  dev: (s) => `\x1b[1m\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

const targets = [
  {
    name: 'server',
    color: C.server,
    cwd: resolve(root, 'packages/server'),
    cmd: 'npx',
    args: ['tsx', 'watch', 'src/main.ts'],
    readyOn: /Server running on/i,
    url: 'http://localhost:8787',
  },
  {
    name: 'web',
    color: C.web,
    cwd: resolve(root, 'packages/web'),
    cmd: 'npx',
    args: ['vite'],
    readyOn: /ready in|Local:\s+http/i,
    url: 'http://localhost:5173',
  },
];

const procs = [];
let exiting = false;
let exitCode = 0;

function killTree(proc, signal = 'SIGTERM') {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-proc.pid, signal); // 杀整个进程组（detached）
    }
  } catch {
    try { proc.kill(signal); } catch { /* already gone */ }
  }
}

function shutdown(reason, code = 0) {
  if (exiting) return;
  exiting = true;
  if (code) exitCode = code;
  console.log(C.dev(`\n[dev] Stopping all services${reason ? ` (${reason})` : ''}...`));

  procs.forEach((p) => killTree(p.proc, 'SIGTERM'));

  const force = setTimeout(() => {
    procs.forEach((p) => killTree(p.proc, 'SIGKILL'));
    console.log(C.red('[dev] Timed out waiting for exit, force killed'));
    process.exit(exitCode);
  }, 3000);

  const checkDone = setInterval(() => {
    if (procs.every((p) => p.proc.exitCode !== null || p.proc.signalCode)) {
      clearInterval(checkDone);
      clearTimeout(force);
      const status = procs
        .map((p) => {
          const done = p.proc.exitCode !== null || p.proc.signalCode;
          const ok = done && (exiting || p.proc.exitCode === 0 || p.proc.signalCode === 'SIGTERM');
          return `${p.name} ${ok ? '✓' : '✗'}`;
        })
        .join(' ');
      console.log(C.dev(`[dev] Stopped (${status})`));
      process.exit(exitCode);
    }
  }, 100);
}

function start(t) {
  const proc = spawn(t.cmd, t.args, {
    cwd: t.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    detached: !isWin, // POSIX 新进程组，便于 process.kill(-pid) 整组清理
  });

  const entry = { ...t, proc, ready: false };
  procs.push(entry);

  const prefix = t.color(`[${t.name}]`);
  const pipe = (stream, kind) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim()) console.log(prefix, line);
        if (!entry.ready && t.readyOn.test(line)) {
          entry.ready = true;
          console.log(prefix, C.dim(`✓ ready (${t.url})`));
          if (procs.every((p) => p.ready)) printReady();
        }
      }
    });
    stream.on('end', () => { if (buf.trim()) console.log(prefix, buf); });
  };
  pipe(proc.stdout, 'out');
  pipe(proc.stderr, 'err');

  proc.on('exit', (code, sig) => {
    if (exiting) return;
    const how = sig ? `signal ${sig}` : `exit code ${code}`;
    if (code !== 0 && code !== null) {
      console.log(C.red(`[${t.name}] exited abnormally (${how})`));
      shutdown(`${t.name} ${how}`, 1);
    } else {
      console.log(C.dim(`[${t.name}] exited (${how})`));
      shutdown(`${t.name} exited`, 0);
    }
  });

  proc.on('error', (e) => {
    console.log(C.red(`[${t.name}] failed to start: ${e.message}`));
    shutdown(`${t.name} start error`, 1);
  });
}

function printReady() {
  const lines = [
    '',
    C.dev('──────────────────────────────────────────'),
    C.dev('  Nudge dev ready'),
    ...targets.map((t) => `  ${t.color(t.name.padEnd(6))} ${t.url}`),
    C.dev('  Press Ctrl+C to stop all services'),
    C.dev('──────────────────────────────────────────'),
    '',
  ];
  console.log(lines.join('\n'));
}

console.log(C.dev('[dev] starting...'));
targets.forEach(start);

process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
