/** Transport preference persistence touches only its dedicated file in the preserved app profile. */
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { readAxiomPreferences, readAxiomTransport, saveAxiomPreferences, saveAxiomTransport } from '../src/axiom-transport-setting.ts'

it('defaults only when unset, reopens the saved browser choice and preserves unrelated profile state', () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-mode-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  writeFileSync(join(root, 'existing-profile-state'), 'fixture state, not credentials')
  expect(readAxiomTransport(root)).toBe('embedded')
  saveAxiomTransport(root, 'browser')
  expect(readAxiomTransport(root)).toBe('browser')
  saveAxiomTransport(root, 'embedded')
  expect(readAxiomTransport(root)).toBe('embedded')
  expect(readFileSync(join(root, 'existing-profile-state'), 'utf8')).toBe('fixture state, not credentials')
  writeFileSync(join(root, 'axiom-transport.json'), '{invalid')
  expect(() => readAxiomTransport(root)).toThrow('preference is invalid')
})

it.skipIf(process.platform === 'win32')('never follows a preference symlink or overwrites its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-mode-link-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const target = join(root, 'other-file')
  writeFileSync(target, '{"version":1,"transport":"browser"}')
  symlinkSync(target, join(root, 'axiom-transport.json'))
  expect(() => readAxiomTransport(root)).toThrow('preference could not be read')
  expect(() => { saveAxiomTransport(root, 'embedded') }).toThrow('Invalid original-page preference file')
  expect(readFileSync(target, 'utf8')).toBe('{"version":1,"transport":"browser"}')
})

it('reopens private feature choices without changing the explicit transport or unrelated profile state', () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-preferences-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  saveAxiomTransport(root, 'browser')
  expect(readAxiomPreferences(root)).toEqual({ enabled: true, showInSidebar: false })
  expect(() => { saveAxiomPreferences(root, { enabled: 'false', showInSidebar: false }) }).toThrow()
  expect(() => { saveAxiomPreferences(root, { enabled: false, showInSidebar: false, extra: true }) }).toThrow()
  saveAxiomPreferences(root, { enabled: false, showInSidebar: true })
  expect(readAxiomPreferences(root)).toEqual({ enabled: false, showInSidebar: true })
  expect(readAxiomTransport(root)).toBe('browser')
  if (process.platform !== 'win32') expect(statSync(join(root, 'axiom-preferences.json')).mode & 0o077).toBe(0)
  writeFileSync(join(root, 'axiom-preferences.json'), '{invalid')
  expect(() => readAxiomPreferences(root)).toThrow('could not be read')
})

it.skipIf(process.platform === 'win32')('refuses feature preference symlinks without reading or replacing their targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-preferences-link-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const target = join(root, 'other-file')
  const content = '{"version":1,"enabled":true,"showInSidebar":false}'
  writeFileSync(target, content)
  symlinkSync(target, join(root, 'axiom-preferences.json'))
  expect(() => readAxiomPreferences(root)).toThrow('could not be read')
  expect(() => { saveAxiomPreferences(root, { enabled: false, showInSidebar: false }) }).toThrow('Invalid Dot preference')
  expect(readFileSync(target, 'utf8')).toBe(content)
})
