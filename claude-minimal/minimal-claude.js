const { spawn } = require('child_process');
const readline = require('readline');

const prompt = process.argv[2];
if (!prompt) {
  console.error('Usage: node minimal-claude.js "your prompt"');
  process.exit(1);
}

const CLAUDE = process.env.CLAUDE_PATH
  || '/Users/terry/Library/Application Support/Claude/claude-code/2.1.41/claude';

const env = { ...process.env };
const REMOVE_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL', 'CLAUDE_AGENT_SDK_VERSION', '__CFBundleIdentifier'];
REMOVE_VARS.forEach((key) => delete env[key]);

const child = spawn(CLAUDE, [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--verbose',
], { env, stdio: ['ignore', 'pipe', 'pipe'] });

const rl = readline.createInterface({ input: child.stdout });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const event = JSON.parse(line);
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          process.stdout.write(block.text);
        }
      }
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
