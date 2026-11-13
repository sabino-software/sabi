/** Apply the packaged local application's identity before Electron opens its profile. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isLocalProductName } from './desktop-branding.ts'

interface LocalForkApplication {
  getPath(name: 'appData'): string
  setName(name: string): void
  setPath(name: 'userData' | 'sessionData', path: string): void
}

/**
 * Apply the manifest-owned local profile; ordinary application manifests do nothing.
 * @param manifest Parsed packaged application manifest; malformed fork metadata rejects startup.
 * @param application Electron application before ready or any userData access.
 * @param environment Process environment passed to the Host; its DSH_HOME is fixed to the packaged profile.
 * @returns The local product identity after configuring its profile, or undefined for the upstream application.
 */
export function configureLocalFork(manifest: unknown, application: LocalForkApplication,
  environment: NodeJS.ProcessEnv): { productName: string; scheme: string } | undefined {
  if (typeof manifest !== 'object' || manifest === null || !('dshLocalFork' in manifest)) return
  const fork = manifest.dshLocalFork
  if (typeof fork !== 'object' || fork === null || !('productName' in fork) || !('profileDirectory' in fork) || !('scheme' in fork)
    || !isLocalProductName(fork.productName)
    || typeof fork.scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/u.test(fork.scheme)
    || typeof fork.profileDirectory !== 'string' || fork.profileDirectory.trim() === ''
    || /[/\\]|^\.{1,2}$/u.test(fork.profileDirectory)) {
    throw new Error('desktop local fork: invalid packaged profile identity')
  }
  // macOS Safe Storage uses this identity; public labels use productName.
  const runtimeName = 'runtimeName' in fork ? fork.runtimeName : 'Skeinlet'
  if (runtimeName !== 'Skeinlet') throw new Error('desktop local fork: invalid packaged profile identity')
  const root = join(application.getPath('appData'), fork.profileDirectory)
  const electron = join(root, 'electron')
  mkdirSync(electron, { recursive: true })
  application.setName(runtimeName)
  application.setPath('userData', electron)
  application.setPath('sessionData', electron)
  environment.DSH_HOME = join(root, 'harness-home')
  environment.DSH_NATIVE_CONVERSATIONS = '1'
  environment.DSH_PROVIDER_NEUTRAL = '1'
  environment.DSH_TELEMETRY_DISABLED = '1'
  return { productName: fork.productName, scheme: fork.scheme }
}

export { brandDesktopLocale } from './desktop-branding.ts'
