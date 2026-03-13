/**
 * Provider Router — maps AgentProfile.provider to the correct Runner.
 * 提供商路由器 — 将 AgentProfile.provider 映射到正确的 Runner。
 *
 * This replaces the hardcoded cliRunner selection in orchestrator.ts.
 * 这取代了 orchestrator.ts 中硬编码的 cliRunner 选择。
 *
 * Supported providers:
 *   - anthropic → CliRunner (claude CLI subprocess)
 *   - openai → OpenAiRunner (OpenAI API SDK)
 *   - google → GeminiRunner (Google Generative AI SDK)
 */

import type { AgentProfile } from '../../shared/types.js';
import type { Runner } from './runner.js';
import { cliRunner } from './cli-runner.js';
import { openaiRunner } from './openai-runner.js';
import { geminiRunner } from './gemini-runner.js';

/** Known provider identifiers. / 已知提供商标识符。 */
export const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

/** Model prefix hints per provider (for soft validation). / 每个提供商的模型前缀提示。 */
export const PROVIDER_MODEL_PREFIXES: Record<KnownProvider, string[]> = {
  anthropic: ['claude-'],
  openai: ['gpt-', 'o1-', 'o3-', 'o4-'],
  google: ['gemini-'],
};

/** Suggested models per provider (for UI hints). / 每个提供商的建议模型。 */
export const PROVIDER_MODEL_SUGGESTIONS: Record<KnownProvider, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  google: ['gemini-2.0-flash', 'gemini-2.5-pro'],
};

/**
 * Route a profile to the correct Runner instance based on its provider.
 * 根据提供商将 Agent 档案路由到正确的 Runner 实例。
 *
 * @throws Error if provider is not recognized (should not happen if
 *         validation in agents.ts is enforced).
 */
export function routeToRunner(profile: AgentProfile): Runner {
  switch (profile.provider) {
    case 'anthropic':
      return cliRunner;
    case 'openai':
      return openaiRunner;
    case 'google':
      return geminiRunner;
    default:
      // Should never reach here if backend validation is working.
      // 如果后端验证正常工作，不应到达这里。
      console.error(
        `[provider-router] Unknown provider "${profile.provider}" for agent "${profile.name}", ` +
        `falling back to claude CLI`,
      );
      return cliRunner;
  }
}

/**
 * Check if a provider string is a known provider.
 * 检查提供商字符串是否为已知提供商。
 */
export function isKnownProvider(provider: string): provider is KnownProvider {
  return (KNOWN_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Validate model name against expected prefixes for a provider (soft check).
 * 验证模型名称是否符合提供商的预期前缀（软检查）。
 *
 * Returns a warning string if mismatch, null if ok.
 * 如果不匹配返回警告字符串，否则返回 null。
 */
export function validateModelForProvider(
  provider: string,
  model: string,
): string | null {
  if (!isKnownProvider(provider)) return null;
  const prefixes = PROVIDER_MODEL_PREFIXES[provider];
  const matches = prefixes.some((prefix) => model.startsWith(prefix));
  if (!matches) {
    return (
      `Model "${model}" does not match expected prefixes for provider "${provider}" ` +
      `(expected: ${prefixes.join(', ')}). This may work but is unusual. / ` +
      `模型 "${model}" 不符合提供商 "${provider}" 的预期前缀。`
    );
  }
  return null;
}
