/** Real framed sockets and native-host stdio preserve explicit pairing and exact browser operations. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { BrowserAxiomPage } from '../src/axiom-browser.ts'
import { AXIOM_BROWSER_FRAME_LIMIT, BrowserFrameDecoder, encodeBrowserFrame } from '../src/axiom-browser-framing.ts'
import { AXIOM_EXTENSION_ID, AXIOM_EXTENSION_ORIGIN } from '../src/axiom-browser-protocol.ts'
import type { AxiomSnapshot } from '../src/axiom-protocol.ts'
import { prepareAxiomBrowserBridge } from '../scripts/prepare-axiom-browser.ts'

const selected = 'https://chatgpt.com/dots/controlled~fixture'
const snapshot: AxiomSnapshot = { source: 'chatgpt-web', url: selected, title: 'Original controlled Dot', revision: 1,
  phase: 'ready', messages: [{ id: 'original~1', role: 'assistant', text: 'Original answer', timestamp: null, truncated: false }],
  canSend: true, draftPresent: false, siteStatus: null, limited: true }
interface Message {
  type: string
  id?: number
  method?: string
  pairId?: string
  value?: unknown
  args?: { request?: { requestId: string; text: string } }
}

async function fixture(approve = true) {
  const root = await mkdtemp(join(tmpdir(), 'axiom-browser-test-'))
  const directory = join(root, 'profile')
  const runtime = join(root, 'Skeinlet.app', 'Contents', 'Resources', 'runtime')
  const artifact = join(runtime, 'axiom-browser')
  const nodeDirectory = join(runtime, 'primary-runtime', 'dependencies', 'node', 'bin')
  await mkdir(nodeDirectory, { recursive: true })
  await symlink(process.execPath, join(nodeDirectory, 'node'))
  const children: ChildProcessWithoutNullStreams[] = []
  const confirm = vi.fn(async () => approve)
  const openExternal = vi.fn(async () => {})
  const owner = new BrowserAxiomPage({ directory, confirm, openExternal, publish: () => {}, requestTimeoutMs: 1000 })
  onTestFinished(async () => {
    owner.dispose()
    for (const child of children) {
      const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit')
      child.kill()
      await exited
    }
    await rm(root, { recursive: true, force: true })
  })
  prepareAxiomBrowserBridge(artifact, { stateDirectory: directory })
  await owner.connect(selected)
  const helper = (url = selected, origin = AXIOM_EXTENSION_ORIGIN, respond = true) => {
    const child = spawn(join(artifact, 'native-host.sh'), [origin], { stdio: 'pipe',
      env: { ...process.env, PATH: '', NODE_OPTIONS: '--invalid-ambient-option', NODE_PATH: '/unavailable-node-path', ELECTRON_RUN_AS_NODE: '1' } })
    children.push(child)
    const frames: Message[] = []
    const decoder = new BrowserFrameDecoder()
    child.stdout.on('data', (bytes: Buffer) => {
      decoder.push(bytes, (value) => {
        const frame = value as Message
        frames.push(frame)
        if (respond && frame.type === 'request') {
          const value = frame.method === 'send'
            ? { status: 'confirmed', messageId: 'new-user~2', snapshot: { ...snapshot, messages: [...snapshot.messages,
              { id: 'new-user~2', role: 'user', text: frame.args?.request?.text ?? '', timestamp: null, truncated: false }] } }
            : frame.method === 'show' ? null : snapshot
          child.stdin.write(encodeBrowserFrame({ type: 'response', id: frame.id, pairId: frame.pairId, ok: true, value }))
        }
      })
    })
    child.stdin.on('error', () => {})
    child.stdin.write(encodeBrowserFrame({ type: 'pair', version: 1, tabId: 42, documentId: 'fixture-document-1', url }))
    return { child, frames }
  }
  return { owner, directory, artifact, confirm, openExternal, helper }
}

describe('browser message framing', () => {
  it('decodes split and coalesced UTF-8 frames and rejects invalid lengths, bytes and JSON', () => {
    const first = encodeBrowserFrame({ text: 'Original café\nsecond line' })
    const second = encodeBrowserFrame({ next: true })
    const values: unknown[] = []
    const decoder = new BrowserFrameDecoder()
    decoder.push(first.subarray(0, 3), value => values.push(value))
    decoder.push(Buffer.concat([first.subarray(3), second]), value => values.push(value))
    expect(values).toEqual([{ text: 'Original café\nsecond line' }, { next: true }])
    for (const size of [0, AXIOM_BROWSER_FRAME_LIMIT + 1]) {
      const header = Buffer.alloc(4); header.writeUInt32LE(size)
      expect(() => new BrowserFrameDecoder().push(header, () => {})).toThrow()
    }
    for (const bytes of [Buffer.from([0xff]), Buffer.from('{')]) {
      const frame = Buffer.alloc(bytes.length + 4); frame.writeUInt32LE(bytes.length); bytes.copy(frame, 4)
      expect(() => new BrowserFrameDecoder().push(frame, () => {})).toThrow()
    }
  })
})

describe.skipIf(process.platform === 'win32')('paired original browser transport', () => {
  it('settles an initial connection disposed before its private listener becomes ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-browser-start-'))
    const owner = new BrowserAxiomPage({ directory: join(root, 'profile'), confirm: async () => false,
      openExternal: async () => {}, publish: () => {} })
    onTestFinished(async () => { owner.dispose(); await rm(root, { recursive: true, force: true }) })
    const connecting = owner.connect(selected)
    owner.dispose()
    await expect(connecting).rejects.toThrow('closed')
  })

  it('prepares only activeTab/scripting/nativeMessaging artifacts with the pinned public identity', async () => {
    const h = await fixture()
    const manifest = JSON.parse(await readFile(join(h.artifact, 'extension', 'manifest.json'), 'utf8')) as { permissions: string[]; key: string; host_permissions?: unknown }
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'nativeMessaging'])
    expect(manifest.host_permissions).toBeUndefined()
    const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)
    const id = [...hash].flatMap(byte => [byte >> 4, byte & 15]).map(value => String.fromCharCode(97 + value)).join('')
    expect(id).toBe(AXIOM_EXTENSION_ID)
    expect((await stat(h.directory)).mode & 0o077).toBe(0)
    expect((await stat(join(h.directory, 'connection.json'))).mode & 0o077).toBe(0)
    expect(await readFile(join(h.artifact, 'native-host.sh'), 'utf8')).toContain('primary-runtime/dependencies/node/bin/node')
  })

  it('confirms the exact selected tab, relays bounded snapshots and sends once without leaking the private socket key', async () => {
    const h = await fixture()
    expect((await h.owner.snapshot()).phase).toBe('login-required')
    const helper = h.helper()
    await expect.poll(() => helper.frames.some(frame => frame.type === 'paired')).toBe(true)
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ tabId: 42, documentId: 'fixture-document-1', url: selected }))
    expect(await h.owner.snapshot()).toEqual(snapshot)
    const request = { requestId: 'explicit-send-1', revision: 1, text: 'Exact first line.\nExact second line.' }
    expect(await h.owner.send(request)).toMatchObject({ status: 'confirmed', messageId: 'new-user~2' })
    expect(await h.owner.send(request)).toMatchObject({ status: 'confirmed' })
    expect(await h.owner.send({ ...request, text: 'Different text' })).toMatchObject({ status: 'refused' })
    expect(helper.frames.filter(frame => frame.method === 'send').map(frame => frame.args?.request)).toEqual([request])
    const descriptor = JSON.parse(await readFile(join(h.directory, 'connection.json'), 'utf8')) as { key: string }
    expect(JSON.stringify(helper.frames)).not.toContain(descriptor.key)
    await h.owner.showLogin()
    expect(helper.frames.filter(frame => frame.method === 'show')).toHaveLength(1)
    expect(h.openExternal).not.toHaveBeenCalled()
  })

  it('revokes a held offer across disconnect and same-URL reconnect before approval', async () => {
    const h = await fixture()
    const approval = Promise.withResolvers<boolean>()
    h.confirm.mockImplementationOnce(() => approval.promise)
    const old = h.helper()
    await expect.poll(() => h.confirm.mock.calls.length).toBe(1)
    const closed = once(old.child, 'exit')
    h.owner.disconnect()
    await h.owner.connect(selected)
    approval.resolve(true)
    await closed
    expect(old.frames.some(frame => frame.type === 'paired')).toBe(false)
    const fresh = h.helper()
    await expect.poll(() => fresh.frames.some(frame => frame.type === 'paired')).toBe(true)
    expect(h.confirm).toHaveBeenCalledTimes(2)
  })

  it('rejects another Dot, a wrong extension origin and declined native pairing', async () => {
    const h = await fixture(false)
    const wrong = h.helper('https://chatgpt.com/dots/different')
    await once(wrong.child, 'exit')
    expect(h.confirm).not.toHaveBeenCalled()
    const origin = h.helper(selected, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/')
    await once(origin.child, 'exit')
    expect(h.confirm).not.toHaveBeenCalled()
    const declined = h.helper()
    await once(declined.child, 'exit')
    expect(h.confirm).toHaveBeenCalledOnce()
    expect(declined.frames.some(frame => frame.type === 'paired')).toBe(false)
    await h.owner.showLogin()
    expect(h.openExternal).toHaveBeenCalledWith(selected)
  })
})
