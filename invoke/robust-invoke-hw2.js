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

function invoke(cli, prompt, opts = {}) {
    if (!['claude', 'codex'].includes(cli)) {
        return Promise.reject(new Error(`Unsupported cli: ${cli}`));
    }
    const merged = { resume: false, ...DEFAULTS, ...opts };
    return invokeWithRetry(cli, prompt, merged);
}
