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

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Message, ModelProvider, StreamEvent } from './types.js';
import { childLogger, truncateForLog } from './logger.js';

// ── 子进程生命周期管理 / Child process lifecycle management ────
// 参考 robust-invoke-hw2.js 的设计：追踪所有活跃子进程，防止孤儿进程
// Inspired by robust-invoke-hw2.js: track all active children to prevent orphans

/** 所有活跃子进程的集合 / Set of all active child processes */
const activeChildren = new Set<ChildProcess>();

/**
 * 已安排 SIGKILL 的子进程（防止对同一子进程重复创建 timer）
 * Children with scheduled SIGKILL (prevent duplicate timers for same child)
 */
const pendingKills = new WeakSet<ChildProcess>();

/**
 * 安全终止子进程：先 SIGTERM，5 秒后 SIGKILL
 * Gracefully kill child: SIGTERM first, SIGKILL after 5s
 *
 * 幂等：对同一子进程多次调用不会创建多个 SIGKILL timer
 * Idempotent: multiple calls for same child won't create multiple SIGKILL timers
 */
function killChild(child: ChildProcess): void {
  if (pendingKills.has(child)) return; // 已在终止流程中 / Already being killed
  pendingKills.add(child);
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  const forceKillTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // 进程可能已退出 / process may have already exited
    }
  }, 5000);
  forceKillTimer.unref(); // 不阻止 Node 退出 / Don't prevent Node from exiting
}

/**
 * 清理所有活跃子进程（用于进程退出时）
 * Clean up all active children (called on process exit)
 */
function cleanupAllChildren(): void {
  const cleanupLogger = childLogger({ component: 'cli-runner' });
  if (activeChildren.size > 0) {
    cleanupLogger.warn('cli.cleanup', {
      activeCount: activeChildren.size,
      message: 'Killing all active CLI children on process exit',
    });
    for (const child of activeChildren) {
      killChild(child);
    }
  }
  // 给子进程 6 秒时间退出 / Give children 6s to exit
  setTimeout(() => process.exit(1), 6000).unref();
}

// 注册进程信号处理器（只注册一次）
// Register process signal handlers (once only)
let signalHandlersRegistered = false;
function ensureSignalHandlers(): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  process.on('SIGTERM', cleanupAllChildren);
  process.on('SIGINT', cleanupAllChildren);
}

// ── 心跳超时配置 / Heartbeat timeout config ──────────────────
// 参考 robust-invoke-hw2.js：如果子进程长时间无输出，视为挂住并强制终止
// From robust-invoke-hw2.js: if child has no output for too long, consider it hung

/** 心跳超时（毫秒），默认 120 秒 / Heartbeat timeout in ms, default 120s */
const HEARTBEAT_TIMEOUT = Math.max(
  30000,
  parseInt(process.env.CLI_HEARTBEAT_TIMEOUT ?? '120000', 10) || 120000
);

/** 心跳检查间隔（毫秒）/ Heartbeat check interval in ms */
const HEARTBEAT_CHECK_INTERVAL = 10000;

// ── stderr 滑动窗口 / stderr sliding window ─────────────────
// 参考 robust-invoke-hw2.js：只保留最后 N 字符，防止内存泄漏
// From robust-invoke-hw2.js: keep only last N chars to prevent memory leak

/** stderr 最大保留字符数 / Max stderr chars to keep */
const STDERR_TAIL_LIMIT = 2000;

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
  // result 事件中的用量信息 / usage info in result events
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
}

/**
 * Codex CLI JSONL 事件格式（来自 codex exec --json）
 * Codex CLI JSONL event format (from codex exec --json)
 *
 * 实测事件类型（2026-03-03 验证）：
 * Actual event types (verified 2026-03-03):
 *   - thread.started: { type, thread_id }
 *   - turn.started:   { type }
 *   - item.completed: { type, item: { id, type: "agent_message"|"reasoning", text } }
 *   - turn.completed: { type, usage: { input_tokens, output_tokens, ... } }
 */
interface CodexStreamMessage {
  type: string;
  // item.completed 事件的嵌套结构（核心文本载体）
  // Nested structure for item.completed events (primary text carrier)
  item?: {
    id?: string;
    type?: string;    // "agent_message" | "reasoning" 等
    text?: string;    // 实际文本内容 / actual text content
  };
  // turn.completed 事件的用量信息 / usage info in turn.completed events
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  // 备用顶层字段（兼容其他可能的格式）
  // Fallback top-level fields (for other possible formats)
  content?: string;
  text?: string;
  output?: string;
  // 错误信息 / error info
  error?: string;
  // result 事件的状态 / status for result events
  status?: 'success' | 'error';
}

/**
 * Gemini CLI stream-json 事件格式（来自 gemini --output-format stream-json）
 * Gemini CLI stream-json event format (from gemini --output-format stream-json)
 *
 * 实测事件类型（2026-03-03 验证）：
 * Actual event types (verified 2026-03-03):
 *   - init:        { type, timestamp, session_id, model }
 *   - message:     { type, timestamp, role: "user"|"assistant", content, delta?: true }
 *   - tool_use:    { type, timestamp, tool_name, tool_id, parameters }
 *   - tool_result: { type, timestamp, tool_id, status, output }
 *   - error:       { type, error }
 *   - result:      { type, timestamp, status, stats }
 */
interface GeminiStreamMessage {
  type: string;
  // message 事件的角色（关键字段：必须过滤只取 assistant）
  // Role for message events (critical: must filter for assistant only)
  role?: 'user' | 'assistant';
  // message 事件中的文本 / text in message events
  content?: string;
  text?: string;
  // 是否为增量消息 / whether this is a delta message
  delta?: boolean;
  // message 事件的嵌套结构（备用，兼容其他可能的格式）
  // Nested structure for message events (fallback, for other possible formats)
  message?: {
    content?: Array<{
      type: string;
      text?: string;
    }>;
  };
  // 响应文本（用于 json 模式和 result 事件）/ response text (for json mode & result events)
  response?: string;
  output?: string;
  // 错误信息 / error info
  error?: string;
  // result 事件的状态 / status for result events
  status?: 'success' | 'error';
  // result 事件中的统计信息 / stats in result events
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
  };
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
  sessionId: string,
  logContext: { requestId?: string; conversationId?: string } = {}
): EventEmitter {
  const emitter = new EventEmitter();
  const logger = childLogger({
    component: 'cli-runner',
    provider,
    requestId: logContext.requestId,
    conversationId: logContext.conversationId ?? sessionId,
  });

  // 确保信号处理器已注册 / Ensure signal handlers are registered
  ensureSignalHandlers();

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

      logger.info('cli.spawn', {
        command,
        argsCount: args.length,
        promptChars: prompt.length,
        historySize: history.length,
        heartbeatTimeout: HEARTBEAT_TIMEOUT,
      });
      logger.debug('cli.spawn.args', { args: truncateForLog(args.join(' '), 700) });

      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin=ignore, stdout/stderr=pipe
        env: cleanEnv,
      });

      // 注册到活跃子进程集合（防孤儿进程）
      // Register in active children set (prevent orphan processes)
      activeChildren.add(child);

      let buffer = '';
      let lastActivity = Date.now();  // 心跳：最后活动时间 / Heartbeat: last activity time
      let killedByHeartbeat = false;   // 是否被心跳超时杀掉 / Whether killed by heartbeat

      child.stdout.on('data', (chunk: Buffer) => {
        lastActivity = Date.now();  // 🔴 心跳更新 / Heartbeat update
        const text = chunk.toString();
        logger.debug('cli.stdout_chunk', {
          chunkChars: text.length,
          preview: truncateForLog(text, 200),
        });
        buffer += text;
        const lines = buffer.split('\n');
        // 保留最后一个不完整的行 / Keep the last incomplete line
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = parseLine(provider, trimmed, logger);
          if (event) {
            emitter.emit('data', event);
          }
        }
      });

      // 🔴 stderr 滑动窗口截断（参考 robust-invoke-hw2.js）
      // stderr sliding window truncation (from robust-invoke-hw2.js)
      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        lastActivity = Date.now();  // 🔴 心跳更新：stderr 也算活动
        const text = chunk.toString();
        logger.debug('cli.stderr_chunk', {
          chunkChars: text.length,
          preview: truncateForLog(text, 500),
        });
        // 滑动窗口：只保留最后 STDERR_TAIL_LIMIT 字符
        // Sliding window: keep only last STDERR_TAIL_LIMIT chars
        stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
      });

      // 🔴 心跳检查定时器（参考 robust-invoke-hw2.js）
      // Heartbeat check timer (from robust-invoke-hw2.js)
      const heartbeatCheck = setInterval(() => {
        const silenceMs = Date.now() - lastActivity;
        if (silenceMs > HEARTBEAT_TIMEOUT) {
          logger.error('cli.heartbeat_timeout', {
            silenceMs,
            heartbeatTimeout: HEARTBEAT_TIMEOUT,
            stderrTail: truncateForLog(stderrTail, 500),
          });
          killedByHeartbeat = true;
          killChild(child);
        }
      }, HEARTBEAT_CHECK_INTERVAL);
      heartbeatCheck.unref(); // 不阻止 Node 退出 / Don't prevent Node from exiting

      child.on('close', (code) => {
        clearInterval(heartbeatCheck);  // 🔴 清理心跳定时器 / Clear heartbeat timer
        activeChildren.delete(child);   // 🔴 从活跃集合移除 / Remove from active set

        logger.info('cli.exit', {
          code: code ?? -1,
          stderrChars: stderrTail.length,
          killedByHeartbeat,
        });

        if (stderrTail && !isHarmlessGeminiTelemetry(provider, stderrTail)) {
          logger.warn('cli.stderr_output', {
            stderr: truncateForLog(stderrTail, 1000),
          });
        }

        // 处理 buffer 中残留的数据 / Process remaining data in buffer
        if (buffer.trim()) {
          const event = parseLine(provider, buffer.trim(), logger);
          if (event) {
            emitter.emit('data', event);
          }
        }

        // 🔴 区分超时退出和异常退出（参考 robust-invoke-hw2.js 的三段式判断）
        // Distinguish timeout vs error exit (from robust-invoke-hw2.js's 3-way check)
        if (killedByHeartbeat) {
          const timeoutSec = Math.round(HEARTBEAT_TIMEOUT / 1000);
          emitter.emit('data', {
            type: 'error',
            error: `CLI timed out (no output for ${timeoutSec}s). Process was killed.\n--- stderr tail ---\n${stderrTail}`,
          } satisfies StreamEvent);
        } else if (code !== 0 && code !== null) {
          logger.error('cli.non_zero_exit', {
            code,
            stderr: truncateForLog(stderrTail, 1000),
          });
          emitter.emit('data', {
            type: 'error',
            error: stderrTail || `CLI exited with code ${code}`,
          } satisfies StreamEvent);
        }

        emitter.emit('data', { type: 'done' } satisfies StreamEvent);
        emitter.emit('end');
      });

      child.on('error', (err) => {
        clearInterval(heartbeatCheck);  // 🔴 清理心跳定时器
        activeChildren.delete(child);   // 🔴 从活跃集合移除
        logger.error('cli.spawn_error', {}, err);
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
      logger.error('cli.startup_error', {}, err);
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
 * 构建 codex CLI 命令
 * Build codex CLI command
 *
 * 使用 `codex exec --json` 获取 JSONL 流式输出
 * Uses `codex exec --json` for JSONL streaming output
 *
 * codex 不支持 session resume，需要手动拼接历史
 * codex doesn't support session resume, needs manual history concatenation
 *
 * 参考文档：https://developers.openai.com/codex/cli/reference/
 * Reference: https://developers.openai.com/codex/cli/reference/
 */
function buildCodexCommand(
  prompt: string,
  history: Message[]
): { command: string; args: string[] } {
  const fullPrompt = buildPromptWithHistory(prompt, history);

  const args = [
    'exec',                        // 非交互模式 / non-interactive mode
    '--json',                      // JSONL 流式输出 / JSONL streaming output
  ];

  // 模型选择：支持 CODEX_MODEL 环境变量
  // Model selection: support CODEX_MODEL env var
  const model = process.env.CODEX_MODEL;
  if (model) {
    args.push('--model', model);
  }

  args.push(fullPrompt);

  // 支持自定义 codex 二进制路径
  // Support custom codex binary path
  const command = process.env.CODEX_PATH ?? 'codex';

  return { command, args };
}

/**
 * 构建 gemini CLI 命令
 * Build gemini CLI command
 *
 * 使用 `gemini -p` 非交互模式 + `--output-format stream-json`
 * Uses `gemini -p` non-interactive mode + `--output-format stream-json`
 *
 * gemini 不支持 session resume，需要手动拼接历史
 * gemini doesn't support session resume, needs manual history concatenation
 *
 * 参考文档：https://geminicli.com/docs/cli/headless/
 * Reference: https://geminicli.com/docs/cli/headless/
 */
function buildGeminiCommand(
  prompt: string,
  history: Message[]
): { command: string; args: string[] } {
  const fullPrompt = buildPromptWithHistory(prompt, history);

  const args = [
    '-p',                          // 非交互模式（print mode）/ non-interactive (print mode)
    fullPrompt,
    '--output-format', 'stream-json',  // JSONL 流式输出 / JSONL streaming output
  ];

  // 模型选择：支持 GEMINI_MODEL 环境变量
  // Model selection: support GEMINI_MODEL env var
  const model = process.env.GEMINI_MODEL;
  if (model) {
    args.push('--model', model);
  }

  // 支持自定义 gemini 二进制路径
  // Support custom gemini binary path
  const command = process.env.GEMINI_PATH ?? 'gemini';

  return { command, args };
}

/**
 * 将历史消息拼接进 prompt（用于不支持 session 的 CLI）
 * Concatenate history into prompt (for CLIs without session support)
 *
 * Token 优化：双重截断策略
 * Token optimization: dual truncation strategy
 *   1. 轮数限制：只保留最近 N 条消息（环境变量 MAX_HISTORY_MESSAGES，默认 10）
 *      Turn limit: keep only last N messages (env MAX_HISTORY_MESSAGES, default 10)
 *   2. 单条截断：每条消息超过 M 字符时截断（环境变量 MAX_MESSAGE_CHARS，默认 2000）
 *      Per-message truncation: truncate at M chars (env MAX_MESSAGE_CHARS, default 2000)
 */
function buildPromptWithHistory(prompt: string, history: Message[]): string {
  if (history.length === 0) return prompt;

  // 解析环境变量配置（带 fallback）
  // Parse env config (with fallback)
  const maxMessages = Math.max(2, parseInt(process.env.MAX_HISTORY_MESSAGES ?? '10', 10) || 10);
  const maxCharsPerMessage = Math.max(100, parseInt(process.env.MAX_MESSAGE_CHARS ?? '2000', 10) || 2000);

  // 1) 轮数截断：只保留最近 N 条
  // 1) Turn truncation: keep only last N messages
  const trimmed = history.length > maxMessages
    ? history.slice(-maxMessages)
    : history;

  const omittedCount = history.length - trimmed.length;

  // 2) 单条消息字符截断
  // 2) Per-message character truncation
  const historyText = trimmed
    .map((msg) => {
      const content = msg.content.length > maxCharsPerMessage
        ? msg.content.slice(0, maxCharsPerMessage) + '... [truncated / 已截断]'
        : msg.content;
      return `[${msg.role}]: ${content}`;
    })
    .join('\n');

  // 拼接最终 prompt，含截断提示
  // Build final prompt with truncation notice
  const omitNotice = omittedCount > 0
    ? `(${omittedCount} earlier messages omitted / 已省略 ${omittedCount} 条早期消息)\n`
    : '';

  return `Previous conversation:\n${omitNotice}${historyText}\n\n[user]: ${prompt}`;
}

/**
 * 解析 CLI 输出行为 StreamEvent
 * Parse a CLI output line into a StreamEvent
 */
function parseLine(
  provider: ModelProvider,
  line: string,
  logger: ReturnType<typeof childLogger>
): StreamEvent | null {
  switch (provider) {
    case 'claude':
      return parseClaudeLine(line, logger);
    case 'codex':
      return parseCodexLine(line, logger);
    case 'gemini':
      return parseGeminiLine(line, logger);
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
function parseClaudeLine(line: string, logger: ReturnType<typeof childLogger>): StreamEvent | null {
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
        // 提取 usage 信息 / Extract usage info
        if (raw.usage) {
          return {
            type: 'usage',
            usage: {
              inputTokens: raw.usage.input_tokens ?? 0,
              outputTokens: raw.usage.output_tokens ?? 0,
              cachedTokens: raw.usage.cache_read_input_tokens,
            },
            durationMs: raw.duration_ms,
          };
        }
        return null;
      }

      // system 等其他事件 — 暂时忽略
      // system and other events — skip for now
      default:
        return null;
    }
  } catch (err) {
    // 非 JSON 行（可能是 stderr 泄露），忽略
    // Non-JSON line (could be stderr leak), ignore
    logger.debug('cli.parse_non_json', {
      provider: 'claude',
      line: truncateForLog(line, 220),
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

/**
 * 解析 Codex CLI JSONL 输出（codex exec --json）
 * Parse Codex CLI JSONL output (codex exec --json)
 *
 * 实测输出格式（2026-03-03 验证）：
 * Actual output format (verified 2026-03-03):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 */
function parseCodexLine(line: string, logger: ReturnType<typeof childLogger>): StreamEvent | null {
  try {
    const raw = JSON.parse(line) as CodexStreamMessage;

    // 错误事件 / Error events
    if (raw.type === 'error' || raw.status === 'error') {
      return { type: 'error', error: raw.error ?? raw.output ?? 'Unknown codex error' };
    }

    // item.completed 事件 — Codex 的核心文本载体
    // item.completed event — Codex's primary text carrier
    if (raw.type === 'item.completed' && raw.item) {
      // 只输出 agent_message 类型（跳过 reasoning 等内部思考）
      // Only output agent_message type (skip reasoning and other internal thoughts)
      if (raw.item.type === 'agent_message' && raw.item.text) {
        return { type: 'text', content: raw.item.text };
      }
      return null;
    }

    // 备用：顶层文本字段（兼容其他可能的格式）
    // Fallback: top-level text fields (for other possible formats)
    const text = raw.content ?? raw.text ?? raw.output;
    if (typeof text === 'string' && text) {
      return { type: 'text', content: text };
    }

    // turn.completed 事件 — 提取 token 用量
    // turn.completed event — extract token usage
    if (raw.type === 'turn.completed' && raw.usage) {
      return {
        type: 'usage',
        usage: {
          inputTokens: raw.usage.input_tokens ?? 0,
          outputTokens: raw.usage.output_tokens ?? 0,
          cachedTokens: raw.usage.cached_input_tokens,
        },
      };
    }

    // thread.started, turn.started 等 — 跳过
    // thread.started, turn.started etc. — skip
    return null;
  } catch (err) {
    // 非 JSON 行：Codex 可能输出纯文本（尤其是 stderr 泄露或纯文本模式 fallback）
    // Non-JSON line: Codex may output plain text (especially stderr leak or plain text fallback)
    logger.debug('cli.parse_non_json', {
      provider: 'codex',
      line: truncateForLog(line, 220),
      reason: err instanceof Error ? err.message : 'unknown',
    });
    if (line.trim()) {
      return { type: 'text', content: line };
    }
    return null;
  }
}

/**
 * 解析 Gemini CLI stream-json 输出
 * Parse Gemini CLI stream-json output
 *
 * 实测输出格式（2026-03-03 验证）：
 * Actual output format (verified 2026-03-03):
 *   {"type":"init","session_id":"...","model":"auto-gemini-3"}
 *   {"type":"message","role":"user","content":"hi"}              ← 用户回显，必须跳过！
 *   {"type":"message","role":"assistant","content":"Hello!...","delta":true}
 *   {"type":"tool_use","tool_name":"...","tool_id":"..."}
 *   {"type":"tool_result","tool_id":"...","status":"success"}
 *   {"type":"result","status":"success","stats":{...}}
 *
 * ⚠️ 关键教训：Gemini 会回显用户消息（role:"user"），如果不过滤会污染 assistant 响应
 * ⚠️ Key lesson: Gemini echoes user messages (role:"user"), must filter or it pollutes response
 */
function parseGeminiLine(line: string, logger: ReturnType<typeof childLogger>): StreamEvent | null {
  try {
    const raw = JSON.parse(line) as GeminiStreamMessage;

    // 错误事件 / Error events
    if (raw.type === 'error') {
      return { type: 'error', error: raw.error ?? 'Unknown gemini error' };
    }

    // result 事件（可能包含最终输出或错误，以及 token 用量）
    // result event (may contain final output/error, and token usage)
    if (raw.type === 'result') {
      if (raw.status === 'error') {
        return { type: 'error', error: raw.error ?? raw.output ?? 'Gemini result error' };
      }
      // 提取 stats 中的 token 用量 / Extract token usage from stats
      if (raw.stats) {
        return {
          type: 'usage',
          usage: {
            inputTokens: raw.stats.input_tokens ?? 0,
            outputTokens: raw.stats.output_tokens ?? 0,
            cachedTokens: raw.stats.cached,
            totalTokens: raw.stats.total_tokens,
          },
          durationMs: raw.stats.duration_ms,
        };
      }
      return null; // 正常完成但无 stats / normal completion without stats
    }

    // message 事件 — 只捕获 assistant 角色！跳过 user 回显
    // message event — only capture assistant role! Skip user echo
    if (raw.type === 'message') {
      // ⚠️ 必须过滤：Gemini 会回显 user 消息，不过滤会导致 "hiHello!" 问题
      // ⚠️ Must filter: Gemini echoes user messages, without filter causes "hiHello!" bug
      if (raw.role !== 'assistant') {
        return null;
      }

      // 直接文本字段（实测主格式） / Direct text field (verified primary format)
      if (typeof raw.content === 'string' && raw.content) {
        return { type: 'text', content: raw.content };
      }

      // 备用：嵌套结构（兼容其他可能的格式）
      // Fallback: nested structure (for other possible formats)
      if (raw.message?.content) {
        const textBlocks = raw.message.content.filter((b) => b.type === 'text');
        const text = textBlocks.map((b) => b.text ?? '').join('');
        if (text) {
          return { type: 'text', content: text };
        }
      }

      return null;
    }

    // init, tool_use, tool_result 等暂时忽略
    // init, tool_use, tool_result etc. — skip for now
    return null;
  } catch (err) {
    // 非 JSON 行：Gemini 可能输出纯文本
    // Non-JSON line: Gemini may output plain text
    logger.debug('cli.parse_non_json', {
      provider: 'gemini',
      line: truncateForLog(line, 220),
      reason: err instanceof Error ? err.message : 'unknown',
    });
    if (line.trim()) {
      return { type: 'text', content: line };
    }
    return null;
  }
}

/**
 * 判断是否是 Gemini 遥测噪音（非致命）
 * Detect Gemini telemetry noise (non-fatal)
 */
function isHarmlessGeminiTelemetry(provider: ModelProvider, stderrOutput: string): boolean {
  if (provider !== 'gemini') {
    return false;
  }
  return stderrOutput.includes('ECONNRESET') && stderrOutput.includes('googleapis.com');
}

// ── 重试机制 / Retry mechanism ──────────────────────────────
// 参考 robust-invoke-hw2.js 的 invokeWithRetry：带线性退避的自动重试
// From robust-invoke-hw2.js's invokeWithRetry: auto-retry with linear backoff

/** 默认最大重试次数 / Default max retries */
const DEFAULT_MAX_RETRIES = parseInt(process.env.CLI_MAX_RETRIES ?? '3', 10) || 3;

/** 重试间隔基数（秒）/ Retry delay base (seconds) */
const RETRY_DELAY_BASE = 2;

/**
 * 判断错误是否可重试
 * Determine if an error is retryable
 *
 * 可重试：超时、spawn 失败、非零退出码
 * Retryable: timeout, spawn failure, non-zero exit
 * 不可重试：用户取消、API key 无效等
 * Non-retryable: user cancel, invalid API key, etc.
 */
function isRetryableError(errorText: string): boolean {
  const nonRetryable = [
    'api key',
    'authentication',
    'unauthorized',
    'forbidden',
    'invalid.*key',
    'quota exceeded',
    'rate limit',       // rate limit 应该由 CLI 自身处理 / should be handled by CLI itself
  ];
  const lower = errorText.toLowerCase();
  return !nonRetryable.some((pattern) => new RegExp(pattern).test(lower));
}

/**
 * 带重试的流式 CLI 调用（包装 runCliStream）
 * Streaming CLI call with retry (wraps runCliStream)
 *
 * 策略：如果 CLI stream 以 retryable 错误结束，自动重试
 * Strategy: if CLI stream ends with a retryable error, auto-retry
 *
 * 注意：因为是流式的，重试只在"流尚未产出任何文本"时才安全
 * Note: since streaming, retry is only safe when no text has been emitted yet
 *
 * @param maxRetries - 最大重试次数 / max retry attempts
 */
export function runCliStreamWithRetry(
  provider: ModelProvider,
  prompt: string,
  history: Message[],
  sessionId: string,
  logContext: { requestId?: string; conversationId?: string } = {},
  maxRetries: number = DEFAULT_MAX_RETRIES,
): EventEmitter {
  const outerEmitter = new EventEmitter();
  const retryLogger = childLogger({
    component: 'cli-runner-retry',
    provider,
    requestId: logContext.requestId,
    conversationId: logContext.conversationId ?? sessionId,
  });

  let attempt = 0;

  function tryOnce(): void {
    attempt++;
    let hasEmittedText = false;
    let lastError: string | null = null;

    const inner = runCliStream(provider, prompt, history, sessionId, logContext);

    inner.on('data', (event: StreamEvent) => {
      if (event.type === 'text' && event.content) {
        hasEmittedText = true;
      }
      if (event.type === 'error') {
        lastError = event.error ?? 'unknown error';
      }

      // 如果已经有文本输出了，所有事件都透传（无法安全重试）
      // If text has been emitted, pass through all events (can't safely retry)
      if (hasEmittedText) {
        outerEmitter.emit('data', event);
        return;
      }

      // 还没输出文本时，暂存错误，等 end 时判断是否重试
      // No text yet: hold errors, decide on retry at 'end'
      if (event.type !== 'error' && event.type !== 'done') {
        outerEmitter.emit('data', event);
      }
    });

    inner.on('end', () => {
      // 已有文本输出 → 正常结束
      // Has text output → normal end
      if (hasEmittedText || !lastError) {
        // 如果有 lastError 但也有文本，还是发出错误（部分失败）
        // If there's an error but also text, still emit the error (partial failure)
        if (lastError && hasEmittedText) {
          // error 已经透传了 / error already forwarded
        }
        outerEmitter.emit('data', { type: 'done' } satisfies StreamEvent);
        outerEmitter.emit('end');
        return;
      }

      // 有错误，没文本 → 考虑重试
      // Has error, no text → consider retry
      if (attempt < maxRetries && isRetryableError(lastError)) {
        const delay = attempt * RETRY_DELAY_BASE;
        retryLogger.warn('cli.retry', {
          attempt,
          maxRetries,
          delaySeconds: delay,
          error: truncateForLog(lastError, 300),
        });
        // 向客户端发送重试通知 / Notify client of retry
        outerEmitter.emit('data', {
          type: 'text',
          content: `\n[Retrying... attempt ${attempt + 1}/${maxRetries}, waiting ${delay}s / 重试中... 第 ${attempt + 1}/${maxRetries} 次，等待 ${delay} 秒]\n`,
        } satisfies StreamEvent);
        setTimeout(tryOnce, delay * 1000);
      } else {
        // 不可重试 或 重试次数用完 / Non-retryable or exhausted retries
        if (attempt >= maxRetries) {
          retryLogger.error('cli.retries_exhausted', {
            totalAttempts: attempt,
            error: truncateForLog(lastError, 300),
          });
        }
        outerEmitter.emit('data', {
          type: 'error',
          error: lastError,
        } satisfies StreamEvent);
        outerEmitter.emit('data', { type: 'done' } satisfies StreamEvent);
        outerEmitter.emit('end');
      }
    });
  }

  // 用 nextTick 保证调用方能先绑定监听器
  // Use nextTick so caller can attach listeners first
  process.nextTick(tryOnce);

  return outerEmitter;
}

/** 获取活跃子进程数量（用于监控和测试）/ Get active children count (for monitoring/testing) */
export function getActiveChildrenCount(): number {
  return activeChildren.size;
}
