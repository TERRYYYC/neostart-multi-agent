/**
 * Orchestrator — the 7-step invocation lifecycle coordinator.
 * 编排器 — 7 步调用生命周期协调器。
 *
 * Implements §7.1 Steps 2–7 (Step 1 is the caller's responsibility).
 * 实现 §7.1 步骤 2–7（步骤 1 由调用者负责）。
 *
 * Architecture rule: an AgentInvocation record MUST exist before any
 * agent output appears.
 * 架构规则：在任何 agent 输出出现之前，AgentInvocation 记录必须存在。
 */

import type {
  AgentInvocation,
  Message,
  Visibility,
} from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { messageStore, invocationStore } from '../persistence/index.js';
import { agentRegistry } from '../registry/agent-registry.js';
import { emitEvent } from './event-emitter.js';
import { findOrCreateSession } from './session-manager.js';
import { stubRunner } from './runner.js';
import type { Runner } from './runner.js';
import { routeToRunner } from './provider-router.js';
import { shouldSealSession, executeHandoff } from './session-chain.js';
import { parseMemoryMarkers, stripMemoryMarkers, createMemoriesFromExtraction } from './memory-loader.js';

// ---------------------------------------------------------------------------
// Types / 类型
// ---------------------------------------------------------------------------

export interface ExecuteParams {
  threadId: string;
  sourceMessageId: string;
  /** Mention without "@" prefix, e.g. "maine". / 不含 "@" 前缀的提及。 */
  mention: string;
  /** Task body after the @mention. / @mention 后的任务正文。 */
  taskText: string;
  /** Injectable runner; defaults to StubRunner. / 可注入的执行器。 */
  runner?: Runner;
}

export type InvocationResult =
  | { ok: true; invocation: AgentInvocation; replyMessage: Message }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Main entry point / 主入口
// ---------------------------------------------------------------------------

/**
 * Execute the full invocation lifecycle for one @cat mention.
 * 为一个 @cat 提及执行完整的调用生命周期。
 *
 * Steps 2–7 of §7.1:
 *   2. resolve target agent
 *   3. find or create session
 *   4. create invocation (queued)
 *   5. run (running + emit events)
 *   6. assemble visible output
 *   7. close invocation (completed / failed)
 */
export async function executeInvocation(
  params: ExecuteParams,
): Promise<InvocationResult> {
  const { threadId, sourceMessageId, mention, taskText } = params;
  const now = () => new Date().toISOString();

  // ------------------------------------------------------------------
  // Step 2: Resolve target agent / 解析目标 agent
  // ------------------------------------------------------------------
  const resolution = await agentRegistry.resolve(mention);
  if (!resolution.ok) {
    return { ok: false, reason: resolution.reason };
  }
  const profile = resolution.profile;

  // Phase 3: route to correct runner based on provider; stub override still works.
  // Phase 3：根据 provider 路由到正确的执行器；stub 覆盖仍然有效。
  const runner = params.runner ?? (process.env.CLI_RUNNER === 'stub' ? stubRunner : routeToRunner(profile));

  // ------------------------------------------------------------------
  // Step 4: Create invocation (queued) / 创建调用（排队）
  // We create invocation BEFORE session so the invocationId is available
  // for session event emission.
  // 我们在会话之前创建调用，以便 invocationId 可用于会话事件发射。
  // ------------------------------------------------------------------
  const invocationId = generateId();
  const invocation: AgentInvocation = {
    id: invocationId,
    threadId,
    sourceMessageId,
    targetAgentId: profile.id,
    sessionId: '', // will be filled after session selection
    state: 'queued',
    visibility: 'private' as Visibility,
    startedAt: now(),
  };
  await invocationStore.create(invocation);

  await emitEvent({
    threadId,
    invocationId,
    eventType: 'invocation.created',
    payload: { targetAgentId: profile.id, mention },
  });

  // ------------------------------------------------------------------
  // Step 3: Find or create session / 查找或创建会话
  // ------------------------------------------------------------------
  let session = await findOrCreateSession(threadId, profile.id, invocationId);

  // Bind session to invocation. / 将会话绑定到调用。
  await invocationStore.update(invocationId, { sessionId: session.id });

  // ------------------------------------------------------------------
  // Step 3.5: Session handoff check / 会话交接检查
  // If the current session exceeds thresholds, seal it and create
  // a new continuation session before running the invocation.
  // 如果当前 session 超过阈值，封存并创建新延续 session。
  // ------------------------------------------------------------------
  const sealCheck = await shouldSealSession(threadId, profile.id, session);
  if (sealCheck.seal) {
    const { newSession } = await executeHandoff(
      threadId,
      profile.id,
      session,
      invocationId,
      profile,
      sealCheck.reason,
    );
    session = newSession;
    // Re-bind invocation to the new session. / 将调用重新绑定到新 session。
    await invocationStore.update(invocationId, { sessionId: session.id });
  }

  // ------------------------------------------------------------------
  // Step 5: Run (transition to running) / 运行（转为运行中）
  // ------------------------------------------------------------------
  await invocationStore.update(invocationId, { state: 'running' });

  await emitEvent({
    threadId,
    invocationId,
    sessionId: session.id,
    eventType: 'invocation.started',
    payload: { agentName: profile.name, model: profile.model },
  });

  const textChunks: string[] = [];

  const result = await runner.run({
    invocationId,
    threadId,
    profile,
    taskText,
    sessionId: session.id,
    onTextDelta: async (chunk: string) => {
      textChunks.push(chunk);
      await emitEvent({
        threadId,
        invocationId,
        sessionId: session.id,
        eventType: 'invocation.text.delta',
        payload: { chunk },
      });
    },
  });

  // ------------------------------------------------------------------
  // Step 6 & 7: Assemble output + close invocation
  // 步骤 6 & 7：组装输出 + 关闭调用
  // ------------------------------------------------------------------

  if (result.ok && result.text) {
    // Success path / 成功路径

    // Phase 4: Extract memories from agent output and strip markers.
    // Phase 4：从 agent 输出中提取记忆并去除标记。
    const extractedMarkers = parseMemoryMarkers(result.text);
    const cleanText = extractedMarkers.length > 0
      ? stripMemoryMarkers(result.text)
      : result.text;

    if (extractedMarkers.length > 0) {
      const created = await createMemoriesFromExtraction(extractedMarkers);
      console.log(
        `[orchestrator] Auto-extracted ${created.length} memories from agent output ` +
        `(keys: ${created.map((m) => m.key).join(', ')})`,
      );
      // Emit memory.extracted event for each created memory.
      // 为每个创建的记忆发射 memory.extracted 事件。
      for (const mem of created) {
        await emitEvent({
          threadId,
          invocationId,
          sessionId: session.id,
          eventType: 'memory.extracted',
          payload: { memoryId: mem.id, key: mem.key, value: mem.value, category: mem.category },
        });
      }
    }

    const replyMessage: Message = {
      id: generateId(),
      threadId,
      role: 'assistant',
      authorType: 'agent',
      authorId: profile.id,
      visibility: 'public',
      content: cleanText,
      mentions: [],
      sourceInvocationId: invocationId,
      createdAt: now(),
    };
    await messageStore.create(replyMessage);

    const closedInvocation = await invocationStore.update(invocationId, {
      state: 'completed',
      finishedAt: now(),
    });

    await emitEvent({
      threadId,
      invocationId,
      sessionId: session.id,
      eventType: 'invocation.completed',
      payload: { replyMessageId: replyMessage.id },
    });

    return { ok: true, invocation: closedInvocation, replyMessage };
  } else {
    // Failure path / 失败路径
    const closedInvocation = await invocationStore.update(invocationId, {
      state: 'failed',
      finishedAt: now(),
      errorCode: result.errorCode ?? 'unknown_error',
    });

    await emitEvent({
      threadId,
      invocationId,
      sessionId: session.id,
      eventType: 'invocation.failed',
      payload: {
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    });

    return {
      ok: false,
      reason: result.errorMessage ?? 'Runner execution failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Utility / 工具函数
// ---------------------------------------------------------------------------

/**
 * Extract task text from a message, stripping the @mention.
 * 从消息中提取任务文本，去除 @mention。
 *
 * Example: "@maine please review this" → "please review this"
 */
export function extractTaskText(content: string, mention: string): string {
  // Remove the first occurrence of @mention (case-insensitive).
  const regex = new RegExp(`@${mention}\\s*`, 'i');
  return content.replace(regex, '').trim();
}
