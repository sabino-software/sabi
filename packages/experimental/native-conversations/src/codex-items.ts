/** Render only observed native operations, without turning them into executable Harness calls. */
import type { NativeCodexActivity } from './codex-activity-types.ts'

const OPERATIONS = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'plan', 'imageGeneration', 'contextCompaction'])
function body(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length <= 32768 ? text : `${text.slice(0, 32768)}\n\n[Original operation detail truncated]`
}
/**
 * Convert a lifecycle item to inert activity; Harness MCP operations own their ordinary tool cards.
 * @param item - Observed original Codex lifecycle item.
 * @param turnId - Original turn containing the item.
 * @param phase - Observed item lifecycle phase, without asserting operation success.
 * @returns Inert source activity, or null for unsupported items and Harness-owned MCP calls.
 */
export function codexItemActivity(item: Readonly<Record<string, unknown>>, turnId: string, phase: 'started' | 'completed'): NativeCodexActivity | null {
  if (typeof item.type !== 'string' || typeof item.id !== 'string' || !OPERATIONS.has(item.type)) return null
  if (item.type === 'mcpToolCall' && item.server === 'skeinlet') return null
  const label = item.type === 'commandExecution' && typeof item.command === 'string' ? item.command
    : item.type === 'mcpToolCall' && typeof item.server === 'string' && typeof item.tool === 'string' ? `${item.server} · ${item.tool}`
      : item.type === 'plan' ? 'Codex plan' : `Codex ${item.type}`
  const detail = item.type === 'commandExecution' ? body({ output: item.aggregatedOutput ?? null, exitCode: item.exitCode ?? null, status: item.status ?? null })
    : item.type === 'fileChange' ? body({ changes: item.changes ?? [], status: item.status ?? null })
      : item.type === 'plan' ? body(item.text)
        : body(item.result ?? item.error ?? item.action ?? item.status ?? null)
  return { id: `${turnId}:${item.id}`, type: item.type, phase, label: label.slice(0, 300), detail }
}
