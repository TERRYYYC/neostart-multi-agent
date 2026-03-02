// ============================================================
// chat/cli-runner.ts — CLI subprocess 抽象层
// CLI subprocess abstraction layer
// ============================================================
//
// 通过 child_process.spawn() 调用 AI CLI 工具
// Spawns AI CLI tools via child_process.spawn()
//
// 支持的 CLI：
// Supported CLIs:
//   - claude: `claude -p --output-format stream-json "prompt"`
//   - codex:  `codex exec --json "prompt"` (stub)
//   - gemini: `gemini "prompt"` (stub)
//
// 多轮上下文：
// Multi-turn context:
//   - claude: 使用 --session-id + --resume 实现会话持续
//   - claude: uses --session-id + --resume for session continuity
//   - 其他: 将历史拼接进 prompt（fallback 方案）
//   - others: concatenate history into prompt (fallback)
//
// ============================================================

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Message, ModelProvider, StreamEvent } from './types.js';

/**
 * CLI stream-json 的原始事件格式（来自 claude CLI）
 * Raw event format from claude CLI stream-json output
 *
 * 实测格式（非官方文档）：
 * Actual format (from real CLI output, not official docs):
 *   { type: 'assistant', message: { content: [{ type: 'text', text: '...' }] } }
 *   { type: 'result', ... }
 */
interface ClaudeStreamMessage {
  type: 'assistant' | 'system' | 'result';
  message?: {
    content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
    }>;
  };
  session_id?: string;
  output?: string;
  status?: 'success' | 'error';
  duration_ms?: number;
}

/**
 * 需要从环境变量中移除的键（防止 Claude CLI 嵌套检测）
 * Env vars to remove (prevent Claude CLI nesting detection)
 */
const REMOVE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_AGENT_SDK_VERSION',
  '__CFBundleIdentifier',
];

/**
 * 运行 CLI 并流式返回结果
 * Run CLI and stream results back
 *
 * @param provider  - 模型提供商 / model provider
 * @param prompt    - 用户消息 / user message
 * @param history   - 历史消息（多轮上下文）/ message history (multi-turn context)
 * @param sessionId - 会话 ID（claude 用于 --resume）/ session ID (claude uses for --resume)
 * @returns EventEmitter，发射 'data'(StreamEvent) 和 'end' 事件
 *          EventEmitter that emits 'data'(StreamEvent) and 'end' events
 */
export function runCliStream(
  provider: ModelProvider,
  prompt: string,
  history: Message[],
  sessionId: string
): EventEmitter {
  const emitter = new EventEmitter();

  // 异步启动，让调用方先绑定监听器
  // Start async so caller can attach listeners first
  process.nextTick(() => {
    try {
      const { command, args } = buildCommand(provider, prompt, history, sessionId);

      // 构建干净的环境变量，移除所有 Claude 嵌套检测相关变量
      // Build clean env, remove all Claude nesting detection vars
      const cleanEnv = { ...process.env };
      for (const key of REMOVE_ENV_VARS) {
        delete cleanEnv[key];
      }

      console.log(`[cli-runner] Spawning: ${command} ${args.join(' ')}`);

      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin=ignore, stdout/stderr=pipe
        env: cleanEnv,
      });

      let buffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        console.log(`[cli-runner:stdout] ${text.slice(0, 200)}`);
        buffer += text;
        const lines = buffer.split('\n');
        // 保留最后一个不完整的行 / Keep the last incomplete line
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = parseLine(provider, trimmed);
          if (event) {
            emitter.emit('data', event);
          }
        }
      });

      let stderrOutput = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        console.log(`[cli-runner:stderr] ${text.slice(0, 500)}`);
        stderrOutput += text;
      });

      child.on('close', (code) => {
        console.log(`[cli-runner] Process exited with code: ${code}`);
        if (stderrOutput) {
          console.log(`[cli-runner] Full stderr:\n${stderrOutput}`);
        }
        // 处理 buffer 中残留的数据 / Process remaining data in buffer
        if (buffer.trim()) {
          const event = parseLine(provider, buffer.trim());
          if (event) {
            emitter.emit('data', event);
          }
        }

        if (code !== 0 && code !== null) {
          emitter.emit('data', {
            type: 'error',
            error: stderrOutput || `CLI exited with code ${code}`,
          } satisfies StreamEvent);
        }

        emitter.emit('data', { type: 'done' } satisfies StreamEvent);
        emitter.emit('end');
      });

      child.on('error', (err) => {
        emitter.emit('data', {
          type: 'error',
          error: `Failed to spawn ${command}: ${err.message}`,
        } satisfies StreamEvent);
        emitter.emit('data', { type: 'done' } satisfies StreamEvent);
        emitter.emit('end');
      });

      // stdin 已设为 'ignore'，无需关闭
      // stdin is set to 'ignore', no need to close
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitter.emit('data', { type: 'error', error: message } satisfies StreamEvent);
      emitter.emit('data', { type: 'done' } satisfies StreamEvent);
      emitter.emit('end');
    }
  });

  return emitter;
}

// ── 内部函数 / Internal functions ────────────────────────────

/**
 * 根据 provider 构建 CLI 命令和参数
 * Build CLI command and args based on provider
 */
function buildCommand(
  provider: ModelProvider,
  prompt: string,
  history: Message[],
  sessionId: string
): { command: string; args: string[] } {
  switch (provider) {
    case 'claude':
      return buildClaudeCommand(prompt, history, sessionId);
    case 'codex':
      return buildCodexCommand(prompt, history);
    case 'gemini':
      return buildGeminiCommand(prompt, history);
    default: {
      // TypeScript exhaustive check
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

/**
 * 构建 claude CLI 命令
 * Build claude CLI command
 *
 * 多轮策略：首次用 --session-id，后续用 --resume
 * Multi-turn: first turn uses --session-id, subsequent turns use --resume
 */
function buildClaudeCommand(
  prompt: string,
  history: Message[],
  sessionId: string
): { command: string; args: string[] } {
  const args = [
    '-p',                          // print 模式（非交互）/ print mode (non-interactive)
    '--output-format', 'stream-json',
    '--model', process.env.CLAUDE_MODEL ?? 'sonnet',
    '--verbose',                   // 显示完整输出 / Show full output for debugging
  ];

  // 多轮上下文：如果有历史消息，使用 --resume
  // Multi-turn: if there's history, use --resume
  if (history.length > 0) {
    args.push('--resume', sessionId);
  } else {
    args.push('--session-id', sessionId);
  }

  args.push(prompt);

  // 支持自定义 claude 二进制路径（某些环境下 PATH 中的 claude 不可用）
  // Support custom claude binary path (PATH claude may not work in some envs)
  const command = process.env.CLAUDE_PATH ?? 'claude';

  return { command, args };
}

/**
 * 构建 codex CLI 命令（stub — 待实现）
 * Build codex CLI command (stub — to be implemented)
 *
 * codex 不支持 session resume，需要手动拼接历史
 * codex doesn't support session resume, needs manual history concatenation
 */
function buildCodexCommand(
  prompt: string,
  history: Message[]
): { command: string; args: string[] } {
  const fullPrompt = buildPromptWithHistory(prompt, history);
  return {
    command: 'codex',
    args: ['exec', '--json', fullPrompt],
  };
}

/**
 * 构建 gemini CLI 命令（stub — 待实现）
 * Build gemini CLI command (stub — to be implemented)
 */
function buildGeminiCommand(
  prompt: string,
  history: Message[]
): { command: string; args: string[] } {
  const fullPrompt = buildPromptWithHistory(prompt, history);
  return {
    command: 'gemini',
    args: [fullPrompt],
  };
}

/**
 * 将历史消息拼接进 prompt（用于不支持 session 的 CLI）
 * Concatenate history into prompt (for CLIs without session support)
 */
function buildPromptWithHistory(prompt: string, history: Message[]): string {
  if (history.length === 0) return prompt;

  const historyText = history
    .map((msg) => `[${msg.role}]: ${msg.content}`)
    .join('\n');

  return `Previous conversation:\n${historyText}\n\n[user]: ${prompt}`;
}

/**
 * 解析 CLI 输出行为 StreamEvent
 * Parse a CLI output line into a StreamEvent
 */
function parseLine(provider: ModelProvider, line: string): StreamEvent | null {
  switch (provider) {
    case 'claude':
      return parseClaudeLine(line);
    case 'codex':
    case 'gemini':
      return parseGenericLine(line);
    default:
      return null;
  }
}

/**
 * 解析 claude stream-json 输出
 * Parse claude stream-json output
 *
 * 事件类型：init, message, tool_use, tool_result, result
 * Event types: init, message, tool_use, tool_result, result
 */
function parseClaudeLine(line: string): StreamEvent | null {
  try {
    const raw = JSON.parse(line) as ClaudeStreamMessage;

    switch (raw.type) {
      case 'assistant': {
        // 实测格式：{ type: 'assistant', message: { content: [{ type: 'text', text: '...' }] } }
        // Real format: { type: 'assistant', message: { content: [{ type: 'text', text: '...' }] } }
        const textBlocks = raw.message?.content?.filter((b) => b.type === 'text') ?? [];
        const text = textBlocks.map((b) => b.text ?? '').join('');
        if (text) {
          return { type: 'text', content: text };
        }
        return null;
      }

      case 'result': {
        if (raw.status === 'error') {
          return { type: 'error', error: raw.output ?? 'Unknown error' };
        }
        return null;
      }

      // system 等其他事件 — 暂时忽略
      // system and other events — skip for now
      default:
        return null;
    }
  } catch {
    // 非 JSON 行（可能是 stderr 泄露），忽略
    // Non-JSON line (could be stderr leak), ignore
    return null;
  }
}

/**
 * 通用 CLI 输出解析（codex / gemini）
 * Generic CLI output parser (codex / gemini)
 */
function parseGenericLine(line: string): StreamEvent | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (typeof raw.text === 'string') {
      return { type: 'text', content: raw.text };
    }
    if (typeof raw.output === 'string') {
      return { type: 'text', content: raw.output };
    }
    if (typeof raw.error === 'string') {
      return { type: 'error', error: raw.error };
    }
    return null;
  } catch {
    // 纯文本输出 / Plain text output
    if (line.trim()) {
      return { type: 'text', content: line };
    }
    return null;
  }
}
