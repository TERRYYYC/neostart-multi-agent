/**
 * Express app setup.
 * Express 应用配置。
 */

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Mount API routes under /api
app.use('/api', apiRouter);

// Serve frontend static files (src/client/index.html).
// 提供前端静态文件。
app.use(express.static(join(__dirname, '..', 'client')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', project: 'cat-cafe-v1' });
});
