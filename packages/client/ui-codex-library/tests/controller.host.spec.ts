/** Remote errors contain no source exception details or authentication data. */
import { Context } from '@deepseek-ai/cordis'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import CodexLibraryController from '../src/index.ts'
import type { CodexChatId } from '../src/types.ts'

describe('Codex library Remote owner', () => {
  it('defaults to the OS user work home independently of CODEX_HOME', () => {
    vi.stubEnv('CODEX_HOME', '/fixture/personal-codex')
    onTestFinished(() => { vi.unstubAllEnvs() })
    expect(CodexLibraryController.Config({}).sourceHome).toBe(join(homedir(), '.codex'))
  })

  it('reports unreadable and malformed sources without disclosing their contents or paths', async () => {
    const home = mkdtempSync(join(tmpdir(), 'PRIVATE_SOURCE_PATH-'))
    onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
    writeFileSync(join(home, 'state_5.sqlite'), 'PRIVATE_CORRUPTED_DATABASE_CONTENT')
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(CodexLibraryController, { sourceHome: home })
    for (const call of [
      () => ctx.codexLibrary.list({ query: '', archived: false, cursor: null }),
      () => ctx.codexLibrary.read('chat-one' as CodexChatId, null),
    ]) {
      let failed = false
      try { call() }
      catch (error: unknown) {
        failed = true
        expect(error).toMatchObject({ code: 'gateway/internal', isDSHRemoteError: true })
        expect(String(error)).not.toMatch(/PRIVATE_|sqlite|malformed|SQLITE/)
      }
      expect(failed).toBe(true)
    }
  })
})
