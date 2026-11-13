/** Durable original-page transport choice, separate from website authentication and Host credentials. */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { axiomConversationUrl } from './axiom-navigation.ts'
import type { AxiomPreferences, AxiomSelection, AxiomTransportMode } from './axiom-protocol.ts'

/** @param userData Preserved Electron profile. @returns Saved explicit choice; only an absent setting defaults to embedded. */
export function readAxiomTransport(userData: string): AxiomTransportMode {
  let text: string
  try {
    const path = join(userData, 'axiom-transport.json')
    if (!lstatSync(path).isFile()) throw new Error('Invalid original-page preference file')
    text = readFileSync(path, 'utf8')
  }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 'embedded'
    throw new Error('The original-page connection preference could not be read')
  }
  let value: unknown
  try { value = JSON.parse(text) } catch (_invalidPreference: unknown) { throw new Error('The original-page connection preference is invalid') }
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('transport' in value) || (value.transport !== 'browser' && value.transport !== 'embedded')) throw new Error('The original-page connection preference is invalid')
  return value.transport
}

/**
 * @param userData Preserved Electron profile.
 * @param transport Explicit choice validated before writing.
 * @returns After atomically replacing only this feature's preference.
 */
export function saveAxiomTransport(userData: string, transport: unknown): void {
  if (transport !== 'browser' && transport !== 'embedded') throw new Error('Unknown original-page transport')
  mkdirSync(userData, { recursive: true })
  const destination = join(userData, 'axiom-transport.json')
  try { if (!lstatSync(destination).isFile()) throw new Error('Invalid original-page preference file') }
  catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = join(userData, `.axiom-transport-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, transport }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, destination)
  } catch (error: unknown) {
    try { unlinkSync(temporary) } catch (_uncreatedPreference: unknown) { /* A failed creation leaves no owned temporary file. */ }
    throw error
  }
}

/** Exact renderer choices; neither coercion nor extra properties are admitted. */
export const axiomPreferencesSchema = z.object({ enabled: z.boolean(), showInSidebar: z.boolean(),
  sidebarStyle: z.enum(['sameNewSession', 'subtle', 'outline']),
}).strict()
const savedPreferencesSchema = axiomPreferencesSchema.extend({
  version: z.literal(1), sidebarStyle: axiomPreferencesSchema.shape.sidebarStyle.default('sameNewSession'),
}).strict()

/** @param userData Preserved app profile. @returns Saved choices; an absent file enables Dot without a sidebar row. */
export function readAxiomPreferences(userData: string): AxiomPreferences {
  const path = join(userData, 'axiom-preferences.json')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Invalid Dot preference file')
    const { version: _version, ...preferences } = savedPreferencesSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    return preferences
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' }
    }
    throw new Error('The Dot preferences could not be read')
  }
}

/** @param userData Preserved app profile. @param value Exact feature choices. @returns After private atomic replacement. */
export function saveAxiomPreferences(userData: string, value: unknown): void {
  const preferences = axiomPreferencesSchema.parse(value)
  mkdirSync(userData, { recursive: true })
  const destination = join(userData, 'axiom-preferences.json')
  try {
    const info = lstatSync(destination)
    if (!info.isFile() || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Invalid Dot preference file')
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = join(userData, `.axiom-preferences-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, ...preferences }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, destination)
  } catch (error: unknown) {
    try { unlinkSync(temporary) } catch (_uncreatedPreference: unknown) { /* Creation may have failed before the file existed. */ }
    throw error
  }
}

/** Saved selection accepts canonical conversation URLs and bounded source titles only. */
export const axiomSelectionSchema = z.object({
  url: z.string().max(4096).refine((value) => {
    try { return axiomConversationUrl(value) === value } catch (_notCanonicalDot: unknown) { return false }
  }),
  title: z.string().min(1).max(300),
}).strict()
const savedSelectionSchema = axiomSelectionSchema.extend({ version: z.literal(1) }).strict()

/** @param userData Preserved app profile. @returns The last observed Dot, or null when none was saved. */
export function readAxiomSelection(userData: string): AxiomSelection | null {
  const path = join(userData, 'axiom-selection.json')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Invalid Dot selection file')
    const { version: _version, ...selection } = savedSelectionSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    return selection
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null
    throw new Error('The Dot selection could not be read')
  }
}

/** @param userData Preserved app profile. @param value Observed canonical selection. @returns After private atomic replacement. */
export function saveAxiomSelection(userData: string, value: AxiomSelection): void {
  const selection = axiomSelectionSchema.parse(value)
  mkdirSync(userData, { recursive: true })
  const path = join(userData, 'axiom-selection.json')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Invalid Dot selection file')
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const temporary = join(userData, `.axiom-selection-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, ...selection }), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } catch (error: unknown) {
    try { unlinkSync(temporary) } catch (_uncreatedSelection: unknown) { /* Creation may fail before the file exists. */ }
    throw error
  }
}
