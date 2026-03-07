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

    // If mentions found, trigger invocation for the first one.
    // v1: single-agent only.
    // 如果找到提及，为第一个触发调用。v1 仅支持单 agent。
    let invocationResult = null;
    if (mentions.length > 0) {
      const mention = mentions[0];
      const taskText = extractTaskText(content, mention);
      invocationResult = await executeInvocation({
        threadId,
        sourceMessageId: userMessage.id,
        mention,
        taskText,
      });
    }

    res.status(201).json({
      userMessage,
      invocation: invocationResult,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
