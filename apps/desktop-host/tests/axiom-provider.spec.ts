/** Owned child IPC fixtures validate correlation, source projections, cancellation, and page serialization. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { AxiomIpcTransport, type AxiomIpcChannel } from '../src/axiom-provider.ts'

const snapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/original', title: 'Original', revision: 1,
  phase: 'ready', messages: [], canSend: true, draftPresent: false, siteStatus: null, limited: false }

afterEach(() => { vi.useRealTimers() })

function fixture(requestTimeoutMs = 1000) {
  const messages: object[] = []
  let receive: ((message: unknown) => void) | undefined
  let disconnected: (() => void) | undefined
  const channel: AxiomIpcChannel = {
    connected: () => true,
    send(message, done) { messages.push(message); done(null) },
    onMessage(listener) { receive = listener; return () => { receive = undefined } },
    onDisconnect(listener) { disconnected = listener; return () => { disconnected = undefined } },
  }
  const transport = new AxiomIpcTransport(channel, { requestTimeoutMs })
  onTestFinished(() => { transport.dispose() })
  return {
    transport, messages,
    reply(requestId: number, value: unknown) { receive?.({ type: 'axiom-response', requestId, ok: true, value }) },
    cancelled(requestId: number) { receive?.({ type: 'axiom-response', requestId, ok: false, error: { code: 'cancelled' } }) },
    disconnect() { disconnected?.() },
  }
}
function id(message: object): number { return (message as { requestId: number }).requestId }

it('correlates only the matching parent response and validates the bounded source projection', async () => {
  const source = fixture()
  const pending = source.transport.snapshot()
  expect(source.messages[0]).toMatchObject({ type: 'axiom-request', method: 'axiom/snapshot', args: {} })
  source.reply(id(source.messages[0]!) + 1, snapshot)
  source.reply(id(source.messages[0]!), snapshot)
  expect(await pending).toEqual(snapshot)
  const invalid = source.transport.snapshot()
  source.reply(id(source.messages[1]!), { ...snapshot, messages: [{ id: 'x', role: 'unknown', text: 'Not a recognized source role' }] })
  await expect(invalid).rejects.toThrow()
})

it('keeps the next page lease queued until cancellation is acknowledged by the native owner', async () => {
  const source = fixture()
  const release = await source.transport.acquire()
  const abort = new AbortController()
  const pending = source.transport.snapshot(abort.signal)
  abort.abort()
  await expect(pending).rejects.toThrow('Observation cancelled')
  expect(source.messages.at(-1)).toEqual({ type: 'axiom-cancel', requestId: id(source.messages[0]!) })
  release()
  let acquired = false
  const next = source.transport.acquire().then((unlock) => { acquired = true; return unlock })
  await Promise.resolve()
  await Promise.resolve()
  expect(acquired).toBe(false)
  source.cancelled(id(source.messages[0]!))
  const unlock = await next
  expect(acquired).toBe(true)
  unlock()
})

it('rejects pending work and future leases when the owned channel disconnects', async () => {
  const source = fixture()
  const pending = source.transport.snapshot()
  source.disconnect()
  await expect(pending).rejects.toThrow('bridge is unavailable')
  await expect(source.transport.acquire()).rejects.toThrow('bridge is unavailable')
  expect(source.messages.filter(message => 'method' in message)).toHaveLength(1)
})

it('bounds an unacknowledged request and prevents later mutations from overtaking it', async () => {
  vi.useFakeTimers()
  const source = fixture(10)
  const pending = source.transport.snapshot()
  const failed = expect(pending).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(11)
  await failed
  await expect(source.transport.acquire()).rejects.toThrow('bridge is unavailable')
  expect(source.messages.some(message => 'type' in message && message.type === 'axiom-cancel')).toBe(true)
})
