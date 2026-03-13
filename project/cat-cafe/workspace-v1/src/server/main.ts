/**
 * Server entry point.
 * 服务器入口。
 *
 * Bootstrap: seed profiles → load registry → start HTTP server.
 * 引导：填充档案 → 加载注册表 → 启动 HTTP 服务器。
 *
 * Usage: npx tsx src/server/main.ts
 */

import { createServer } from 'node:http';
import { app } from './app.js';
import { seedAgentProfiles, seedMemories } from './persistence/seed.js';
import { agentRegistry } from './registry/agent-registry.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

/**
 * Explicitly create and hold an http.Server reference.
 * 显式创建并持有 http.Server 引用。
 *
 * Express 5 的 app.listen() 可能不会正确保持事件循环活跃，
 * 所以改用 Node 原生 http.createServer() 来确保进程不退出。
 * Express 5's app.listen() may not keep the event loop alive correctly,
 * so we use Node's native http.createServer() to ensure the process stays running.
 */
const server = createServer(app);

async function bootstrap() {
  // 1. Seed agent profiles (idempotent). / 填充 agent 档案（幂等）。
  await seedAgentProfiles();
  console.log('[boot] Agent profiles seeded');

  // 1b. Seed sample memories (idempotent). / 填充示例记忆（幂等）。
  await seedMemories();
  console.log('[boot] Memories seeded');

  // 2. Load agent registry. / 加载 agent 注册表。
  await agentRegistry.load();
  const cats = agentRegistry.availableNames();
  console.log(`[boot] Registry loaded: ${cats.join(', ')}`);

  // 3. Start HTTP server. / 启动 HTTP 服务器。
  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[boot] Port ${PORT} is already in use. Kill the other process or use PORT=xxxx`);
        console.error(`[boot] 端口 ${PORT} 已被占用。请关闭其他进程或使用 PORT=xxxx`);
      } else {
        console.error('[boot] Server error:', err);
      }
      reject(err);
    });

    server.listen(PORT, () => {
      console.log(`[boot] cat-cafe v1 server running on http://localhost:${PORT}`);
      console.log(`[boot] Health: http://localhost:${PORT}/health`);
      resolve();
    });
  });
}

bootstrap().catch((err) => {
  console.error('[boot] Fatal error:', err);
  process.exit(1);
});
