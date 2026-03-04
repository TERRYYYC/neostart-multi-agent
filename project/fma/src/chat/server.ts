// ============================================================
// chat/server.ts — HTTP 服务器 + SSE 流式响应
// HTTP server + SSE streaming response
// ============================================================
//
// 零依赖：仅使用 Node.js 内置 http 模块
// Zero dependencies: uses only Node.js built-in http module
//
// API 路由：
// API Routes:
//   POST /api/chat          — 发送消息并流式返回 / Send message and stream response
//   GET  /api/conversations — 获取对话列表 / List conversations
//   GET  /                  — 静态页面 / Static page (index.html)
//
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCliStreamWithRetry } from './cli-runner.js';
import {
  createConversation,
  getConversation,
  addMessage,
  listConversations,
  deleteConversation,
} from './conversation.js';
import type { ModelProvider, StreamEvent } from './types.js';
import { childLogger, truncateForLog } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = childLogger({ component: 'server' });

// ── 请求体解析 / Request body parsing ──────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── JSON 响应工具 / JSON response helpers ──────────────────────

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function errorResponse(
  res: ServerResponse,
  status: number,
  message: string,
  extra: Record<string, string> = {}
): void {
  jsonResponse(res, status, { error: message, ...extra });
}

// ── CORS 预检 / CORS preflight ──────────────────────────────

function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }
  return false;
}

// ── 路由处理 / Route handlers ────────────────────────────────

/**
 * POST /api/chat — 发送消息，SSE 流式响应
 * Send a message, respond with SSE stream
 *
 * Request body: { message: string, conversationId?: string }
 * Response: SSE stream of StreamEvent objects
 */
async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = randomUUID().slice(0, 8);
  const reqLogger = childLogger({ component: 'server', requestId });
  const body = await readBody(req);
  let parsed: { message?: string; conversationId?: string; provider?: string };

  try {
    parsed = JSON.parse(body) as { message?: string; conversationId?: string; provider?: string };
  } catch {
    reqLogger.warn('chat.invalid_json', { bodyBytes: body.length });
    errorResponse(res, 400, 'Invalid JSON body / 无效的 JSON 请求体');
    return;
  }

  const message = parsed.message?.trim();
  if (!message) {
    reqLogger.warn('chat.invalid_message');
    errorResponse(res, 400, 'Message is required / 消息不能为空');
    return;
  }

  // 模型选择优先级：请求体 > 环境变量 > 默认 claude
  // Provider priority: request body > env var > default claude
  const validProviders: ModelProvider[] = ['claude', 'codex', 'gemini'];
  const requestProvider = parsed.provider?.trim() as ModelProvider | undefined;
  const provider: ModelProvider = (requestProvider && validProviders.includes(requestProvider))
    ? requestProvider
    : (process.env.MODEL_PROVIDER ?? 'claude') as ModelProvider;

  // 获取或创建对话 / Get or create conversation
  let conv = parsed.conversationId
    ? getConversation(parsed.conversationId)
    : undefined;

  if (!conv) {
    conv = createConversation(provider);
    reqLogger.info('chat.conversation_created', {
      conversationId: conv.id,
      provider: conv.modelProvider,
    });
  }

  // 已有对话使用其存储的 provider（保持一致性，需校验有效性）
  // Existing conversation uses its stored provider (consistency, with validation)
  const effectiveProvider: ModelProvider = validProviders.includes(conv.modelProvider as ModelProvider)
    ? (conv.modelProvider as ModelProvider)
    : provider;
  const chatLogger = childLogger({
    component: 'server',
    requestId,
    conversationId: conv.id,
    provider: effectiveProvider,
  });
  chatLogger.info('chat.request_started', {
    messageChars: message.length,
    historySize: conv.messages.length,
  });

  // 追加用户消息 / Append user message
  addMessage(conv.id, 'user', message);

  // SSE 响应头 / SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Conversation-Id': conv.id,
  });

  // 发送 conversationId 给客户端 / Send conversationId to client
  res.write(`data: ${JSON.stringify({ type: 'init', conversationId: conv.id })}\n\n`);

  // 启动 CLI 流 / Start CLI stream
  const history = conv.messages.slice(0, -1); // 不包含当前这条 / Exclude current message
  const startMs = Date.now(); // 服务端计时开始 / Server-side timing start
  const stream = runCliStreamWithRetry(effectiveProvider, message, history, conv.id, { requestId, conversationId: conv.id });

  let fullResponse = '';

  stream.on('data', (event: StreamEvent) => {
    if (event.type === 'text' && event.content) {
      fullResponse += event.content;
    }
    if (event.type === 'usage' && event.usage) {
      chatLogger.info('chat.usage', {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cachedTokens: event.usage.cachedTokens,
        totalTokens: event.usage.totalTokens,
      });
    }
    if (event.type === 'error') {
      chatLogger.warn('chat.stream_error_event', {
        error: truncateForLog(event.error ?? 'unknown error', 400),
      });
    }
    // done 事件前插入服务端计时 / Insert server-side timing before done event
    if (event.type === 'done') {
      const timing: StreamEvent = {
        type: 'timing',
        durationMs: Date.now() - startMs,
      };
      chatLogger.info('chat.stream_done', { durationMs: timing.durationMs });
      res.write(`data: ${JSON.stringify(timing)}\n\n`);
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  stream.on('end', () => {
    // 追加 assistant 完整响应 / Append full assistant response
    if (fullResponse) {
      addMessage(conv.id, 'assistant', fullResponse);
    }
    chatLogger.info('chat.request_finished', {
      durationMs: Date.now() - startMs,
      responseChars: fullResponse.length,
      persistedAssistantMessage: fullResponse.length > 0,
    });
    res.end();
  });

  req.on('close', () => {
    chatLogger.debug('chat.client_connection_closed');
  });
}

/**
 * GET /api/conversations — 获取对话列表
 * List all conversations
 */
function handleListConversations(_req: IncomingMessage, res: ServerResponse): void {
  const convs = listConversations().map((c) => ({
    id: c.id,
    messageCount: c.messages.length,
    lastMessage: c.messages.at(-1)?.content?.slice(0, 50) ?? '',
    createdAt: c.createdAt,
    modelProvider: c.modelProvider,
  }));
  jsonResponse(res, 200, convs);
}

/**
 * GET /api/conversations/:id — 获取对话详情
 * Get conversation detail
 */
function handleGetConversation(res: ServerResponse, id: string): void {
  const conv = getConversation(id);
  if (!conv) {
    errorResponse(res, 404, 'Conversation not found / 对话不存在');
    return;
  }
  jsonResponse(res, 200, conv);
}

/**
 * GET / — 返回静态 HTML 页面
 * Serve static HTML page
 */
async function handleStatic(res: ServerResponse): Promise<void> {
  try {
    const htmlPath = join(__dirname, '..', 'public', 'index.html');
    const html = await readFile(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    errorResponse(res, 500, 'Failed to load page / 页面加载失败');
  }
}

// ── 路由分发 / Router ───────────────────────────────────────

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (handleCors(req, res)) return;

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    // POST /api/chat
    if (method === 'POST' && path === '/api/chat') {
      await handleChat(req, res);
      return;
    }

    // GET /api/conversations
    if (method === 'GET' && path === '/api/conversations') {
      logger.debug('route.list_conversations');
      handleListConversations(req, res);
      return;
    }

    // GET /api/conversations/:id
    const convMatch = path.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
    if (method === 'GET' && convMatch?.[1]) {
      logger.debug('route.get_conversation', { conversationId: convMatch[1] });
      handleGetConversation(res, convMatch[1]);
      return;
    }

    // DELETE /api/conversations/:id — 删除对话 / Delete conversation
    if (method === 'DELETE' && convMatch?.[1]) {
      const deleted = deleteConversation(convMatch[1]);
      if (deleted) {
        logger.info('route.delete_conversation', { conversationId: convMatch[1] });
        jsonResponse(res, 200, { success: true });
      } else {
        logger.warn('route.delete_conversation_not_found', { conversationId: convMatch[1] });
        errorResponse(res, 404, 'Conversation not found / 对话不存在');
      }
      return;
    }

    // GET / — 静态页面 / Static page
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      await handleStatic(res);
      return;
    }

    // 404
    logger.warn('route.not_found', { method, path });
    errorResponse(res, 404, 'Not found');
  } catch (err) {
    const errorId = randomUUID().slice(0, 8);
    const message = err instanceof Error ? err.message : String(err);
    logger.error('route.unhandled_error', {
      errorId,
      method,
      path,
      message: truncateForLog(message, 400),
    }, err);
    errorResponse(res, 500, 'Internal server error / 服务器内部错误', { errorId });
  }
}

// ── 启动服务器 / Start server ────────────────────────────────

export function startServer(port = 3000): void {
  const server = createServer((req, res) => {
    router(req, res).catch((err) => {
      const errorId = randomUUID().slice(0, 8);
      logger.error('server.unhandled_router_error', { errorId }, err);
      if (!res.headersSent) {
        errorResponse(res, 500, 'Internal server error / 服务器内部错误', { errorId });
      }
    });
  });

  server.listen(port, () => {
    logger.info('server.started', {
      port,
      url: `http://localhost:${port}`,
      defaultProvider: process.env.MODEL_PROVIDER ?? 'claude',
      logLevel: process.env.LOG_LEVEL ?? 'info',
    });
  });
}
