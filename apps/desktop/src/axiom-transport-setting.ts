/** Durable original-page transport choice, separate from website authentication and Host credentials. */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiomTransportMode } from './axiom-protocol.ts'

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
