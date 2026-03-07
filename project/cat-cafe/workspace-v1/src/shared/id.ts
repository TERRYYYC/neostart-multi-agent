/**
 * ID generation utility.
 * ID 生成工具。
 *
 * Uses nanoid for lightweight, URL-safe, unique identifiers.
 * 使用 nanoid 生成轻量、URL 安全的唯一标识符。
 */

import { nanoid } from 'nanoid';

/** Default ID length (21 chars ≈ 126 bits of entropy). */
const DEFAULT_LENGTH = 21;

/**
 * Generate a unique ID suitable for any domain entity.
 * 生成适用于任何领域实体的唯一 ID。
 */
export function generateId(length: number = DEFAULT_LENGTH): string {
  return nanoid(length);
}
