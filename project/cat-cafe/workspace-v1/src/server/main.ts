/**
 * Server entry point.
 * 服务器入口。
 *
 * Bootstrap: seed profiles → load registry → start HTTP server.
 * 引导：填充档案 → 加载注册表 → 启动 HTTP 服务器。
 *
 * Usage: npx tsx src/server/main.ts
 */

import { app } from './app.js';
import { seedAgentProfiles } from './persistence/seed.js';
import { agentRegistry } from './registry/agent-registry.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

async function bootstrap() {
  // 1. Seed agent profiles (idempotent). / 填充 agent 档案（幂等）。
  await seedAgentProfiles();
  console.log('[boot] Agent profiles seeded');

  // 2. Load agent registry. / 加载 agent 注册表。
  await agentRegistry.load();
  const cats = agentRegistry.availableNames();
  console.log(`[boot] Registry loaded: ${cats.join(', ')}`);

  // 3. Start HTTP server. / 启动 HTTP 服务器。
  app.listen(PORT, () => {
    console.log(`[boot] cat-cafe v1 server running on http://localhost:${PORT}`);
    console.log(`[boot] Health: http://localhost:${PORT}/health`);
  });
}

bootstrap().catch((err) => {
  console.error('[boot] Fatal error:', err);
  process.exit(1);
});
