// ============================================================
// chat/index.ts — 聊天模式入口
// Chat mode entry point
// ============================================================
//
// 启动 Web 聊天服务器
// Starts the web chat server
//
// 用法 / Usage:
//   npm run chat
//   PORT=8080 npm run chat
//   MODEL_PROVIDER=gemini npm run chat
//
// ============================================================

import { startServer } from './server.js';

const port = parseInt(process.env.PORT ?? '3000', 10);
startServer(port);
