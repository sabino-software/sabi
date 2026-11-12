/** The packaged service worker admits only fixed commands to its toolbar-selected main document. */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

const url = 'https://chatgpt.com/dots/controlled~fixture'
const pairId = 'a'.repeat(32)
interface NativeMessage { type: string; id?: number; method?: string; pairId?: string; args?: object; value?: unknown }

async function background(autoPair = true) {
  let action: ((tab: { id: number; url: string }) => Promise<void>) | undefined
  let receive: ((message: object) => void) | undefined
  let disconnected: (() => void) | undefined
  const disconnect = vi.fn()
  const posted: NativeMessage[] = []
  const page = { source: 'chatgpt-web', url, phase: 'ready' }
  const tabs = { get: vi.fn(async () => ({ url, windowId: 7 })), update: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => page) }
  const scripting = { executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'selected-document', result: url }]) }
  const windows = { update: vi.fn(async () => ({})) }
  const chrome = {
    action: { onClicked: { addListener: (listener: typeof action) => { action = listener } },
      setBadgeText: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) },
    scripting, tabs, windows,
    runtime: { connectNative: vi.fn(() => ({ disconnect, postMessage: (message: NativeMessage) => { posted.push(message) },
      onMessage: { addListener: (listener: typeof receive) => { receive = listener } },
      onDisconnect: { addListener: (listener: () => void) => { disconnected = listener } } })) },
  }
  const code = await readFile(new URL('../browser-extension/background.js', import.meta.url), 'utf8')
  runInNewContext(code, { chrome, URL })
  await action?.({ id: 42, url })
  if (autoPair) receive?.({ type: 'paired', version: 1, pairId, url })
  return { tabs, scripting, windows, chrome, disconnect, posted,
    click: (tab: { id: number; url: string }) => action?.(tab), revoke: () => { disconnected?.() },
    receive: (value: object) => { receive?.(value) } }
}

it('pins toolbar-selected tab/document/Dot and never accepts arbitrary native execution', async () => {
  const h = await background()
  expect(h.posted[0]).toEqual({ type: 'pair', version: 1, tabId: 42, documentId: 'selected-document', url })
  expect(h.scripting.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 42, documentIds: ['selected-document'] }, world: 'ISOLATED', files: ['content.js'] })
  h.receive({ type: 'request', id: 1, pairId, method: 'snapshot', args: {} })
  await expect.poll(() => h.posted.length).toBe(2)
  expect(h.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'skeinlet-command', method: 'snapshot', url, args: {} }, { documentId: 'selected-document' })
  expect(h.posted[1]).toMatchObject({ type: 'response', id: 1, pairId, ok: true })
  h.receive({ type: 'request', id: 2, pairId, method: 'evaluate', args: { code: 'document.cookie' } })
  expect(h.disconnect).toHaveBeenCalledOnce()
  expect(h.tabs.sendMessage).toHaveBeenCalledTimes(1)
})

it('refuses source access and focus after the bound tab leaves the exact selected Dot', async () => {
  const h = await background()
  h.tabs.get.mockResolvedValue({ url: 'https://accounts.google.com/signin?private=not-exported', windowId: 7 })
  h.receive({ type: 'request', id: 1, pairId, method: 'snapshot', args: {} })
  await expect.poll(() => h.posted.length).toBe(2)
  expect(h.posted[1]).toMatchObject({ value: { url, phase: 'login-required', messages: [], canSend: false } })
  expect(JSON.stringify(h.posted)).not.toContain('private=')
  expect(h.tabs.sendMessage).not.toHaveBeenCalled()
  h.receive({ type: 'request', id: 2, pairId, method: 'show', args: {} })
  await expect.poll(() => h.posted.length).toBe(3)
  expect(h.tabs.update).not.toHaveBeenCalled()
  expect(h.windows.update).not.toHaveBeenCalled()
  expect(h.posted[2]).toEqual({ type: 'response', id: 2, pairId, ok: false, code: 'unavailable' })
})

it('reports a lost document as an uncertain send and never retries it or selects another document', async () => {
  const h = await background()
  h.tabs.sendMessage.mockRejectedValue(new Error('Document was replaced'))
  h.receive({ type: 'request', id: 1, pairId, method: 'send', args: {
    request: { requestId: 'explicit-request-1', revision: 1, text: 'Exact user text' },
  } })
  await expect.poll(() => h.posted.length).toBe(2)
  expect(h.posted[1]).toMatchObject({ value: { status: 'unknown', snapshot: { url, phase: 'login-required' } } })
  expect(h.tabs.sendMessage).toHaveBeenCalledOnce()
  expect(h.scripting.executeScript).toHaveBeenCalledTimes(2)
  expect(h.tabs.update).not.toHaveBeenCalled()
})


it('does not dispatch a send revoked while the Chrome tab lookup is pending', async () => {
  const h = await background()
  const tab = Promise.withResolvers<{ url: string; windowId: number }>()
  h.tabs.get.mockImplementationOnce(() => tab.promise)
  h.receive({ type: 'request', id: 1, pairId, method: 'send', args: {
    request: { requestId: 'revoked-request-1', revision: 1, text: 'Must not be inserted' },
  } })
  h.revoke()
  tab.resolve({ url, windowId: 7 })
  await tab.promise
  await Promise.resolve()
  expect(h.tabs.sendMessage).not.toHaveBeenCalled()
  expect(h.tabs.update).not.toHaveBeenCalled()
  expect(h.posted).toHaveLength(1)
})


it.each(['lookup', 'injection'] as const)('cannot let an older toolbar %s completion replace a newer selection', async (stage) => {
  const h = await background()
  h.scripting.executeScript.mockClear()
  h.chrome.runtime.connectNative.mockClear()
  h.posted.length = 0
  const old = Promise.withResolvers<{ frameId: number; documentId: string; result: string }[]>()
  if (stage === 'injection') {
    h.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'old-document', result: url }])
  }
  h.scripting.executeScript.mockImplementationOnce(() => old.promise)
  const first = h.click({ id: 43, url })
  if (stage === 'injection') await expect.poll(() => h.scripting.executeScript.mock.calls.length).toBe(2)
  await h.click({ id: 44, url })
  old.resolve([{ frameId: 0, documentId: 'old-document', result: url }])
  await first
  expect(h.chrome.runtime.connectNative).toHaveBeenCalledOnce()
  expect(h.posted).toEqual([{ type: 'pair', version: 1, tabId: 44, documentId: 'selected-document', url }])
  if (stage === 'lookup') {
    expect(h.scripting.executeScript.mock.calls).not.toContainEqual([expect.objectContaining({
      target: { tabId: 43, documentIds: ['old-document'] }, files: ['content.js'],
    })])
  }
})


it('focuses the selected Dot and confirms success only for that admitted browser page', async () => {
  const h = await background()
  h.receive({ type: 'request', id: 1, pairId, method: 'show', args: {} })
  await expect.poll(() => h.posted.length).toBe(2)
  expect(h.tabs.update).toHaveBeenCalledWith(42, { active: true })
  expect(h.windows.update).toHaveBeenCalledWith(7, { focused: true })
  expect(h.posted[1]).toEqual({ type: 'response', id: 1, pairId, ok: true, value: null })
})

it('rejects commands before a native pairing is confirmed', async () => {
  const h = await background(false)
  h.receive({ type: 'request', id: 1, method: 'snapshot', args: {} })
  expect(h.disconnect).toHaveBeenCalledOnce()
  expect(h.tabs.get).not.toHaveBeenCalled()
})
