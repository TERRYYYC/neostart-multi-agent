/**
 * Agent registry — maps @cat mentions to AgentProfile.
 * Agent 注册表 — 将 @cat 提及映射到 AgentProfile。
 *
 * Design:
 *   - Loads enabled profiles from the persistence layer.
 *   - Builds a case-insensitive alias map (name → profile).
 *   - Resolution is pure lookup — no runtime execution logic here.
 *   - 从持久化层加载已启用的档案。
 *   - 构建大小写不敏感的别名映射（name → profile）。
 *   - 解析是纯查找 — 此处无运行时执行逻辑。
 */

import type { AgentProfile } from '../../shared/types.js';
import { agentProfileStore } from '../persistence/index.js';

// ---------------------------------------------------------------------------
// Types / 类型
// ---------------------------------------------------------------------------

/** Result of a mention resolution attempt. / 提及解析结果。 */
export type ResolutionResult =
  | { ok: true; profile: AgentProfile }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Registry class / 注册表类
// ---------------------------------------------------------------------------

export class AgentRegistry {
  /** lowercase name → AgentProfile */
  private aliasMap: Map<string, AgentProfile> = new Map();
  private loaded = false;

  /**
   * Load (or reload) enabled profiles from the store.
   * 从存储加载（或重新加载）已启用的档案。
   */
  async load(): Promise<void> {
    const profiles = await agentProfileStore.getAll();
    this.aliasMap.clear();
    for (const p of profiles) {
      if (p.enabled) {
        this.aliasMap.set(p.name.toLowerCase(), p);
      }
    }
    this.loaded = true;
  }

  /**
   * Resolve a mention string (e.g. "maine", "Maine") to an AgentProfile.
   * 将提及字符串解析为 AgentProfile。
   *
   * Does NOT include the "@" prefix — caller strips it first.
   * 不包含 "@" 前缀 — 调用者先去除。
   */
  async resolve(mention: string): Promise<ResolutionResult> {
    if (!this.loaded) await this.load();

    const key = mention.trim().toLowerCase();
    if (!key) {
      return { ok: false, reason: 'Empty mention' };
    }

    const profile = this.aliasMap.get(key);
    if (!profile) {
      return {
        ok: false,
        reason: `Unknown agent: @${mention}. Available: ${this.availableNames().join(', ')}`,
      };
    }

    return { ok: true, profile };
  }

  /**
   * List all available (enabled) agent names.
   * 列出所有可用（已启用）的 agent 名称。
   */
  availableNames(): string[] {
    return [...this.aliasMap.values()].map((p) => p.name);
  }

  /**
   * Get all enabled profiles.
   * 获取所有已启用的档案。
   */
  allProfiles(): AgentProfile[] {
    return [...this.aliasMap.values()];
  }
}

// ---------------------------------------------------------------------------
// Mention parsing utility / 提及解析工具
// ---------------------------------------------------------------------------

/** Regex to extract @mentions from message content. */
const MENTION_REGEX = /@(\w+)/g;

/**
 * Extract all @mentions from a message string.
 * 从消息字符串中提取所有 @mention。
 *
 * Returns lowercase mention names without the "@" prefix.
 * 返回不含 "@" 前缀的小写提及名称。
 */
export function parseMentions(content: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    matches.push(match[1].toLowerCase());
  }
  // deduplicate / 去重
  return [...new Set(matches)];
}

// ---------------------------------------------------------------------------
// Singleton / 单例
// ---------------------------------------------------------------------------

/**
 * Default registry instance. / 默认注册表实例。
 * Call `agentRegistry.load()` once at server startup after seeding.
 * 服务器启动 seed 后调用一次 `agentRegistry.load()`。
 */
export const agentRegistry = new AgentRegistry();
