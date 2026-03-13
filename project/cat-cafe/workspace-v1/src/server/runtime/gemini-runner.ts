/**
 * GeminiRunner — LLM execution via Gemini CLI subprocess.
 * Gemini 执行器 — 通过 Gemini CLI 子进程调用 LLM。
 *
 * Spawns `gemini -p --output-format stream-json` as a child process and
 * streams text deltas back through the Runner interface.
 * 生成 `gemini -p --output-format stream-json` 子进程，
 * 并通过 Runner 接口流式返回文本增量。
 *
 * NDJSON event format (from gemini CLI):
 *   { type: 'message', role: 'assistant', content: '...' }
 *   { type: 'result', response: '...', stats: {...} }
 *
 * Key design decisions:
 *   - Uses `gemini -p --output-format stream-json --model <model>` for
 *     non-interactive, machine-readable output
 *   - profile.model maps to --model flag (e.g. gemini-2.0-flash)
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
      `[gemini-runner] Killing ${activeChildren.size} active Gemini children on process exit`,
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

// ── Gemini stream-json types / Gemini NDJSON 类型 ────────────

/**
 * Raw event format from gemini CLI stream-json output.
 * gemini CLI stream-json 输出的原始事件格式。
 *
 * Known event types:
 *   - init:     session metadata
 *   - message:  user/assistant message chunks (content in 'content' field)
 *   - tool_use: tool call requests
 *   - tool_result: tool output
 *   - result:   final outcome with stats (response in 'response' field)
 *   - error:    non-fatal warnings
 */
/**
 * Verified event types (2026-03-03):
 * 实测事件类型 (2026-03-03 验证):
 *   {"type":"init","session_id":"...","model":"auto-gemini-3"}
 *   {"type":"message","role":"user","content":"hi"}           ← must skip!
 *   {"type":"message","role":"assistant","content":"Hello!","delta":true}
 *   {"type":"tool_use","tool_name":"...","tool_id":"..."}
 *   {"type":"tool_result","tool_id":"...","status":"success"}
 *   {"type":"result","status":"success","stats":{...}}
 */
interface GeminiStreamEvent {
  type: string;
  /** Role: 'user' | 'assistant'. Must filter for assistant only! / 必须只取 assistant! */
  role?: 'user' | 'assistant';
  /** Direct text content (verified primary format). / 直接文本（实测主格式）。 */
  content?: string;
  /** Whether this is a delta message. / 是否为增量消息。 */
  delta?: boolean;
  /** Nested content structure (fallback). / 嵌套内容结构（备用）。 */
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  /** Response text in result events. / result 事件中的响应文本。 */
  response?: string;
  output?: string;
  /** Error info. / 错误信息。 */
  error?: string;
  /** Status for result events. / result 事件状态。 */
  status?: 'success' | 'error';
  /** Stats in result events. / result 事件统计。 */
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
  };
}

// ── Main GeminiRunner class / GeminiRunner 主类 ──────────────

export class GeminiRunner implements Runner {
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
      `[gemini-runner] Spawning ${command} for invocation ${invocationId} ` +
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
              `[gemini-runner] Heartbeat timeout: no output for ${Math.round(silenceMs / 1000)}s, killing process`,
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
            `[gemini-runner] Process exited: code=${code ?? -1}, ` +
            `textChunks=${textChunks.length}, killedByHeartbeat=${killedByHeartbeat}`,
          );

          // Log stderr unless it's harmless telemetry noise.
          // 记录 stderr，除非是无害的遥测噪音。
          if (stderrTail && !isHarmlessGeminiTelemetry(stderrTail)) {
            console.warn(`[gemini-runner] stderr: ${stderrTail.slice(-500)}`);
          }

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
                `Gemini CLI timed out (no output for ${Math.round(HEARTBEAT_TIMEOUT / 1000)}s). ` +
                `stderr: ${stderrTail.slice(-500)}`,
            });
          } else if (code !== 0 && code !== null && !fullText) {
            resolve({
              ok: false,
              errorCode: 'cli_exit_error',
              errorMessage: stderrTail || `Gemini CLI exited with code ${code}`,
            });
          } else {
            resolve({
              ok: true,
              text: fullText,
            });
          }
        });

        child.on('error', (err) => {
          clearInterval(heartbeatCheck);
          activeChildren.delete(child);
          console.error(`[gemini-runner] Spawn error: ${err.message}`);
          resolve({
            ok: false,
            errorCode: 'spawn_error',
            errorMessage: `Failed to spawn ${command}: ${err.message}. Is gemini CLI installed? (npm i -g @google/gemini-cli)`,
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[gemini-runner] Startup error: ${message}`);
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
   * Build gemini CLI command with model and persona.
   * 构建包含模型和人格的 gemini CLI 命令。
   *
   * Format: gemini -p --output-format stream-json --model <model> "<prompt>"
   * 格式：gemini -p --output-format stream-json --model <model> "<prompt>"
   */
  private buildCommand(
    profile: AgentProfile,
    taskText: string,
    history: Message[],
    predecessorSummary: string | null,
  ): { command: string; args: string[] } {
    const command = process.env.GEMINI_PATH ?? 'gemini';

    // Build prompt with persona + history + predecessor context.
    // 构建包含人格、历史和前任上下文的提示。
    const fullPrompt = this.buildPromptWithHistory(profile.persona, taskText, history, predecessorSummary);

    // ⚠️ Key: prompt must come right after -p, then flags after.
    // ⚠️ 关键：prompt 必须紧跟在 -p 后面，其他参数放后面。
    const args = [
      '-p',
      fullPrompt,
      '--output-format', 'stream-json',
    ];

    // Model selection: env var only (matching reference cli-runner.ts).
    // 模型选择：仅通过环境变量（与参考代码一致）。
    //
    // ⚠️ profile.model is NOT passed to --model flag because:
    //    1. Reference implementation only uses GEMINI_MODEL env var
    //    2. Gemini CLI may not recognize all model name formats
    //    3. Gemini CLI defaults to "auto" which selects the best model
    // ⚠️ profile.model 不传给 --model 参数，因为：
    //    1. 参考实现只使用 GEMINI_MODEL 环境变量
    //    2. Gemini CLI 可能不识别所有模型名称格式
    //    3. Gemini CLI 默认 "auto" 会自动选择最佳模型
    const model = process.env.GEMINI_MODEL;
    if (model) {
      args.push('--model', model);
    }

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
   * Parse one line of gemini stream-json NDJSON and forward text deltas.
   * 解析一行 gemini stream-json NDJSON 并转发文本增量。
   *
   * Verified event format (2026-03-03):
   * 实测事件格式 (2026-03-03 验证):
   *   message(role:assistant) → content 字段
   *   message(role:user)      → 跳过！Gemini 会回显用户消息
   *   result                  → stats 统计信息
   *   error                   → 错误
   *
   * ⚠️ Key lesson: Gemini echoes user messages (role:"user"),
   *    must filter or it pollutes the assistant response!
   * ⚠️ 关键教训：Gemini 会回显用户消息，不过滤会污染 assistant 响应！
   */
  private processLine(
    line: string,
    textChunks: string[],
    onTextDelta: (chunk: string) => Promise<void>,
  ): void {
    try {
      const raw = JSON.parse(line) as GeminiStreamEvent;

      // Error events / 错误事件
      if (raw.type === 'error') {
        if (raw.error) {
          console.error(`[gemini-runner] Stream error: ${raw.error}`);
        }
        return;
      }

      // Result event — extract stats, check for errors.
      // result 事件 — 提取统计，检查错误。
      if (raw.type === 'result') {
        if (raw.status === 'error') {
          console.error(`[gemini-runner] Result error: ${raw.error ?? raw.output ?? 'unknown'}`);
        }
        if (raw.stats) {
          console.log(
            `[gemini-runner] Stats: in=${raw.stats.input_tokens}, out=${raw.stats.output_tokens}, ` +
            `total=${raw.stats.total_tokens}, duration=${raw.stats.duration_ms}ms`,
          );
        }
        return;
      }

      // Message event — only capture assistant role! Skip user echo.
      // message 事件 — 只取 assistant！跳过 user 回显。
      if (raw.type === 'message') {
        // ⚠️ Must filter: Gemini echoes user messages.
        // ⚠️ 必须过滤：Gemini 会回显用户消息。
        if (raw.role !== 'assistant') {
          return;
        }

        // Direct content field (verified primary format).
        // 直接 content 字段（实测主格式）。
        if (typeof raw.content === 'string' && raw.content) {
          textChunks.push(raw.content);
          void onTextDelta(raw.content);
          return;
        }

        // Fallback: nested message.content structure.
        // 备用：嵌套 message.content 结构。
        if (raw.message?.content) {
          const textBlocks = raw.message.content.filter((b) => b.type === 'text');
          const text = textBlocks.map((b) => b.text ?? '').join('');
          if (text) {
            textChunks.push(text);
            void onTextDelta(text);
          }
        }
        return;
      }

      // init, tool_use, tool_result — skip.
    } catch {
      // Non-JSON line: Gemini may output plain text.
      // 非 JSON 行：Gemini 可能输出纯文本。
      if (line.trim()) {
        textChunks.push(line);
        void onTextDelta(line);
      }
    }
  }
}

// ── Gemini telemetry noise filter / Gemini 遥测噪音过滤 ─────

/**
 * Detect harmless Gemini telemetry noise in stderr.
 * 检测 stderr 中无害的 Gemini 遥测噪音。
 *
 * Gemini CLI sometimes produces ECONNRESET errors to googleapis.com
 * in stderr — these are non-fatal telemetry connection drops.
 * Gemini CLI 有时在 stderr 中产生 ECONNRESET 到 googleapis.com 的错误——
 * 这些是非致命的遥测连接断开。
 */
function isHarmlessGeminiTelemetry(stderrOutput: string): boolean {
  return stderrOutput.includes('ECONNRESET') && stderrOutput.includes('googleapis.com');
}

// ── Singleton instance / 单例 ───────────────────────────────

/** Default GeminiRunner instance. / 默认 GeminiRunner 实例。 */
export const geminiRunner = new GeminiRunner();
