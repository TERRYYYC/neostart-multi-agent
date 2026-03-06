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
//   POST /api/pipeline      — 触发 Pipeline 流水线（SSE）/ Trigger agent pipeline (SSE)
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

// ── Pipeline SSE 事件类型 / Pipeline SSE event types ────────
// agent-start:  { type: 'agent-start', agent: 'Planner'|'Coder'|'Reviewer' }
// agent-text:   { type: 'agent-text', agent: string, content: string }
// agent-done:   { type: 'agent-done', agent: string, durationMs: number }
// agent-error:  { type: 'agent-error', agent: string, error: string }
// pipeline-done:{ type: 'pipeline-done', totalMs: number }

/** Pipeline 请求体 / Pipeline request body */
interface PipelineRequest {
  task?: string;
  plannerProvider?: string;
  plannerModel?: string;
  coderProvider?: string;
  coderModel?: string;
  reviewerProvider?: string;
  reviewerModel?: string;
}

/** Agent 定义（用于 Pipeline 流式执行）/ Agent definition for pipeline streaming */
interface PipelineAgent {
  name: string;
  emoji: string;
  providerKey: string;
  modelKey: string;
  defaultModel: string;
  buildSystemPrompt: () => string;
  buildUserMessage: (ctx: { task: string; plan?: string; code?: string }) => string;
}

// ── Agent 系统提示词（与 agents/*.ts 保持一致）
// Agent system prompts (kept in sync with agents/*.ts)
// 这里内联是为了避免 server.ts 依赖 agents/ 模块（保持解耦）
// Inlined here to avoid server.ts depending on agents/ module (stay decoupled)

const PIPELINE_AGENTS: PipelineAgent[] = [
  {
    name: 'Planner',
    emoji: '🧠',
    providerKey: 'plannerProvider',
    modelKey: 'plannerModel',
    defaultModel: 'opus',
    buildSystemPrompt: () => `You are a senior software architect on a 3-person coding team.

Your ONLY job is to analyze a coding task and produce a clear implementation plan.
Do NOT write any actual code. Plans only.

Output format (strictly follow this):
## Goal
One sentence describing what we're building.

## Implementation Steps
1. [Step] — [why this step]
2. ...

## Key Decisions
- [Any important technical choices or trade-offs]

Keep the plan concise (under 200 words). Be specific about file names, function names, and data shapes.`,
    buildUserMessage: (ctx) =>
      `Please create an implementation plan for the following task:\n\n${ctx.task}`,
  },
  {
    name: 'Coder',
    emoji: '💻',
    providerKey: 'coderProvider',
    modelKey: 'coderModel',
    defaultModel: 'sonnet',
    buildSystemPrompt: () => `You are a senior software engineer on a 3-person coding team.

You will receive:
1. The original task
2. An implementation plan from the architect

Your job is to implement the plan in TypeScript.

Rules:
- Write clean, well-commented TypeScript
- Use modern ES2022+ syntax
- Include all imports
- Do NOT explain the code outside of inline comments
- Output ONLY the code (use markdown code blocks with language tags)
- If multiple files are needed, separate them clearly with a comment header

Example output format:
\`\`\`typescript
// src/example.ts
// ... your code here
\`\`\``,
    buildUserMessage: (ctx) =>
      `## Original Task\n${ctx.task}\n\n## Implementation Plan\n${ctx.plan ?? ''}\n\nPlease implement this now.`,
  },
  {
    name: 'Reviewer',
    emoji: '🔍',
    providerKey: 'reviewerProvider',
    modelKey: 'reviewerModel',
    defaultModel: 'haiku',
    buildSystemPrompt: () => `You are a senior code reviewer on a 3-person coding team.

You will receive: the original task, the implementation plan, and the code to review.

Review the code on these dimensions:
1. Correctness — does it implement the plan correctly?
2. Type safety — proper TypeScript types, no implicit \`any\`?
3. Error handling — are edge cases handled?
4. Security — any obvious vulnerabilities?
5. Clarity — is it readable and well-commented?

Output format (strictly follow this):
## Review

### P1 — Blocking Issues (must fix)
- [issue] → [fix]

### P2 — Important Suggestions (strongly recommended)
- [issue] → [fix]

### P3 — Minor Improvements (optional)
- [issue] → [fix]

## Final Code
(Provide the corrected, final version of the code here. If no changes needed, repeat the original.)

Rules:
- Be objective, not performative. No "Great code!" comments.
- If there are no issues in a category, write "None."
- Always output the Final Code section, even if unchanged.`,
    buildUserMessage: (ctx) =>
      `## Original Task\n${ctx.task}\n\n## Implementation Plan\n${ctx.plan ?? ''}\n\n## Code to Review\n${ctx.code ?? ''}`,
  },
];

/**
 * 将 system prompt 前置拼接到 user message（与 core/agent.ts 一致）
 * Prepend system prompt to user message (same as core/agent.ts)
 */
function buildPromptWithSystem(systemPrompt: string, userMessage: string): string {
  return [
    '<system>',
    systemPrompt,
    '</system>',
    '',
    userMessage,
  ].join('\n');
}

/**
 * 运行单个 Pipeline Agent 并流式输出 SSE 事件
 * Run a single pipeline agent and stream SSE events
 *
 * @returns Agent 的完整输出文本 / Full output text from the agent
 */
function runPipelineAgentStream(
  res: ServerResponse,
  agent: PipelineAgent,
  prompt: string,
  provider: ModelProvider,
  model: string,
  pipelineLogger: ReturnType<typeof childLogger>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const sessionId = randomUUID();
    const startMs = Date.now();
    const chunks: string[] = [];
    let hasError = false;
    let errorMessage = '';

    // 发送 agent-start 事件 / Send agent-start event
    res.write(`data: ${JSON.stringify({
      type: 'agent-start',
      agent: agent.name,
      emoji: agent.emoji,
    })}\n\n`);

    pipelineLogger.info('pipeline.agent_start', {
      agent: agent.name,
      provider,
      model: model || '(default)',
    });

    // ── 临时覆盖环境变量中的模型（同 core/agent.ts 逻辑）
    // Temporarily override model env var (same as core/agent.ts)
    const envKey = provider === 'claude' ? 'CLAUDE_MODEL'
      : provider === 'codex' ? 'CODEX_MODEL'
      : 'GEMINI_MODEL';
    const savedEnv = process.env[envKey];
    if (model) {
      process.env[envKey] = model;
    }

    const emitter = runCliStreamWithRetry(
      provider,
      prompt,
      [],
      sessionId,
      { requestId: `pipeline-${agent.name}-${sessionId.slice(0, 8)}` },
    );

    emitter.on('data', (event: StreamEvent) => {
      switch (event.type) {
        case 'text':
          if (event.content) {
            chunks.push(event.content);
            // 实时推送文本给客户端 / Stream text to client in real-time
            res.write(`data: ${JSON.stringify({
              type: 'agent-text',
              agent: agent.name,
              content: event.content,
            })}\n\n`);
          }
          break;

        case 'error':
          hasError = true;
          errorMessage = event.error ?? 'Unknown CLI error';
          break;

        case 'usage':
          if (event.usage) {
            // 推送 token 用量 / Push token usage
            res.write(`data: ${JSON.stringify({
              type: 'agent-usage',
              agent: agent.name,
              usage: event.usage,
            })}\n\n`);
            pipelineLogger.info('pipeline.agent_usage', {
              agent: agent.name,
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
            });
          }
          break;
      }
    });

    emitter.on('end', () => {
      // ── 恢复环境变量 / Restore env var
      if (savedEnv === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = savedEnv;
      }

      const output = chunks.join('');
      const durationMs = Date.now() - startMs;

      if (output.length > 0) {
        // 过滤重试消息 / Filter retry messages
        const cleanOutput = output
          .split('\n')
          .filter((line) => !line.trim().startsWith('[Retrying...'))
          .join('\n')
          .trim();

        res.write(`data: ${JSON.stringify({
          type: 'agent-done',
          agent: agent.name,
          durationMs,
        })}\n\n`);

        pipelineLogger.info('pipeline.agent_done', {
          agent: agent.name,
          durationMs,
          outputChars: cleanOutput.length,
        });

        resolve(cleanOutput);
        return;
      }

      if (hasError) {
        res.write(`data: ${JSON.stringify({
          type: 'agent-error',
          agent: agent.name,
          error: errorMessage,
          durationMs,
        })}\n\n`);
        pipelineLogger.error('pipeline.agent_error', {
          agent: agent.name,
          error: truncateForLog(errorMessage, 400),
          durationMs,
        });
        reject(new Error(`[${agent.name}] ${errorMessage}`));
        return;
      }

      const emptyMsg = `[${agent.name}] CLI returned empty response`;
      res.write(`data: ${JSON.stringify({
        type: 'agent-error',
        agent: agent.name,
        error: emptyMsg,
        durationMs,
      })}\n\n`);
      reject(new Error(emptyMsg));
    });
  });
}

/**
 * POST /api/pipeline — 触发 Agent Pipeline，SSE 流式返回每个 Agent 的进度
 * Trigger Agent Pipeline, SSE stream each agent's progress
 *
 * Request body: { task: string, plannerProvider?: string, ... }
 * Response: SSE stream of pipeline events
 */
async function handlePipeline(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = randomUUID().slice(0, 8);
  const pipelineLogger = childLogger({ component: 'server', requestId, mode: 'pipeline' });
  const body = await readBody(req);
  let parsed: PipelineRequest;

  try {
    parsed = JSON.parse(body) as PipelineRequest;
  } catch {
    pipelineLogger.warn('pipeline.invalid_json', { bodyBytes: body.length });
    errorResponse(res, 400, 'Invalid JSON body / 无效的 JSON 请求体');
    return;
  }

  const task = parsed.task?.trim();
  if (!task) {
    pipelineLogger.warn('pipeline.invalid_task');
    errorResponse(res, 400, 'Task is required / 任务不能为空');
    return;
  }

  pipelineLogger.info('pipeline.started', { taskChars: task.length });

  // SSE 响应头 / SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`data: ${JSON.stringify({ type: 'pipeline-init', agents: ['Planner', 'Coder', 'Reviewer'] })}\n\n`);

  const validProviders: ModelProvider[] = ['claude', 'codex', 'gemini'];
  const pipelineStartMs = Date.now();

  // Pipeline 上下文（不可变追加）/ Pipeline context (immutable append)
  const ctx: { task: string; plan?: string; code?: string } = { task };

  let aborted = false;
  req.on('close', () => {
    aborted = true;
    pipelineLogger.debug('pipeline.client_disconnected');
  });

  try {
    // ── 顺序执行 3 个 Agent / Run 3 agents sequentially
    for (const agentDef of PIPELINE_AGENTS) {
      if (aborted) break;

      // 解析该 Agent 的 provider 和 model / Parse agent's provider and model
      const providerStr = (parsed as Record<string, string | undefined>)[agentDef.providerKey]?.trim();
      const modelStr = (parsed as Record<string, string | undefined>)[agentDef.modelKey]?.trim();

      const envProviderKey = `${agentDef.name.toUpperCase()}_PROVIDER`;
      const envModelKey = `${agentDef.name.toUpperCase()}_MODEL`;

      const provider: ModelProvider = (providerStr && validProviders.includes(providerStr as ModelProvider))
        ? (providerStr as ModelProvider)
        : (process.env[envProviderKey] as ModelProvider | undefined) ?? 'claude';
      const model = modelStr
        ?? process.env[envModelKey]
        ?? agentDef.defaultModel;

      // 构建 prompt / Build prompt
      const systemPrompt = agentDef.buildSystemPrompt();
      const userMessage = agentDef.buildUserMessage(ctx);
      const fullPrompt = buildPromptWithSystem(systemPrompt, userMessage);

      // 执行 agent 并流式输出 / Run agent with streaming output
      const output = await runPipelineAgentStream(
        res,
        agentDef,
        fullPrompt,
        provider,
        model,
        pipelineLogger,
      );

      // 填充上下文（不可变追加）/ Fill context (immutable append)
      if (agentDef.name === 'Planner') ctx.plan = output;
      if (agentDef.name === 'Coder') ctx.code = output;
    }

    // ── Pipeline 完成 / Pipeline complete
    const totalMs = Date.now() - pipelineStartMs;
    res.write(`data: ${JSON.stringify({ type: 'pipeline-done', totalMs })}\n\n`);
    pipelineLogger.info('pipeline.done', { totalMs });

  } catch (err) {
    const totalMs = Date.now() - pipelineStartMs;
    const message = err instanceof Error ? err.message : String(err);
    pipelineLogger.error('pipeline.failed', {
      error: truncateForLog(message, 400),
      totalMs,
    });
    // 错误已通过 agent-error SSE 事件发送，这里发 pipeline-done 标记结束
    // Error already sent via agent-error SSE event; send pipeline-done to signal end
    res.write(`data: ${JSON.stringify({
      type: 'pipeline-error',
      error: message,
      totalMs,
    })}\n\n`);
  } finally {
    res.end();
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

    // POST /api/pipeline — 触发 Agent Pipeline / Trigger agent pipeline
    if (method === 'POST' && path === '/api/pipeline') {
      await handlePipeline(req, res);
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
