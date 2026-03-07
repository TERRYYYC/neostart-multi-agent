/**
 * API route aggregator — mounts all routes.
 * API 路由聚合器 — 挂载所有路由。
 */

import { Router } from 'express';
import { threadRouter } from './threads.js';
import { messageRouter } from './messages.js';
import { runtimeRouter } from './runtime.js';

export const apiRouter = Router();

// Thread CRUD
apiRouter.use('/threads', threadRouter);

// Messages (nested under thread)
apiRouter.use('/threads/:threadId/messages', messageRouter);

// Runtime status + SSE stream (nested under thread)
apiRouter.use('/threads/:threadId', runtimeRouter);
