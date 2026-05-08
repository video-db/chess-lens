/**
 * delay-electron.js
 *
 * Cross-platform replacement for `sleep 2 && electron .`
 * Used in the `dev` npm script so it works on both Windows and Unix.
 */
const { spawn } = require('child_process');

setTimeout(() => {
  const proc = spawn('electron', ['.'], {
    stdio: 'inherit',
    shell: true,
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
}, 2000);
