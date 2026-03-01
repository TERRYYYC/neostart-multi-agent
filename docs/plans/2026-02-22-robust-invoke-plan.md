# robust-invoke-hw2.js Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a hardened CLI subprocess wrapper with heartbeat timeout, retry, process lifecycle management, and enhanced error reporting.

**Architecture:** Three-layer design — spawnCli (single attempt with heartbeat), invokeWithRetry (retry loop), invoke (public API). Module-level signal handlers for cleanup. Single file, pure Node.js.

**Tech Stack:** Node.js built-ins only (child_process, readline)

---

### Task 1: Scaffold file with defaults, helpers, and module-level state

**Files:**
- Create: `invoke/robust-invoke-hw2.js`

**Step 1: Create file with constants and module state**

```javascript
const { spawn } = require('child_process');
const readline = require('readline');

const DEFAULTS = {
    heartbeatTimeout: 120000,
    maxRetries: 4,
};

const REMOVE_VARS = [
    'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
    'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL', 'CLAUDE_AGENT_SDK_VERSION', '__CFBundleIdentifier'
];

let activeChild = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Step 2: Verify file is valid Node.js**

Run: `node -c "invoke/robust-invoke-hw2.js"`
Expected: no syntax errors

**Step 3: Commit**

```bash
git add invoke/robust-invoke-hw2.js
git commit -m "feat: scaffold robust-invoke-hw2 with constants and helpers"
```

---

### Task 2: Implement spawnCli — core subprocess with heartbeat

**Files:**
- Modify: `invoke/robust-invoke-hw2.js`

**Step 1: Add spawnCli function after sleep()**

```javascript
function spawnCli(cli, prompt, opts) {
    return new Promise((resolve, reject) => {
        const { resume, heartbeatTimeout } = opts;
        let child;
        let lineHandler;

        if (cli === 'claude') {
            const CLAUDE = process.env.CLAUDE_PATH || 'claude';
            const env = { ...process.env };
            REMOVE_VARS.forEach((key) => delete env[key]);
            const args = [];
            if (resume) args.push('-c');
            args.push('-p', prompt, '--output-format', 'stream-json', '--verbose');
            child = spawn(CLAUDE, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
            lineHandler = (event) => {
                if (event.type === 'assistant') {
                    for (const block of event.message.content) {
                        if (block.type === 'text') {
                            process.stdout.write(block.text);
                        }
                    }
                }
            };
        } else {
            const CODEX = process.env.CODEX_PATH || 'codex';
            const args = ['exec'];
            if (resume) {
                args.push('resume', '--last', '--json', prompt);
            } else {
                args.push('--json', prompt);
            }
            child = spawn(CODEX, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            lineHandler = (event) => {
                if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
                    process.stdout.write(event.item.text);
                }
            };
        }

        activeChild = child;
        let lastActivity = Date.now();
        let stderrTail = '';
        let killed = false;

        // Heartbeat: both stdout and stderr count as activity
        child.stdout.on('data', () => { lastActivity = Date.now(); });
        child.stderr.on('data', (data) => {
            lastActivity = Date.now();
            process.stderr.write(data);
            stderrTail = (stderrTail + data.toString()).slice(-2000);
        });

        // NDJSON parsing via readline
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const event = JSON.parse(line);
                lineHandler(event);
            } catch {
                // ignore non-JSON lines
            }
        });

        // Heartbeat check every 10s
        const heartbeatCheck = setInterval(() => {
            if (Date.now() - lastActivity > heartbeatTimeout) {
                killed = true;
                child.kill('SIGTERM');
                setTimeout(() => {
                    try { child.kill('SIGKILL'); } catch {}
                }, 5000);
            }
        }, 10000);

        child.on('close', (code) => {
            clearInterval(heartbeatCheck);
            activeChild = null;
            process.stdout.write('\n');
            if (!killed && (code === 0 || code == null)) {
                resolve();
            } else if (killed) {
                reject(new Error(
                    `${cli} timed out (no output for ${heartbeatTimeout / 1000}s)\n--- stderr tail ---\n${stderrTail}`
                ));
            } else {
                reject(new Error(
                    `${cli} exited with code ${code}\n--- stderr tail ---\n${stderrTail}`
                ));
            }
        });

        child.on('error', (err) => {
            clearInterval(heartbeatCheck);
            activeChild = null;
            reject(err);
        });
    });
}
```

**Step 2: Verify syntax**

Run: `node -c "invoke/robust-invoke-hw2.js"`
Expected: no syntax errors

**Step 3: Commit**

```bash
git add invoke/robust-invoke-hw2.js
git commit -m "feat: add spawnCli with heartbeat timeout and stderr collection"
```

---

### Task 3: Implement invokeWithRetry and invoke

**Files:**
- Modify: `invoke/robust-invoke-hw2.js`

**Step 1: Add invokeWithRetry after spawnCli()**

```javascript
async function invokeWithRetry(cli, prompt, opts) {
    const { maxRetries } = opts;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await spawnCli(cli, prompt, opts);
            return;
        } catch (err) {
            process.stderr.write(`\nAttempt ${attempt}/${maxRetries} failed: ${err.message}\n`);
            if (attempt === maxRetries) throw err;
            const delay = attempt * 2;
            process.stderr.write(`Retrying in ${delay}s...\n`);
            await sleep(delay * 1000);
        }
    }
}
```

**Step 2: Add invoke() after invokeWithRetry()**

```javascript
function invoke(cli, prompt, opts = {}) {
    if (!['claude', 'codex'].includes(cli)) {
        return Promise.reject(new Error(`Unsupported cli: ${cli}`));
    }
    const merged = { resume: false, ...DEFAULTS, ...opts };
    return invokeWithRetry(cli, prompt, merged);
}
```

**Step 3: Verify syntax**

Run: `node -c "invoke/robust-invoke-hw2.js"`
Expected: no syntax errors

**Step 4: Commit**

```bash
git add invoke/robust-invoke-hw2.js
git commit -m "feat: add retry wrapper and public invoke API"
```

---

### Task 4: Add signal handlers and CLI entry point

**Files:**
- Modify: `invoke/robust-invoke-hw2.js`

**Step 1: Add signal handlers after invoke()**

```javascript
function cleanup() {
    if (activeChild) {
        activeChild.kill('SIGTERM');
        setTimeout(() => process.exit(1), 5000);
    } else {
        process.exit(1);
    }
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
```

**Step 2: Add CLI entry point and module.exports at end of file**

```javascript
if (require.main === module) {
    const rawArgs = process.argv.slice(2);
    let resume = false;
    const filtered = [];
    for (const arg of rawArgs) {
        if (arg === '--resume') {
            resume = true;
        } else {
            filtered.push(arg);
        }
    }
    const cli = filtered[0];
    const prompt = filtered[1];

    if (!cli || !['claude', 'codex'].includes(cli) || !prompt) {
        console.error('Usage: node robust-invoke-hw2.js <claude|codex> [--resume] "your prompt"');
        process.exit(1);
    }

    invoke(cli, prompt, { resume }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { invoke };
```

**Step 3: Verify syntax**

Run: `node -c "invoke/robust-invoke-hw2.js"`
Expected: no syntax errors

**Step 4: Commit**

```bash
git add invoke/robust-invoke-hw2.js
git commit -m "feat: add signal handlers and CLI entry point"
```

---

### Task 5: Manual smoke test

**Step 1: Test with claude CLI (simple prompt)**

Run: `node "invoke/robust-invoke-hw2.js" claude "say hello in one word"`
Expected: Prints a short response, exits cleanly with code 0

**Step 2: Test module require**

Run: `node -e "const { invoke } = require('./invoke/robust-invoke-hw2.js'); invoke('claude', 'say hi in one word').then(() => console.log('done')).catch(console.error)"`
Expected: Prints response, then "done"

**Step 3: Test invalid cli parameter**

Run: `node -e "const { invoke } = require('./invoke/robust-invoke-hw2.js'); invoke('invalid', 'test').catch(e => console.log(e.message))"`
Expected: Prints "Unsupported cli: invalid"

**Step 4: Test SIGINT cleanup**

Run: `node "invoke/robust-invoke-hw2.js" claude "write a long essay about history"`, then press Ctrl+C after a few seconds
Expected: Process exits cleanly, no orphan child process

**Step 5: Commit**

```bash
git commit --allow-empty -m "test: manual smoke test passed for robust-invoke-hw2"
```
