/**
 * Runtime API routes — §11 Runtime APIs.
 * 运行时 API 路由。
 *
 * GET /api/threads/:threadId/runtime  — current invocation snapshot
 * GET /api/threads/:threadId/stream   — SSE event stream
 */

import { Router } from 'express';
import { invocationStore } from '../persistence/index.js';
import { sseHandler } from '../streaming/sse-handler.js';

export const runtimeRouter = Router({ mergeParams: true });

/**
 * GET /api/threads/:threadId/runtime
 * Return the most recent invocation for this thread.
 * 返回此线程最近的调用。
 */
runtimeRouter.get('/runtime', async (req, res) => {
  try {
    const threadId = (req.params as Record<string, string>)['threadId'];
    const invocations = await invocationStore.findBy(
      (i) => i.threadId === threadId,
    );

    if (invocations.length === 0) {
      res.json({ current: null });
      return;
    }

    // Sort by startedAt descending, return most recent.
    // 按 startedAt 降序排列，返回最近的。
    invocations.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    res.json({ current: invocations[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /api/threads/:threadId/stream
 * SSE endpoint — delegates to sse-handler with visibility filtering.
 * SSE 端点 — 委托给带有可见性过滤的 sse-handler。
 */
runtimeRouter.get('/stream', sseHandler);
