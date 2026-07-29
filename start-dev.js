const fs = require('fs');
const { spawn, execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname);
const isWindows = process.platform === 'win32';

function resolvePython() {
  const venvWin = path.join(rootDir, '.venv', 'Scripts', 'python.exe');
  const venvUnix = path.join(rootDir, '.venv', 'bin', 'python');
  const venv2Win = path.join(rootDir, 'venv', 'Scripts', 'python.exe');
  const venv2Unix = path.join(rootDir, 'venv', 'bin', 'python');

  if (fs.existsSync(venvWin)) return { command: venvWin, args: [] };
  if (fs.existsSync(venvUnix)) return { command: venvUnix, args: [] };
  if (fs.existsSync(venv2Win)) return { command: venv2Win, args: [] };
  if (fs.existsSync(venv2Unix)) return { command: venv2Unix, args: [] };

  if (isWindows) {
    try {
      execSync('python --version', { stdio: 'ignore' });
      return { command: 'python', args: [] };
    } catch (_) {}
    return { command: 'py', args: ['-3'] };
  }
  return { command: 'python3', args: [] };
}

const { command: pythonCommand, args: pythonArgs } = resolvePython();
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const children = [];
let shuttingDown = false;

const getOpenCommand = () => {
  switch (process.platform) {
    case 'darwin': return 'open -a "Google Chrome"';
    case 'win32': return 'start chrome';
    default: return 'google-chrome';
  }
};

function launch(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  children.push(child);
  child.on('error', (error) => {
    console.warn(`⚠️  Failed to start ${command}: ${error.message}`);
  });

  return child;
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n🛑 Stopping local services...');
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(0), 300);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Starting local app services...');

  console.log('🦙 Starting Ollama...');
  launch('ollama', ['serve']);

  await wait(2500);

  console.log('🐍 Starting Python backend on http://127.0.0.1:8000');
  launch(pythonCommand, [...pythonArgs, '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000']);

  await wait(1500);

  console.log('🌐 Starting local web server on http://localhost:3000');
  launch(process.execPath, ['server/dev.js']);

  setTimeout(() => {
    console.log('🖥️  Opening http://localhost:3000');
    if (isWindows) {
      spawn('cmd.exe', ['/c', 'start', '', 'http://localhost:3000'], { cwd: rootDir, stdio: 'ignore' });
    } else {
      spawn(getOpenCommand(), ['http://localhost:3000'], { cwd: rootDir, stdio: 'ignore' });
    }
  }, 3000);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

main().catch((error) => {
  console.error('❌ Startup failed:', error);
  stopAll();
});