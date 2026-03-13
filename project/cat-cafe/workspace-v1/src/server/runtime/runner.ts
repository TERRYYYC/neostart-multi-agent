/**
 * Runner — interface for agent execution + StubRunner for Phase 1.
 * 执行器 — Agent 执行接口 + Phase 1 的 Stub 实现。
 *
 * The Runner interface is the seam where a real LLM provider (Anthropic,
 * OpenAI, etc.) plugs in during Phase 2. For Phase 1, StubRunner returns
 * deterministic text so the orchestrator can be tested without API keys.
 * Runner 接口是真实 LLM 提供商在 Phase 2 接入的接缝。
 * Phase 1 中 StubRunner 返回确定性文本以便无需 API 密钥即可测试。
 */

import type { AgentProfile } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Types / 类型
// ---------------------------------------------------------------------------

export interface RunnerResult {
  ok: boolean;
  /** Assembled visible text on success. / 成功时的组装可见文本。 */
  text?: string;
  /** Error code on failure. / 失败时的错误代码。 */
  errorCode?: string;
  /** Human-readable error message. / 人类可读的错误消息。 */
  errorMessage?: string;
}

export interface RunParams {
  invocationId: string;
  threadId: string;
  profile: AgentProfile;
  taskText: string;
  /** Current session ID — used to load predecessor context. / 当前 session ID，用于加载前任上下文。 */
  sessionId?: string;
  /**
   * Called for each streamed text chunk.
   * 每个流式文本块时调用。
   */
  onTextDelta: (chunk: string) => Promise<void>;
}

export interface Runner {
  run(params: RunParams): Promise<RunnerResult>;
}

// ---------------------------------------------------------------------------
// StubRunner / Stub 执行器
// ---------------------------------------------------------------------------

/**
 * Deterministic stub runner for Phase 1 testing.
 * Phase 1 测试用的确定性 stub 执行器。
 *
 * Simulates streaming by splitting the reply into chunks.
 * 通过将回复拆分成块来模拟流式传输。
 */
export class StubRunner implements Runner {
  private shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async run(params: RunParams): Promise<RunnerResult> {
    if (this.shouldFail) {
      return {
        ok: false,
        errorCode: 'stub_error',
        errorMessage: 'StubRunner configured to fail',
      };
    }

    const replyText =
      `[${params.profile.name}] I received your task: "${params.taskText}". ` +
      `This is a stub response from the ${params.profile.name} cat.`;

    // Simulate streaming in 3 chunks. / 模拟 3 个块的流式传输。
    const chunks = splitIntoChunks(replyText, 3);
    for (const chunk of chunks) {
      await params.onTextDelta(chunk);
    }

    return { ok: true, text: replyText };
  }
}

/** Split text into roughly equal chunks. / 将文本拆分为大致等长的块。 */
function splitIntoChunks(text: string, count: number): string[] {
  const chunkSize = Math.ceil(text.length / count);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Default runner instance for Phase 1. / Phase 1 默认执行器实例。 */
export const stubRunner = new StubRunner();
