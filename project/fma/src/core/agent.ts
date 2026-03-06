// ============================================================
// agent.ts — 底层 Agent 运行器（CLI subprocess 多模型版）
// Base agent runner (CLI subprocess, multi-model)
// ============================================================
//
// [Phase 2 升级] 从 Anthropic SDK 替换为 CLI subprocess
// [Phase 2 upgrade] Replaced Anthropic SDK with CLI subprocess
//
// 设计决策（参考 p006 ADR-001）：
// Design decisions (ref p006 ADR-001):
//
//   1. CLI > SDK：支持 OAuth 和多模型，不再锁定 Anthropic
//      CLI > SDK: supports OAuth and multi-model, no longer locked to Anthropic
//   2. 复用 chat/cli-runner.ts 的 subprocess 基础设施
//      Reuse battle-tested subprocess infra from chat/cli-runner.ts
//   3. EventEmitter → Promise 包装：Pipeline 模式不需要流式
//      EventEmitter → Promise wrapper: Pipeline mode doesn't need streaming
//   4. 向后兼容：runAgent() 签名不变，上层 Agent 零修改
//      Backward compat: runAgent() signature unchanged, zero upstream changes
//
// 支持的 provider：
// Supported providers:
//   - claude: `claude -p --system-prompt "..." --output-format stream-json "prompt"`
//   - codex:  `codex exec --json "prompt"` (system prompt 前置拼接)
//   - gemini: `gemini -p --output-format stream-json "prompt"` (system prompt 前置拼接)
//
// ============================================================

import { randomUUID } from 'node:crypto';
import { runCliStreamWithRetry } from '../chat/cli-runner.js';
import { childLogger, truncateForLog } from '../chat/logger.js';
import type { StreamEvent } from '../chat/types.js';
import type { AgentResult, AgentRunOptions } from './types.js';

// ── 默认配置 / Default configuration ────────────────────────

/** 默认 provider / Default provider */
const DEFAULT_PROVIDER = 'claude' as const;

/**
 * 默认模型映射（成本分层建议）
 * Default model mapping (cost-tier recommendations)
 *
 * 业界测算，合理分层可降低 60-70% API 成本
 * Industry estimates: proper tiering reduces API cost by 60-70%
 *
 * 这里的默认值可通过 AgentRunOptions.model 覆盖
 * Defaults here can be overridden via AgentRunOptions.model
 */
const DEFAULT_MODELS: Record<string, string> = {
  claude: 'sonnet',       // 平衡性价比 / balanced cost-performance
  codex: '',              // codex 使用 CLI 默认模型 / codex uses CLI default
  gemini: '',             // gemini 使用 CLI 默认模型 / gemini uses CLI default
};

const logger = childLogger({ component: 'agent-runner' });

/**
 * 运行一个 Agent：通过 CLI subprocess 调用 AI 模型
 * Run one agent: invoke AI model via CLI subprocess
 *
 * [Phase 2] 从 SDK 升级为 CLI subprocess，支持多模型
 * [Phase 2] Upgraded from SDK to CLI subprocess, supports multi-model
 *
 * @param agentName    - Agent 名称（用于日志和结果标识）/ Agent name (for logging & result ID)
 * @param systemPrompt - Agent 的人格与边界 / Agent personality & boundaries
 * @param userMessage  - 发送给 Agent 的用户消息 / User message to send to agent
 * @param options      - 运行配置（provider, model）/ Run options (provider, model)
 *                       向后兼容：不传则默认 claude + sonnet
 *                       Backward compat: defaults to claude + sonnet if omitted
 */
export async function runAgent(
  agentName: string,
  systemPrompt: string,
  userMessage: string,
  options?: AgentRunOptions
): Promise<AgentResult> {
  const provider = options?.provider ?? DEFAULT_PROVIDER;
  const model = options?.model ?? DEFAULT_MODELS[provider] ?? '';
  const sessionId = randomUUID();
  const startMs = Date.now();

  logger.info('agent.start', {
    agentName,
    provider,
    model: model || '(default)',
    promptChars: userMessage.length,
    systemPromptChars: systemPrompt.length,
  });

  // ── 构建最终 prompt / Build final prompt ────────────────────
  // Claude CLI 支持 --system-prompt flag，其他 provider 需要前置拼接
  // Claude CLI supports --system-prompt flag; others need prompt prepend
  //
  // 但 cli-runner.ts 的 buildClaudeCommand 不支持透传 --system-prompt，
  // 所以所有 provider 统一用前置拼接策略（简单可靠）
  // However cli-runner.ts buildClaudeCommand doesn't pass --system-prompt,
  // so we use prepend strategy for all providers (simple & reliable)
  const fullPrompt = buildPromptWithSystem(systemPrompt, userMessage);

  // ── 临时覆盖环境变量中的模型 / Temporarily override model env var ──
  // cli-runner.ts 中 buildClaudeCommand 读取 CLAUDE_MODEL 环境变量
  // cli-runner.ts buildClaudeCommand reads CLAUDE_MODEL env var
  const envOverrides = buildModelEnvOverrides(provider, model);
  const savedEnv: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(envOverrides)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  try {
    // ── 调用 CLI subprocess / Call CLI subprocess ──────────────
    const output = await collectStreamOutput(
      provider,
      fullPrompt,
      sessionId,
      agentName,
    );

    const durationMs = Date.now() - startMs;

    logger.info('agent.done', {
      agentName,
      provider,
      durationMs,
      outputChars: output.length,
    });

    return {
      agentName,
      output,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);

    logger.error('agent.error', {
      agentName,
      provider,
      durationMs,
      error: truncateForLog(message, 500),
    }, err);

    throw new Error(`[${agentName}] CLI subprocess failed (${provider}): ${message}`);
  } finally {
    // ── 恢复环境变量 / Restore env vars ──────────────────────
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ── 内部函数 / Internal functions ────────────────────────────

/**
 * 将 system prompt 前置拼接到 user message
 * Prepend system prompt to user message
 *
 * 格式设计：用明确的 XML 分隔标记，让 AI 能区分系统指令和用户输入
 * Format: use clear XML delimiters so AI can distinguish system vs user input
 */
function buildPromptWithSystem(systemPrompt: string, userMessage: string): string {
  return [
    '<system>',
    systemPrompt,
    '</system>',
    '',
    userMessage,
  ].join('\n');
}

/**
 * 根据 provider 和 model 构建环境变量覆盖
 * Build env var overrides based on provider and model
 *
 * cli-runner.ts 通过环境变量控制模型选择：
 * cli-runner.ts uses env vars for model selection:
 *   - claude: CLAUDE_MODEL
 *   - codex:  CODEX_MODEL
 *   - gemini: GEMINI_MODEL
 */
function buildModelEnvOverrides(
  provider: string,
  model: string
): Record<string, string> {
  if (!model) return {};

  switch (provider) {
    case 'claude':
      return { CLAUDE_MODEL: model };
    case 'codex':
      return { CODEX_MODEL: model };
    case 'gemini':
      return { GEMINI_MODEL: model };
    default:
      return {};
  }
}

/**
 * 将 EventEmitter 流式输出收集为完整字符串
 * Collect EventEmitter streaming output into a complete string
 *
 * 这是 Pipeline 模式与 Chat 模式的关键区别：
 * This is the key difference between Pipeline and Chat mode:
 *   - Chat: 需要实时流式推送到浏览器（EventEmitter + SSE）
 *   - Chat: needs real-time streaming to browser (EventEmitter + SSE)
 *   - Pipeline: 只需要最终结果（Promise<string>）
 *   - Pipeline: only needs final result (Promise<string>)
 *
 * 复用 cli-runner.ts 的 runCliStreamWithRetry，包含：
 * Reuses cli-runner.ts's runCliStreamWithRetry, which includes:
 *   - 心跳超时检测 / Heartbeat timeout detection
 *   - 自动重试退避 / Auto-retry with backoff
 *   - 优雅进程清理 / Graceful process cleanup
 *   - stderr 滑动窗口 / stderr sliding window
 */
function collectStreamOutput(
  provider: 'claude' | 'codex' | 'gemini',
  prompt: string,
  sessionId: string,
  agentName: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    let hasError = false;
    let errorMessage = '';

    const emitter = runCliStreamWithRetry(
      provider,
      prompt,
      [],          // 空历史：Pipeline 模式每个 Agent 是独立的单轮调用
                   // Empty history: Pipeline agents are independent single-turn calls
      sessionId,
      { requestId: `agent-${agentName}-${sessionId.slice(0, 8)}` },
    );

    emitter.on('data', (event: StreamEvent) => {
      switch (event.type) {
        case 'text':
          if (event.content) {
            chunks.push(event.content);
          }
          break;

        case 'error':
          hasError = true;
          errorMessage = event.error ?? 'Unknown CLI error';
          // 不立即 reject：等 'end' 事件，因为可能还有重试
          // Don't reject immediately: wait for 'end', there might be retries
          break;

        case 'usage':
          // 记录 token 用量（未来可用于成本对比日志）
          // Log token usage (for future cost comparison logging)
          if (event.usage) {
            logger.info('agent.usage', {
              agentName,
              provider,
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cachedTokens: event.usage.cachedTokens ?? 0,
            });
          }
          break;

        // 'done' 和 'timing' 事件在 'end' 处理
        // 'done' and 'timing' handled at 'end'
      }
    });

    emitter.on('end', () => {
      const output = chunks.join('');

      // 如果有文本输出，即使有错误也算成功（部分成功）
      // If we have text output, consider it success even with errors (partial success)
      if (output.length > 0) {
        // 过滤掉重试通知消息（以 [Retrying... 开头的行）
        // Filter out retry notification messages (lines starting with [Retrying...)
        const cleanOutput = output
          .split('\n')
          .filter((line) => !line.trim().startsWith('[Retrying...'))
          .join('\n')
          .trim();
        resolve(cleanOutput);
        return;
      }

      // 没有文本输出 + 有错误 → 失败
      // No text output + has error → failure
      if (hasError) {
        reject(new Error(errorMessage));
        return;
      }

      // 没有文本输出也没有错误 → 空响应
      // No text and no error → empty response
      reject(new Error('CLI returned empty response (no text events received)'));
    });
  });
}
