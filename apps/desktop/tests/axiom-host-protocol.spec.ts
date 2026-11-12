/** Owned child IPC exposes only bounded original-page operations. */
import { describe, expect, it } from 'vitest'
import { axiomHostCancelSchema, axiomHostRequestSchema } from '../src/axiom-host-protocol.ts'

describe('original-page Host IPC', () => {
  it('keeps child correlation separate from exact user submission identity', () => {
    expect(axiomHostRequestSchema.parse({ type: 'axiom-request', requestId: 1, method: 'axiom/send',
      args: { request: { requestId: 'user-submit-1', revision: 2, text: 'exact\nmessage' } } })).toMatchObject({
      requestId: 1, args: { request: { requestId: 'user-submit-1', text: 'exact\nmessage' } },
    })
    expect(axiomHostCancelSchema.parse({ type: 'axiom-cancel', requestId: 1 }).requestId).toBe(1)
  })

  it('rejects unbounded text, invalid correlation and general page execution or credential requests', () => {
    for (const value of [
      { type: 'axiom-request', requestId: 0, method: 'axiom/snapshot', args: {} },
      { type: 'axiom-request', requestId: 1, method: 'axiom/evaluate', args: { code: 'document.cookie' } },
      { type: 'axiom-request', requestId: 1, method: 'axiom/snapshot', args: { cookies: true } },
      { type: 'axiom-request', requestId: 1, method: 'axiom/send', args: { request: { requestId: 'user-submit-1', revision: 2, text: 'x'.repeat(131073) } } },
    ]) expect(axiomHostRequestSchema.safeParse(value).success).toBe(false)
  })
})
