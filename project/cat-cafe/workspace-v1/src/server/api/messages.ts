/**
 * Message API routes — §11 Message APIs.
 * 消息 API 路由。
 *
 * GET  /api/threads/:threadId/messages  — list public messages
 * POST /api/threads/:threadId/messages  — submit user message (+ trigger invocation)
 *
 * Per §11 guideline: message submission and invocation triggering may
 * be combined in v1.
 * 根据 §11 指南：v1 中消息提交和调用触发可以合并。
 */

import { Router } from 'express';
import type { Message } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { threadStore, messageStore } from '../persistence/index.js';
import { parseMentions } from '../registry/agent-registry.js';
import { executeInvocation, extractTaskText } from '../runtime/orchestrator.js';

export const messageRouter = Router({ mergeParams: true });

/**
 * GET /api/threads/:threadId/messages
 * List public messages for a thread. / 列出线程的公开消息。
 *
 * Only returns messages with visibility = 'public' or 'system-summary'.
 * Private messages are never exposed here.
 * 仅返回 visibility 为 'public' 或 'system-summary' 的消息。
 */
messageRouter.get('/', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const thread = await threadStore.getById(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const messages = await messageStore.findBy(
      (m) =>
        m.threadId === threadId &&
        (m.visibility === 'public' || m.visibility === 'system-summary'),
    );
    // Sort by createdAt ascending. / 按 createdAt 升序排列。
    messages.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/threads/:threadId/messages
 * Submit a user message. / 提交用户消息。
 *
 * If the message contains @mentions, automatically triggers invocation
 * for the first mention. Returns the user message and (if triggered)
 * the invocation result.
 * 如果消息包含 @mentions，自动为第一个提及触发调用。
 */
messageRouter.post('/', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const thread = await threadStore.getById(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const content: string = req.body.content ?? '';
    if (!content.trim()) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    // Extract mentions. / 提取提及。
    const mentions = parseMentions(content);

    // Step 1 (§7.1): Persist user message. / 持久化用户消息。
    const userMessage: Message = {
      id: generateId(),
      threadId,
      role: 'user',
      authorType: 'user',
      authorId: req.body.authorId ?? 'user-default',
      visibility: 'public',
      content,
      mentions,
      createdAt: new Date().toISOString(),
    };
    await messageStore.create(userMessage);

    // Update thread status + timestamp. / 更新线程状态和时间戳。
    await threadStore.update(threadId, {
      status: 'active',
      updatedAt: new Date().toISOString(),
    });

    // Phase 3 A2A Expansion: trigger invocations for ALL mentions sequentially.
    // Phase 3 A2A 扩展：为所有提及按顺序触发调用。
    //
    // Fire-and-forget — invocations run sequentially in background.
    // Each @mention triggers one invocation; they run one after another
    // to ensure orderly conversation flow and avoid race conditions.
    // 触发即忘 — 调用在后台按顺序运行。每个 @mention 触发一个调用。
    let invocationTriggered = false;
    const triggeredMentions: string[] = [];
    if (mentions.length > 0) {
      invocationTriggered = true;
      triggeredMentions.push(...mentions);

      // Sequential execution: each agent runs after the previous completes.
      // 顺序执行：每个 agent 在前一个完成后运行。
      (async () => {
        for (const mention of mentions) {
          const taskText = extractTaskText(content, mention);
          try {
            await executeInvocation({
              threadId,
              sourceMessageId: userMessage.id,
              mention,
              taskText,
            });
          } catch (err) {
            console.error('[messages] Background invocation error for @' + mention + ':', err);
            // Continue with next mention even if one fails. / 即使一个失败也继续下一个。
          }
        }
      })().catch((err) => {
        console.error('[messages] Sequential invocation chain error:', err);
      });
    }

    res.status(201).json({
      userMessage,
      invocationTriggered,
      triggeredMentions,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
