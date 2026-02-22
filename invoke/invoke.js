const { spawn } = require('child_process');
const readline = require('readline');

/**
 * 运行指定的 CLI 并在控制台打印输出
 * @param {'claude' | 'codex'} cli - 使用的客户端
 * @param {string} prompt - 提示词
 * @returns {Promise<void>}
 */
function invoke(cli, prompt) {
    return new Promise((resolve, reject) => {
        let child;
        let lineHandler;

        if (cli === 'claude') {
            const CLAUDE = process.env.CLAUDE_PATH || 'claude';
            const env = { ...process.env };
            const REMOVE_VARS = [
                'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
                'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL', 'CLAUDE_AGENT_SDK_VERSION', '__CFBundleIdentifier'
            ];
            REMOVE_VARS.forEach((key) => delete env[key]);

            child = spawn(CLAUDE, [
                '-p', prompt,
                '--output-format', 'stream-json',
                '--verbose',
            ], { env, stdio: ['ignore', 'pipe', 'pipe'] });

            lineHandler = (event) => {
                if (event.type === 'assistant') {
                    for (const block of event.message.content) {
                        if (block.type === 'text') {
                            process.stdout.write(block.text);
                        }
                    }
                }
            };
        } else if (cli === 'codex') {
            const CODEX = process.env.CODEX_PATH || 'codex';
            child = spawn(CODEX, [
                'exec',
                '--json',
                prompt,
            ], { stdio: ['ignore', 'pipe', 'pipe'] });

            lineHandler = (event) => {
                if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
                    process.stdout.write(event.item.text);
                }
            };
        } else {
            return reject(new Error(`Unsupported cli: ${cli}`));
        }

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

        child.stderr.on('data', (data) => {
            process.stderr.write(data);
        });

        child.on('close', (code) => {
            process.stdout.write('\n');
            if (code === 0 || code == null) {
                resolve();
            } else {
                reject(new Error(`${cli} process exited with code ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

// 示例运行
if (require.main === module) {
    const cli = process.argv[2];
    const prompt = process.argv[3];

    if (!cli || !['claude', 'codex'].includes(cli) || !prompt) {
        console.error('Usage: node invoke.js <claude|codex> "your prompt"');
        process.exit(1);
    }

    invoke(cli, prompt).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { invoke };
