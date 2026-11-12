/** Apply the packaged local application's identity before Electron opens its profile. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopLocale } from './locale.ts'

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
    || typeof fork.productName !== 'string' || fork.productName.trim() === ''
    || typeof fork.scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/u.test(fork.scheme)
    || typeof fork.profileDirectory !== 'string' || fork.profileDirectory.trim() === ''
    || /[/\\]|^\.{1,2}$/u.test(fork.profileDirectory)) {
    throw new Error('desktop local fork: invalid packaged profile identity')
  }
  const root = join(application.getPath('appData'), fork.profileDirectory)
  const electron = join(root, 'electron')
  mkdirSync(electron, { recursive: true })
  application.setName(fork.productName)
  application.setPath('userData', electron)
  application.setPath('sessionData', electron)
  environment.DSH_HOME = join(root, 'harness-home')
  return { productName: fork.productName, scheme: fork.scheme }
}

/**
 * Substitute the packaged product name in locale-owned native copy.
 * @param locale Resolved shell dictionary.
 * @param productName Packaged application name; the upstream name preserves the original dictionary.
 * @returns Locale copy with the local product name, without modifying shared dictionaries.
 */
export function brandDesktopLocale(locale: DesktopLocale, productName: string): DesktopLocale {
  if (productName === 'DeepSeek Harness') return locale
  const messages = { ...locale.messages }
  for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
    messages[key] = messages[key].replaceAll('DeepSeek Harness', productName)
  }
  return { ...locale, messages }
}
