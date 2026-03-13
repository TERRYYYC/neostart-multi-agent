/**
 * Thread API routes — §11 Thread APIs.
 * 线程 API 路由。
 *
 * POST /api/threads       — create thread
 * GET  /api/threads       — list threads
 * GET  /api/threads/:id   — get thread detail
 */

import { Router } from 'express';
import type { Thread } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';
import { threadStore } from '../persistence/index.js';

export const threadRouter = Router();

/** POST /api/threads — create a new thread. / 创建新线程。 */
threadRouter.post('/', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const thread: Thread = {
      id: generateId(),
      title: req.body.title ?? 'New Thread',
      workspacePath: req.body.workspacePath,
      // Phase 3: cats selected at thread creation / 创建时选择的猫
      ...(Array.isArray(req.body.selectedAgentIds) && req.body.selectedAgentIds.length > 0
        ? { selectedAgentIds: req.body.selectedAgentIds }
        : {}),
      createdAt: now,
      updatedAt: now,
      status: 'created',
    };
    const created = await threadStore.create(thread);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/threads — list all threads. / 列出所有线程。 */
threadRouter.get('/', async (_req, res) => {
  try {
    const threads = await threadStore.getAll();
    // Sort by updatedAt descending. / 按 updatedAt 降序排列。
    threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/threads/:id — get thread detail. / 获取线程详情。 */
threadRouter.get('/:id', async (req, res) => {
  try {
    const thread = await threadStore.getById(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(thread);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
