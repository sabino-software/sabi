/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_FORK } from './local-fork.mjs'

/**
 * Copy the platform launcher into the application's public command directory.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 * @param executableName - Native macOS executable basename; defaults to the upstream name except in explicit local-fork packaging.
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32',
  executableName = platform === 'darwin' && process.env.DSH_DESKTOP_LOCAL_FORK === '1' ? LOCAL_FORK.productName : 'DeepSeek Harness',
): void {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u.test(executableName)) {
    throw new Error('desktop CLI: executable name must be a plain basename')
  }
  if (platform === 'win32' && executableName !== 'DeepSeek Harness') {
    throw new Error('desktop CLI: custom executable names require macOS')
  }
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  const template = join(import.meta.dirname, '..', 'cli', name)
  if (platform === 'darwin' && executableName !== 'DeepSeek Harness') {
    const source = readFileSync(template, 'utf8')
    const upstream = '$resources/../MacOS/DeepSeek Harness'
    if (!source.includes(upstream)) throw new Error('desktop CLI: macOS launcher executable marker is missing')
    writeFileSync(command, source.replace(upstream, `$resources/../MacOS/${executableName}`))
  } else {
    copyFileSync(template, command)
  }
  if (platform === 'darwin') chmodSync(command, 0o755)
}
