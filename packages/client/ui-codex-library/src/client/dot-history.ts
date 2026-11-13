/** Source windows are chronological; each original ID owns one updateable message. */
import type { DotMessage } from './desktop-axiom.ts'

/**
 * Merge an ordered source window without retaining duplicate IDs or imposing local timestamp order.
 * @param existing - Previously observed messages, oldest first.
 * @param incoming - Ordered source window or older history page.
 * @param placement - Disjoint older pages prepend; disjoint live windows append.
 * @returns The combined original-source chronology.
 */
export function mergeDotMessages(existing: readonly DotMessage[], incoming: readonly DotMessage[], placement: 'older' | 'live'): readonly DotMessage[] {
  const incomingIds = new Set(incoming.map(message => message.id))
  const prior = new Map(existing.map(message => [message.id, message]))
  const seen = new Set<string>()
  const window = incoming.filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  }).map(message => placement === 'older' ? prior.get(message.id) ?? message : message)
  if (window.length === 0) return existing
  const positions = new Map(existing.map((message, index) => [message.id, index]))
  const overlap = window.map(message => positions.get(message.id)).filter((index): index is number => index !== undefined)
  if (overlap.length === 0) return placement === 'older' ? [...window, ...existing] : [...existing, ...window]
  let previous = -1
  const ordered = overlap.every((index) => { const follows = index > previous; previous = index; return follows })
  if (ordered) {
    const merged: DotMessage[] = []
    let cursor = 0
    let pending: DotMessage[] = []
    for (const message of window) {
      const index = positions.get(message.id)
      if (index === undefined) { pending.push(message); continue }
      // Omitted bodies retain their positions between shared original-source anchors.
      merged.push(...existing.slice(cursor, index), ...pending, message)
      pending = []
      cursor = index + 1
    }
    merged.push(...existing.slice(cursor), ...pending)
    return merged
  }
  // A conflicting observed window repairs the shared anchors' order, keeping all other original IDs.
  const firstOverlap = existing.findIndex(message => incomingIds.has(message.id))
  const retained = existing.filter(message => !incomingIds.has(message.id))
  const insertAt = existing.slice(0, firstOverlap).filter(message => !incomingIds.has(message.id)).length
  return [...retained.slice(0, insertAt), ...window, ...retained.slice(insertAt)]
}
