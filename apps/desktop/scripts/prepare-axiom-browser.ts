/** Prepare an unpacked MV3 extension and native host without registering or installing either. */
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { AXIOM_EXTENSION_ID, AXIOM_NATIVE_HOST } from '../src/axiom-browser-protocol.ts'
import { LOCAL_FORK } from './local-fork.mjs'

/**
 * Generate browser artifacts for the isolated local Mac application; no browser profile is modified.
 * @param destination Owned output directory under packaged runtime resources.
 * @param options Explicit installed identity; optional state directory is confined to controlled test fixtures.
 */
export function prepareAxiomBrowserBridge(destination: string, options: { stateDirectory?: string } = {}): void {
  const source = join(import.meta.dirname, '..', 'browser-extension')
  const extension = join(destination, 'extension')
  mkdirSync(extension, { recursive: true })
  copyFileSync(join(source, 'manifest.json'), join(extension, 'manifest.json'))
  copyFileSync(join(source, 'background.js'), join(extension, 'background.js'))
  const transpile = (name: string): string => ts.transpileModule(readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const functions = transpile('axiom-page.ts').replace(/^export /gmu, '')
  const body = readFileSync(join(source, 'content-body.js'), 'utf8')
  writeFileSync(join(extension, 'content.js'), `(() => {\n${functions}\n${body}\n})()\n`)
  for (const name of ['native-host.mjs', 'registration.mjs']) copyFileSync(join(source, name), join(destination, name))
  writeFileSync(join(destination, 'framing.mjs'), transpile('axiom-browser-framing.ts'))
  writeFileSync(join(destination, 'native-host-config.json'), JSON.stringify({ extensionId: AXIOM_EXTENSION_ID,
    hostName: AXIOM_NATIVE_HOST, profileDirectory: LOCAL_FORK.profileDirectory,
    ...options.stateDirectory === undefined ? {} : { stateDirectory: options.stateDirectory } }))
  const launcher = join(destination, 'native-host.sh')
  writeFileSync(launcher, '#!/bin/sh\nset -eu\nhere="$(CDPATH= cd -- "${0%/*}" && pwd)"\nruntime="$(CDPATH= cd -- "$here/.." && pwd)"\nunset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE\nexec "$runtime/primary-runtime/dependencies/node/bin/node" "$here/native-host.mjs" "$@"\n')
  chmodSync(launcher, 0o755)
}
