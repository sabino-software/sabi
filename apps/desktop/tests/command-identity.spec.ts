/** Packaged command metadata cannot select arbitrary command names or paths. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { readDesktopCommandName } from '../src/command-identity.ts'
import { brandDesktopLocale } from '../src/desktop-branding.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

it('retains legacy dsh and rejects malformed or arbitrary command descriptors', () => {
  const resources = mkdtempSync(join(tmpdir(), 'desktop-command-'))
  onTestFinished(() => rm(resources, { recursive: true, force: true }))
  expect(readDesktopCommandName(resources)).toBe('dsh')
  const cli = join(resources, 'runtime', 'cli')
  mkdirSync(cli, { recursive: true })
  for (const name of ['dsh', 'sabi'] as const) {
    writeFileSync(join(cli, 'command.json'), JSON.stringify({ name }))
    expect(readDesktopCommandName(resources)).toBe(name)
  }
  for (const value of [null, {}, { name: '../sabi' }, { name: 'other' }, { name: 1 }]) {
    writeFileSync(join(cli, 'command.json'), JSON.stringify(value))
    expect(() => readDesktopCommandName(resources)).toThrow('Invalid packaged command identity')
  }
})

it.each(['en', 'zh-CN', 'pt'])('brands only fork command copy as sabi in %s', (language) => {
  const locale = resolveDesktopLocale(language)
  expect(brandDesktopLocale(locale, 'DeepSeek Harness')).toBe(locale)
  expect(brandDesktopLocale(locale, 'Skeinlet').messages.cliCommandMenu).toContain('sabi')
  expect(brandDesktopLocale(locale, 'Skeinlet').messages.cliCommandNewTerminal).toContain('sabi --version')
  expect(brandDesktopLocale(locale, 'Sabi').messages.cliCommandMenu).toContain('sabi')
  expect(brandDesktopLocale(locale, 'Other product').messages.cliCommandMenu).toContain('dsh')
  expect(locale.messages.cliCommandMenu).toContain('dsh')
})
