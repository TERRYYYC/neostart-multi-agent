const { spawn } = require('child_process');
const readline = require('readline');

const prompt = process.argv[2];
if (!prompt) {
  console.error('Usage: node minimal-codex.js "your prompt"');
  process.exit(1);
}

const CODEX = process.env.CODEX_PATH || 'codex';

const child = spawn(CODEX, [
  'exec',
  '--json',
  prompt,
], { stdio: ['ignore', 'pipe', 'pipe'] });

const rl = readline.createInterface({ input: child.stdout });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const event = JSON.parse(line);
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      process.stdout.write(event.item.text);
    }
  } catch {
    // ignore non-JSON lines
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('close', (code) => {
  process.stdout.write('\n');
  process.exit(code ?? 0);
});
