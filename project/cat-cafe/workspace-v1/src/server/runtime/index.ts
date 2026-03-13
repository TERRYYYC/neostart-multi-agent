/**
 * Runtime module barrel export.
 * 运行时模块统一导出。
 */

export { emitEvent } from './event-emitter.js';
export type { EmitEventParams } from './event-emitter.js';

export { findOrCreateSession } from './session-manager.js';

export { stubRunner, StubRunner } from './runner.js';
export type { Runner, RunnerResult, RunParams } from './runner.js';

export { cliRunner, CliRunner, getActiveChildrenCount } from './cli-runner.js';

export { openaiRunner, OpenAiRunner } from './openai-runner.js';

export { geminiRunner, GeminiRunner } from './gemini-runner.js';

export { routeToRunner, KNOWN_PROVIDERS, PROVIDER_MODEL_SUGGESTIONS, isKnownProvider, validateModelForProvider } from './provider-router.js';
export type { KnownProvider } from './provider-router.js';

export { executeInvocation, extractTaskText } from './orchestrator.js';
export type { ExecuteParams, InvocationResult } from './orchestrator.js';

export {
  shouldSealSession,
  sealSession,
  generateContextSummary,
  executeHandoff,
  getSessionChain,
  getPredecessorSummary,
  SESSION_CHAIN_CONFIG,
} from './session-chain.js';
export type { SealCheck, HandoffResult } from './session-chain.js';

export {
  scoreMemory, findRelevantMemories, formatMemoriesForPrompt,
  parseMemoryMarkers, stripMemoryMarkers, createMemoriesFromExtraction,
} from './memory-loader.js';
export type { MemoryContext, ExtractedMemory } from './memory-loader.js';
