/**
 * CliRunner — real LLM execution via CLI subprocess.
 * CLI 执行器 — 通过 CLI 子进程调用真实 LLM。
 *
 * Adapted from the fma project's cli-runner.ts.
 * 从 fma 项目的 cli-runner.ts 适配而来。
 *
 * Spawns `claude` CLI (or `codex` / `gemini` in future phases) as a
 * child process and streams text deltas back through the Runner interface.
 * 生成 `claude` CLI 子进程，并通过 Runner 接口流式返回文本增量。
 *
 * Key design decisions:
 *   - provider is derived from AgentProfile.provider
 *   - model is taken from AgentProfile.model
 *   - system prompt (persona) is passed via --system-prompt flag
 *   - conversation context is loaded from messageStore and passed to the CLI
 *   - heartbeat timeout kills hung processes
 *   - stderr is captured in a sliding window (防内存泄漏)
 *   - SIGTERM/SIGKILL cleanup prevents orphan processes
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Runner, RunParams, RunnerResult } from './runner.js';
import type { AgentProfile, Message } from '../../shared/types.js';
import { messageStore } from '../persistence/index.js';
import { getPredecessorSummary } from './session-chain.js';
import { findRelevantMemories } from './memory-loader.js';

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
      `[cli-runner] Killing ${activeChildren.size} active CLI children on process exit`,
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

/**
 * Env vars to remove (prevent Claude CLI nesting detection).
 * 需要从环境变量中移除的键（防止 Claude CLI 嵌套检测）。
 */
const REMOVE_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL',
  'CLAUDE_AGENT_SDK_VERSION',
  '__CFBundleIdentifier',
];

// ── Claude stream-json types / Claude stream-json 类型 ───────

/**
 * Raw event format from claude CLI stream-json output.
 * claude CLI stream-json 输出的原始事件格式。
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ── Main CliRunner class / CliRunner 主类 ────────────────────

export class CliRunner implements Runner {
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

    // Load relevant memories for context injection (Phase 4).
    // 加载相关记忆用于上下文注入（Phase 4）。
    const memoryContext = await findRelevantMemories(threadId, profile.id, taskText, history);
    if (memoryContext.memories.length > 0) {
      console.log(
        `[cli-runner] Injecting ${memoryContext.memories.length} memories ` +
        `(keys: ${memoryContext.memories.map((m) => m.key).join(', ')})`,
      );
    }

    // Build CLI command.
    // 构建 CLI 命令。
    const { command, args } = this.buildCommand(profile, taskText, history, predecessorSummary, memoryContext.formatted);

    console.log(
      `[cli-runner] Spawning ${command} for invocation ${invocationId} ` +
      `(agent=${profile.name}, model=${profile.model}, historySize=${history.length})`,
    );

    return new Promise<RunnerResult>((resolve) => {
      try {
        // Build clean env, remove Claude nesting detection vars.
        // 构建干净的环境变量，移除嵌套检测变量。
        const cleanEnv = { ...process.env };
        for (const key of REMOVE_ENV_VARS) {
          delete cleanEnv[key];
        }

        const child = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cleanEnv,
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
              `[cli-runner] Heartbeat timeout: no output for ${Math.round(silenceMs / 1000)}s, killing process`,
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
            `[cli-runner] Process exited: code=${code ?? -1}, ` +
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
                `CLI timed out (no output for ${Math.round(HEARTBEAT_TIMEOUT / 1000)}s). ` +
                `stderr: ${stderrTail.slice(-500)}`,
            });
          } else if (code !== 0 && code !== null && !fullText) {
            resolve({
              ok: false,
              errorCode: 'cli_exit_error',
              errorMessage: stderrTail || `CLI exited with code ${code}`,
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
          console.error(`[cli-runner] Spawn error: ${err.message}`);
          resolve({
            ok: false,
            errorCode: 'spawn_error',
            errorMessage: `Failed to spawn ${command}: ${err.message}`,
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cli-runner] Startup error: ${message}`);
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
   * Build CLI command based on agent profile.
   * 根据 Agent 档案构建 CLI 命令。
   */
  private buildCommand(
    profile: AgentProfile,
    taskText: string,
    history: Message[],
    predecessorSummary: string | null,
    memorySection: string,
  ): { command: string; args: string[] } {
    // For v1, all cats use Anthropic / Claude CLI.
    // v1 中所有猫都使用 Anthropic / Claude CLI。
    // Future: switch on profile.provider for codex/gemini.
    // 未来：根据 profile.provider 切换到 codex/gemini。
    switch (profile.provider) {
      case 'anthropic':
        return this.buildClaudeCommand(profile, taskText, history, predecessorSummary, memorySection);
      default:
        // Fallback to Claude for unknown providers.
        // 未知 provider 回退到 Claude。
        console.warn(
          `[cli-runner] Unknown provider "${profile.provider}", falling back to claude`,
        );
        return this.buildClaudeCommand(profile, taskText, history, predecessorSummary, memorySection);
    }
  }

  /**
   * Build claude CLI command with persona and context.
   * 构建包含人格和上下文的 claude CLI 命令。
   *
   * Key flags:
   *   -p                     → print mode (non-interactive)
   *   --output-format stream-json → JSONL streaming
   *   --model                → from AgentProfile.model
   *   --system-prompt        → from AgentProfile.persona
   *   --verbose              → full output for debugging
   */
  private buildClaudeCommand(
    profile: AgentProfile,
    taskText: string,
    history: Message[],
    predecessorSummary: string | null,
    memorySection: string,
  ): { command: string; args: string[] } {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--model', profile.model,
      '--verbose',
    ];

    // Inject persona as system prompt.
    // 注入人格作为系统提示。
    if (profile.persona) {
      args.push('--system-prompt', profile.persona);
    }

    // Build prompt with conversation history and predecessor context.
    // 构建包含对话历史和前任上下文的提示。
    const fullPrompt = this.buildPromptWithHistory(taskText, history, predecessorSummary, memorySection);
    args.push(fullPrompt);

    const command = process.env.CLAUDE_PATH ?? 'claude';
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
    // Sort ascending by creation time.
    // 按创建时间升序排列。
    messages.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return messages;
  }

  /**
   * Concatenate history into prompt with dual truncation.
   * 用双重截断将历史拼接进 prompt。
   *
   * 1. Turn limit: keep only last N messages.
   *    轮数限制：只保留最近 N 条消息。
   * 2. Per-message truncation: cap each message at M chars.
   *    单条截断：每条消息最多 M 字符。
   */
  private buildPromptWithHistory(
    taskText: string,
    history: Message[],
    predecessorSummary?: string | null,
    memorySection?: string,
  ): string {
    const parts: string[] = [];

    // Predecessor context from sealed session chain.
    // 来自封存 session 链的前任上下文。
    if (predecessorSummary) {
      parts.push(`[Context from previous session]:\n${predecessorSummary}`);
    }

    // Long-term memory injection (Phase 4).
    // 长期记忆注入（Phase 4）。
    if (memorySection) {
      parts.push(memorySection);
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
   * Parse one line of claude stream-json and forward text deltas.
   * 解析一行 claude stream-json 并转发文本增量。
   */
  private processLine(
    line: string,
    textChunks: string[],
    onTextDelta: (chunk: string) => Promise<void>,
  ): void {
    try {
      const raw = JSON.parse(line) as ClaudeStreamMessage;

      switch (raw.type) {
        case 'assistant': {
          const textBlocks =
            raw.message?.content?.filter((b) => b.type === 'text') ?? [];
          const text = textBlocks.map((b) => b.text ?? '').join('');
          if (text) {
            textChunks.push(text);
            // Fire and forget — onTextDelta is awaited by orchestrator event pipeline.
            // 触发即忘 — onTextDelta 由编排器事件管道等待。
            void onTextDelta(text);
          }
          break;
        }

        case 'result': {
          if (raw.status === 'error') {
            console.error(
              `[cli-runner] CLI result error: ${raw.output ?? 'unknown'}`,
            );
          }
          // Usage info logged but not forwarded in v1.
          // v1 中用量信息只记录不转发。
          if (raw.usage) {
            console.log(
              `[cli-runner] Usage: in=${raw.usage.input_tokens}, out=${raw.usage.output_tokens}, ` +
              `cached=${raw.usage.cache_read_input_tokens}, duration=${raw.duration_ms}ms`,
            );
          }
          break;
        }

        default:
          // system and other events — skip
          break;
      }
    } catch {
      // Non-JSON line (stderr leak or debug output), ignore.
      // 非 JSON 行（stderr 泄露或调试输出），忽略。
    }
  }
}

// ── Singleton instance / 单例 ───────────────────────────────

/** Default CliRunner instance for Phase 2. / Phase 2 默认 CliRunner 实例。 */
export const cliRunner = new CliRunner();

/** Get active children count (monitoring/testing). / 获取活跃子进程数量。 */
export function getActiveChildrenCount(): number {
  return activeChildren.size;
}
