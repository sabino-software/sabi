/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_FORK } from './local-fork.mjs'

/**
 * Copy the platform launcher into the application's public command directory.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 * @param executableName - Native macOS executable basename; defaults to the upstream name except in explicit local-fork packaging.
 * @param localFork - Add the Sabi alias and pin both launchers to the existing local profile; defaults to the packaging flag on macOS.
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32',
  executableName = platform === 'darwin' && process.env.DSH_DESKTOP_LOCAL_FORK === '1' ? LOCAL_FORK.executableName : 'DeepSeek Harness',
  localFork = platform === 'darwin' && process.env.DSH_DESKTOP_LOCAL_FORK === '1',
): void {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u.test(executableName)) {
    throw new Error('desktop CLI: executable name must be a plain basename')
  }
  if (platform === 'win32' && executableName !== 'DeepSeek Harness') {
    throw new Error('desktop CLI: custom executable names require macOS')
  }
  if (localFork && platform !== 'darwin') throw new Error('desktop CLI: local-fork commands require macOS')
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
  if (localFork) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u.test(LOCAL_FORK.profileDirectory)) {
      throw new Error('desktop CLI: profile directory must be a plain basename')
    }
    const launcher = readFileSync(command, 'utf8')
    if (!launcher.includes('ELECTRON_RUN_AS_NODE=1 exec')) throw new Error('desktop CLI: macOS launcher execution marker is missing')
    const source = launcher.replace('ELECTRON_RUN_AS_NODE=1 exec',
      `DSH_HOME="\${HOME:?}/Library/Application Support/${LOCAL_FORK.profileDirectory}/harness-home" DSH_NATIVE_CONVERSATIONS=1 DSH_DESKTOP_CLI_NAME=dsh ELECTRON_RUN_AS_NODE=1 exec`)
    writeFileSync(command, source, { mode: 0o755 })
    writeFileSync(join(destination, 'bin', 'sabi'), source.replace('DSH_DESKTOP_CLI_NAME=dsh', 'DSH_DESKTOP_CLI_NAME=sabi'))
    chmodSync(join(destination, 'bin', 'sabi'), 0o755)
  }
  writeFileSync(join(destination, 'command.json'), JSON.stringify({ name: localFork ? 'sabi' : 'dsh' }) + '\n')
}
