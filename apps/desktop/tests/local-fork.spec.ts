import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configureLocalFork, brandDesktopLocale } from '../src/local-fork.ts'
import { parseDesktopPackageInvocation } from '../scripts/package-target.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import { LOCAL_FORK } from '../scripts/local-fork.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

describe('isolated local application', () => {
  it('brands native localized copy without changing the upstream dictionaries', () => {
    const upstream = resolveDesktopLocale('pt')
    expect(brandDesktopLocale(upstream, LOCAL_FORK.productName).messages.aboutMenu).toBe('Sobre Sabi')
    expect(upstream.messages.aboutMenu).toBe('Sobre DeepSeek Harness')
  })

  it('retains the existing login and Harness profile without relying on launch environment', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-fork-'))
    try {
      const application = { getPath: () => root, setName: vi.fn(), setPath: vi.fn() }
      const environment = { DSH_HOME: '/unrelated-profile' }
      configureLocalFork({ dshLocalFork: LOCAL_FORK }, application, environment)
      expect(application.setName).toHaveBeenCalledWith(LOCAL_FORK.runtimeName)
      expect(environment).toMatchObject({ DSH_PROVIDER_NEUTRAL: '1', DSH_NATIVE_CONVERSATIONS: '1', DSH_TELEMETRY_DISABLED: '1' })
      expect(application.setPath).toHaveBeenCalledWith('userData', join(root, LOCAL_FORK.profileDirectory, 'electron'))
      expect(application.setPath).toHaveBeenCalledWith('sessionData', join(root, LOCAL_FORK.profileDirectory, 'electron'))
      expect(environment.DSH_HOME).toBe(join(root, LOCAL_FORK.profileDirectory, 'harness-home'))
      configureLocalFork({}, application, environment)
      expect(application.setName).toHaveBeenCalledTimes(1)
      expect(() => configureLocalFork({ dshLocalFork: { productName: 'Fork', profileDirectory: '../original' } }, application, environment)).toThrow(/invalid packaged/u)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('only permits local packaging with ad-hoc Apple Silicon signing', () => {
    expect(parseDesktopPackageInvocation(['mac-arm64', '--unsigned', '--local-fork'], 'darwin', 'arm64').localFork).toBe(true)
    expect(() => parseDesktopPackageInvocation(['mac-arm64', '--local-fork'], 'darwin', 'arm64')).toThrow(/--unsigned/u)
    expect(() => parseDesktopPackageInvocation(['mac-x64', '--unsigned', '--local-fork'], 'darwin', 'arm64')).toThrow(/mac-arm64/u)
    const config = createElectronBuilderConfig({ DSH_DESKTOP_LOCAL_FORK: '1', DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_APP_ID: LOCAL_FORK.appId }, 'darwin', 'arm64')
    expect(config.productName).toBe('Sabi')
    expect(config.executableName).toBe('Sabi')
    expect(config.appId).toBe('dev.sabino.skeinlet')
    expect(config.extraMetadata.dshLocalFork?.runtimeName).toBe('Skeinlet')
    expect(config.artifactName).toMatch(/^sabi-/u)
    expect(config.protocols[0].schemes).toEqual([LOCAL_FORK.scheme])
    expect(config.extraMetadata.dshLocalFork?.profileDirectory).toBe(LOCAL_FORK.profileDirectory)
    expect(config.mac.identity).toBe('-')
    expect(config.mac.notarize).toBe(false)
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
    expect(config.publish).toBeNull()
  })
})

it('keeps old manifests on the same runtime identity and rejects a new encryption-key identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'local-fork-identity-'))
  try {
    const application = { getPath: () => root, setName: vi.fn(), setPath: vi.fn() }
    const legacy = { productName: 'Skeinlet', profileDirectory: 'DeepSeek Harness Local', scheme: 'skeinlet' }
    configureLocalFork({ dshLocalFork: legacy }, application, {})
    expect(application.setName).toHaveBeenCalledExactlyOnceWith('Skeinlet')
    expect(() => configureLocalFork({ dshLocalFork: { ...LOCAL_FORK, runtimeName: 'Sabi' } }, application, {})).toThrow('invalid packaged profile identity')
    expect(() => configureLocalFork({ dshLocalFork: { ...LOCAL_FORK, productName: 'Unknown' } }, application, {})).toThrow('invalid packaged profile identity')
    expect(application.setName).toHaveBeenCalledTimes(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
