/** Existing source data stays untouched through bounded catalog and transcript reads. */
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CodexLibraryReader } from '../src/reader.ts'
import type { CodexChatId } from '../src/types.ts'

const CHAT = 'chat-001' as CodexChatId

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'codex-library-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const catalog = new DatabaseSync(join(home, 'state_5.sqlite'))
  catalog.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT NOT NULL, cwd TEXT NOT NULL,
    updated_at INTEGER NOT NULL, archived INTEGER NOT NULL, history_mode TEXT NOT NULL)`)
  const insert = catalog.prepare('INSERT INTO threads VALUES (?, NULL, ?, ?, ?, ?, ?)')
  for (let index = 0; index < 45; index++) insert.run(`chat-${String(index).padStart(3, '0')}`, `Task ${index}`, '/work/repo', 1700000000 + index, 0, 'paginated')
  insert.run('archived-chat', 'Old work', '/work/old', 1700000000, 1, 'paginated')
  insert.run('literal-title', 'Use %_ literally', '/work/repo', 1700000100, 0, 'paginated')
  catalog.close()
  const history = new DatabaseSync(join(home, 'thread_history_1.sqlite'))
  history.exec(`CREATE TABLE thread_items (thread_id TEXT, item_id TEXT, rollout_ordinal INTEGER,
    created_at_ms INTEGER, item_json TEXT, item_type TEXT)`)
  const add = (ordinal: number, type: string, value: object, id = `item-${ordinal}`) => {
    history.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)').run(CHAT, id, ordinal, 1700000000000 + ordinal, JSON.stringify(value), type)
  }
  for (let index = 0; index < 45; index++) add(index, 'agentMessage', { type: 'agentMessage', text: `Answer ${index}` })
  add(100, 'userMessage', { type: 'userMessage', content: [{ type: 'text', text: 'A visible question' }, { type: 'image', url: 'file:///private/attachment.png' }] })
  add(101, 'reasoning', { type: 'reasoning', text: 'PRIVATE_REASONING' })
  add(102, 'commandExecution', { type: 'commandExecution', output: 'PRIVATE_TOOL_OUTPUT' })
  history.close()
  writeFileSync(join(home, 'auth.json'), 'DO_NOT_READ_AUTH')
  writeFileSync(join(home, 'config.toml'), 'DO_NOT_READ_CONFIG')
  return { home, reader: new CodexLibraryReader(home), add: (ordinal: number, type: string, value: object) => {
    const database = new DatabaseSync(join(home, 'thread_history_1.sqlite'))
    database.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)').run(CHAT, `item-${ordinal}`, ordinal, 1700000000000 + ordinal, JSON.stringify(value), type)
    database.close()
  } }
}

function hashes(home: string) {
  return Object.fromEntries(readdirSync(home).map(name => [name, createHash('sha256').update(readFileSync(join(home, name))).digest('hex')]))
}

describe('Codex source library', () => {
  it('paginates titles, filters archives, and treats search punctuation literally', () => {
    const { reader } = fixture()
    const first = reader.list({ query: '', archived: false, cursor: null })
    expect(first.readOnly).toBe(true)
    expect(first.chats).toHaveLength(40)
    expect(first.chats[0]?.id).toBe('literal-title')
    const second = reader.list({ query: '', archived: false, cursor: first.nextCursor })
    expect(second.chats).toHaveLength(6)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.chats, ...second.chats].map(chat => chat.id)).size).toBe(46)
    expect(reader.list({ query: '%_', archived: false, cursor: null }).chats.map(chat => chat.id)).toEqual(['literal-title'])
    expect(reader.list({ query: 'OLD', archived: true, cursor: null }).chats.map(chat => chat.id)).toEqual(['archived-chat'])
  })

  it('reads recent visible text chronologically and pages older messages without tools or reasoning', () => {
    const { reader } = fixture()
    const first = reader.read(CHAT, null)
    expect(first.messages).toHaveLength(40)
    expect(first.messages.at(-1)).toMatchObject({ role: 'user', text: 'A visible question', timestamp: 1700000000100 })
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_REASONING|PRIVATE_TOOL_OUTPUT|attachment|DO_NOT_READ/)
    expect(first.messages[0]?.text).toBe('Answer 6')
    const second = reader.read(CHAT, first.nextCursor)
    expect(second.messages.map(message => message.text)).toEqual(Array.from({ length: 6 }, (_, index) => `Answer ${index}`))
    expect(second.nextCursor).toBeNull()
  })

  it('preserves all source bytes and creates no files while listing and reading', () => {
    const { home, reader } = fixture()
    const before = hashes(home)
    reader.list({ query: '', archived: false, cursor: null })
    reader.read(CHAT, null)
    expect(hashes(home)).toEqual(before)
  })

  it('bounds the complete emitted UTF-8 page and marks oversized rows visibly', () => {
    const { reader, add } = fixture()
    for (let index = 200; index < 208; index++) add(index, 'agentMessage', { type: 'agentMessage', text: '界'.repeat(30000) })
    add(209, 'agentMessage', { type: 'agentMessage', text: '界'.repeat(100000) })
    const page = reader.read(CHAT, null)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(524288)
    expect(page.limited).toBe(true)
    expect(page.nextCursor).not.toBeNull()
    expect(page.messages.some(message => message.text.length === 30000)).toBe(true)
    expect(reader.read(CHAT, page.nextCursor).messages.length).toBeGreaterThan(0)
  })

  it('rejects path traversal identities and malformed or out-of-range cursors', () => {
    const { reader } = fixture()
    expect(() => reader.read('../../auth.json' as CodexChatId, null)).toThrow()
    expect(() => reader.read(CHAT, 'not-json')).toThrow()
    expect(() => reader.list({ query: '', archived: false, cursor: '-1' })).toThrow()
    expect(() => reader.list({ query: 'x'.repeat(201), archived: false, cursor: null })).toThrow()
    expect(() => reader.read('missing' as CodexChatId, null)).toThrow('unavailable')
  })

  it('refuses symlinked databases and unsupported source history formats', () => {
    const { home, reader } = fixture()
    const database = new DatabaseSync(join(home, 'state_5.sqlite'))
    database.prepare('UPDATE threads SET history_mode = ? WHERE id = ?').run('legacy', CHAT)
    database.close()
    expect(() => reader.read(CHAT, null)).toThrow('Unsupported')
    rmSync(join(home, 'thread_history_1.sqlite'))
    symlinkSync(join(home, 'auth.json'), join(home, 'thread_history_1.sqlite'))
    const catalog = new DatabaseSync(join(home, 'state_5.sqlite'))
    catalog.prepare('UPDATE threads SET history_mode = ? WHERE id = ?').run('paginated', CHAT)
    catalog.close()
    expect(() => reader.read(CHAT, null)).toThrow('unavailable')
  })

  it('fails visibly on malformed history records and incompatible schemas', () => {
    const { home, reader } = fixture()
    const database = new DatabaseSync(join(home, 'thread_history_1.sqlite'))
    database.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)').run(CHAT, 'bad', 300, 1700000000000, '{PRIVATE_MALFORMED', 'agentMessage')
    database.close()
    expect(() => reader.read(CHAT, null)).toThrow()
    const catalog = new DatabaseSync(join(home, 'state_5.sqlite'))
    catalog.exec('DROP TABLE threads')
    catalog.close()
    expect(() => reader.list({ query: '', archived: false, cursor: null })).toThrow()
  })
})
