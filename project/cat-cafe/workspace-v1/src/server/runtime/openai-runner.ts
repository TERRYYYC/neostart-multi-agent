/**
 * OpenAiRunner — LLM execution via Codex CLI subprocess.
 * OpenAI 执行器 — 通过 Codex CLI 子进程调用 LLM。
 *
 * Spawns `codex exec --json` as a child process and streams text
 * deltas back through the Runner interface.
 * 生成 `codex exec --json` 子进程，并通过 Runner 接口流式返回文本增量。
 *
 * NDJSON event format (from codex CLI):
 *   { type: 'item.completed', item: { type: 'agent_message', text: '...' } }
 *
 * Reference: robust-invoke-hw2.js
 *
 * Key design decisions:
 *   - Uses `codex exec --json` for non-interactive, machine-readable output
 *   - profile.model is not passed (codex uses its configured model)
 *   - profile.persona is prepended to the prompt as context
 *   - Conversation history loaded from messageStore (same as cli-runner)
 *   - Heartbeat timeout kills hung processes
 *   - stderr is captured in a sliding window
 *   - SIGTERM/SIGKILL cleanup prevents orphan processes
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Runner, RunParams, RunnerResult } from './runner.js';
import type { AgentProfile, Message } from '../../shared/types.js';
import { messageStore } from '../persistence/index.js';
import { getPredecessorSummary } from './session-chain.js';

// ── Environment cleanup / 环境变量清理 ──────────────────────
// 参考 cli-runner.ts：移除 Claude 嵌套检测相关环境变量，防止干扰子进程
// Reference cli-runner.ts: remove Claude nesting detection env vars to prevent subprocess interference

const REMOVE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_AGENT_SDK_VERSION',
  '__CFBundleIdentifier',
];

/** Build a clean env without Claude nesting detection vars. / 构建不含 Claude 检测变量的干净环境。 */
function buildCleanEnv(): NodeJS.ProcessEnv {
  const cleanEnv = { ...process.env };
  for (const key of REMOVE_ENV_VARS) {
    delete cleanEnv[key];
  }
  return cleanEnv;
}

// ── Child process lifecycle management / 子进程生命周期管理 ──────

/** All active child processes / 所有活跃子进程 */
const activeChildren = new Set<ChildProcess>();

/** Children with scheduled SIGKILL / 已安排 SIGKILL 的子进程 */
const pendingKills = new WeakSet<ChildProcess>();

/**
 * Gracefully kill child: SIGTERM first, SIGKILL after 5s.
 * 安全终止子进程：先 SIGTERM，5 秒后 SIGKILL。
 */
function killChild(child: ChildProcess): void {
  if (pendingKills.has(child)) return;
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
      // process may have already exited / 进程可能已退出
    }
  }, 5000);
  forceKillTimer.unref();
}

/** Clean up all active children on process exit / 进程退出时清理所有子进程 */
function cleanupAllChildren(): void {
  if (activeChildren.size > 0) {
    console.warn(
      `[openai-runner] Killing ${activeChildren.size} active Codex children on process exit`,
    );
    for (const child of activeChildren) {
      killChild(child);
    }
  }
  setTimeout(() => process.exit(1), 6000).unref();
}

let signalHandlersRegistered = false;
function ensureSignalHandlers(): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;
  process.on('SIGTERM', cleanupAllChildren);
  process.on('SIGINT', cleanupAllChildren);
}

// ── Configuration / 配置 ─────────────────────────────────────

/** Heartbeat timeout (ms). Default 120s. / 心跳超时，默认 120 秒 */
const HEARTBEAT_TIMEOUT = Math.max(
  30000,
  parseInt(process.env.CLI_HEARTBEAT_TIMEOUT ?? '120000', 10) || 120000,
);

/** Heartbeat check interval (ms) / 心跳检查间隔 */
const HEARTBEAT_CHECK_INTERVAL = 10000;

/** Max stderr chars to keep / stderr 最大保留字符数 */
const STDERR_TAIL_LIMIT = 2000;

/** Max history messages to include / 最大历史消息数 */
const MAX_HISTORY_MESSAGES = Math.max(
  2,
  parseInt(process.env.MAX_HISTORY_MESSAGES ?? '10', 10) || 10,
);

/** Max chars per history message / 每条历史消息最大字符数 */
const MAX_MESSAGE_CHARS = Math.max(
  100,
  parseInt(process.env.MAX_MESSAGE_CHARS ?? '2000', 10) || 2000,
);

// ── Codex stream-json types / Codex NDJSON 类型 ──────────────

/**
 * Raw event format from codex CLI --json output.
 * codex CLI --json 输出的原始事件格式。
 *
 * Verified event types (2026-03-03):
 * 实测事件类型 (2026-03-03 验证):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 */
interface CodexStreamEvent {
  type: string;
  item?: {
    id?: string;
    type?: string;   // "agent_message" | "reasoning" etc.
    text?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  // Fallback top-level fields / 备用顶层字段
  content?: string;
  text?: string;
  output?: string;
  error?: string;
  status?: 'success' | 'error';
}

// ── Main OpenAiRunner class / OpenAiRunner 主类 ──────────────

export class OpenAiRunner implements Runner {
  async run(params: RunParams): Promise<RunnerResult> {
    const { invocationId, threadId, profile, taskText, sessionId, onTextDelta } = params;

    ensureSignalHandlers();

    // Load conversation history for context.
    // 加载对话历史作为上下文。
    const history = await this.loadHistory(threadId);

    // Load predecessor session summary if available.
    // 加载前任 session 摘要（如有）。
    const predecessorSummary = sessionId
      ? await getPredecessorSummary(sessionId)
      : null;

    // Build CLI command.
    // 构建 CLI 命令。
    const { command, args } = this.buildCommand(profile, taskText, history, predecessorSummary);

    console.log(
      `[openai-runner] Spawning ${command} for invocation ${invocationId} ` +
      `(agent=${profile.name}, model=${profile.model}, historySize=${history.length})`,
    );

    return new Promise<RunnerResult>((resolve) => {
      try {
        // Use clean env to prevent Claude nesting detection vars from interfering.
        // 使用干净环境，防止 Claude 嵌套检测变量干扰。
        const child = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: buildCleanEnv(),
        });

        activeChildren.add(child);

        let buffer = '';
        let lastActivity = Date.now();
        let killedByHeartbeat = false;
        const textChunks: string[] = [];

        // stdout processing / stdout 处理
        child.stdout!.on('data', (chunk: Buffer) => {
          lastActivity = Date.now();
          const text = chunk.toString();
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            this.processLine(trimmed, textChunks, onTextDelta);
          }
        });

        // stderr sliding window / stderr 滑动窗口
        let stderrTail = '';
        child.stderr!.on('data', (chunk: Buffer) => {
          lastActivity = Date.now();
          const text = chunk.toString();
          stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
        });

        // Heartbeat check timer / 心跳检查定时器
        const heartbeatCheck = setInterval(() => {
          const silenceMs = Date.now() - lastActivity;
          if (silenceMs > HEARTBEAT_TIMEOUT) {
            console.error(
              `[openai-runner] Heartbeat timeout: no output for ${Math.round(silenceMs / 1000)}s, killing process`,
            );
            killedByHeartbeat = true;
            killChild(child);
          }
        }, HEARTBEAT_CHECK_INTERVAL);
        heartbeatCheck.unref();

        child.on('close', (code) => {
          clearInterval(heartbeatCheck);
          activeChildren.delete(child);

          console.log(
            `[openai-runner] Process exited: code=${code ?? -1}, ` +
            `textChunks=${textChunks.length}, killedByHeartbeat=${killedByHeartbeat}`,
          );

          // Process remaining buffer / 处理缓冲区残留
          if (buffer.trim()) {
            this.processLine(buffer.trim(), textChunks, onTextDelta);
          }

          const fullText = textChunks.join('');

          if (killedByHeartbeat) {
            resolve({
              ok: false,
              errorCode: 'heartbeat_timeout',
              errorMessage:
                `Codex CLI timed out (no output for ${Math.round(HEARTBEAT_TIMEOUT / 1000)}s). ` +
                `stderr: ${stderrTail.slice(-500)}`,
            });
          } else if (code !== 0 && code !== null && !fullText) {
            resolve({
              ok: false,
              errorCode: 'cli_exit_error',
              errorMessage: stderrTail || `Codex CLI exited with code ${code}`,
            });
          } else {
            // Success: even if exit code non-zero, if we got text, treat as success.
            // 成功：即使退出码非零，只要有文本就视为成功。
            resolve({
              ok: true,
              text: fullText,
            });
          }
        });

        child.on('error', (err) => {
          clearInterval(heartbeatCheck);
          activeChildren.delete(child);
          console.error(`[openai-runner] Spawn error: ${err.message}`);
          resolve({
            ok: false,
            errorCode: 'spawn_error',
            errorMessage: `Failed to spawn ${command}: ${err.message}. Is codex CLI installed? (npm i -g @openai/codex)`,
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[openai-runner] Startup error: ${message}`);
        resolve({
          ok: false,
          errorCode: 'startup_error',
          errorMessage: message,
        });
      }
    });
  }

  // ── Command building / 命令构建 ──────────────────────────

  /**
   * Build codex CLI command.
   * 构建 codex CLI 命令。
   *
   * Format: codex exec --json "<prompt>"
   * 格式：codex exec --json "<prompt>"
   */
  private buildCommand(
    profile: AgentProfile,
    taskText: string,
    history: Message[],
    predecessorSummary: string | null,
  ): { command: string; args: string[] } {
    const command = process.env.CODEX_PATH ?? 'codex';

    // Build prompt with persona + history + predecessor context.
    // 构建包含人格、历史和前任上下文的提示。
    const fullPrompt = this.buildPromptWithHistory(profile.persona, taskText, history, predecessorSummary);

    const args = ['exec', '--json'];

    // Model selection: env var only (matching reference cli-runner.ts).
    // 模型选择：仅通过环境变量（与参考代码一致）。
    const model = process.env.CODEX_MODEL;
    if (model) {
      args.push('--model', model);
    }

    args.push(fullPrompt);

    return { command, args };
  }

  // ── History / 历史消息 ────────────────────────────────────

  /**
   * Load public messages from this thread as conversation context.
   * 从线程中加载公开消息作为对话上下文。
   */
  private async loadHistory(threadId: string): Promise<Message[]> {
    const messages = await messageStore.findBy(
      (m) =>
        m.threadId === threadId &&
        (m.visibility === 'public' || m.visibility === 'system-summary'),
    );
    messages.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return messages;
  }

  /**
   * Concatenate persona + history into prompt with dual truncation.
   * 用双重截断将人格和历史拼接进 prompt。
   */
  private buildPromptWithHistory(
    persona: string,
    taskText: string,
    history: Message[],
    predecessorSummary?: string | null,
  ): string {
    const parts: string[] = [];

    // Prepend persona as system context.
    // 将人格作为系统上下文前置。
    if (persona) {
      parts.push(`[System Instructions]: ${persona}`);
    }

    // Predecessor context from sealed session chain.
    // 来自封存 session 链的前任上下文。
    if (predecessorSummary) {
      parts.push(`[Context from previous session]:\n${predecessorSummary}`);
    }

    if (history.length > 0) {
      // 1) Turn truncation / 轮数截断
      const trimmed =
        history.length > MAX_HISTORY_MESSAGES
          ? history.slice(-MAX_HISTORY_MESSAGES)
          : history;

      const omittedCount = history.length - trimmed.length;

      // 2) Per-message char truncation / 单条消息字符截断
      const historyText = trimmed
        .map((msg) => {
          const content =
            msg.content.length > MAX_MESSAGE_CHARS
              ? msg.content.slice(0, MAX_MESSAGE_CHARS) + '... [truncated]'
              : msg.content;
          return `[${msg.role}]: ${content}`;
        })
        .join('\n');

      const omitNotice =
        omittedCount > 0
          ? `(${omittedCount} earlier messages omitted)\n`
          : '';

      parts.push(`Previous conversation:\n${omitNotice}${historyText}`);
    }

    parts.push(`[user]: ${taskText}`);

    return parts.join('\n\n');
  }

  // ── Stream parsing / 流解析 ───────────────────────────────

  /**
   * Parse one line of codex NDJSON and forward text deltas.
   * 解析一行 codex NDJSON 并转发文本增量。
   *
   * Verified event format (2026-03-03):
   * 实测事件格式 (2026-03-03 验证):
   *   item.completed + agent_message → 提取 item.text
   *   item.completed + reasoning     → 跳过（内部思考）
   *   turn.completed                 → token 用量
   *   thread.started, turn.started   → 跳过
   */
  private processLine(
    line: string,
    textChunks: string[],
    onTextDelta: (chunk: string) => Promise<void>,
  ): void {
    try {
      const raw = JSON.parse(line) as CodexStreamEvent;

      // Error events / 错误事件
      if (raw.type === 'error' || raw.status === 'error') {
        const err = raw.error ?? raw.output ?? 'Unknown codex error';
        console.error(`[openai-runner] Codex error: ${err}`);
        return;
      }

      // item.completed — primary text carrier.
      // item.completed — 核心文本载体。
      if (raw.type === 'item.completed' && raw.item) {
        // Only output agent_message (skip reasoning, etc.).
        // 只输出 agent_message（跳过 reasoning 等内部思考）。
        if (raw.item.type === 'agent_message' && raw.item.text) {
          textChunks.push(raw.item.text);
          void onTextDelta(raw.item.text);
        }
        return;
      }

      // Fallback: top-level text fields.
      // 备用：顶层文本字段。
      const text = raw.content ?? raw.text ?? raw.output;
      if (typeof text === 'string' && text) {
        textChunks.push(text);
        void onTextDelta(text);
        return;
      }

      // turn.completed — log usage.
      // turn.completed — 记录用量。
      if (raw.type === 'turn.completed' && raw.usage) {
        console.log(
          `[openai-runner] Usage: in=${raw.usage.input_tokens}, out=${raw.usage.output_tokens}, ` +
          `cached=${raw.usage.cached_input_tokens}`,
        );
      }
    } catch {
      // Non-JSON line: Codex may output plain text (stderr leak or plain text fallback).
      // 非 JSON 行：Codex 可能输出纯文本。
      if (line.trim()) {
        textChunks.push(line);
        void onTextDelta(line);
      }
    }
  }
}

// ── Singleton instance / 单例 ───────────────────────────────

/** Default OpenAiRunner instance. / 默认 OpenAiRunner 实例。 */
export const openaiRunner = new OpenAiRunner();
