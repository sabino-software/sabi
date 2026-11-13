/** Fork artifact evidence only; never installs, publishes, signs with an identity, or reads credentials. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, totalmem } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { LOCAL_FORK } from '../../apps/desktop/scripts/local-fork.mjs'
import { desktopTargetBuildPaths } from '../../apps/desktop/scripts/desktop-build-paths.mjs'

const evidence = process.env.SABI_CI_EVIDENCE_DIR
const artifacts = process.env.SABI_CI_ARTIFACT_DIR
if (!evidence || !artifacts || !isAbsolute(evidence) || !isAbsolute(artifacts)) {
  throw new Error('Set absolute CI evidence and artifact directories')
}
mkdirSync(evidence, { recursive: true, mode: 0o700 })
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const source = command('git', ['rev-parse', 'HEAD'])
const resources = () => ({ source, platform: platform(), arch: arch(), cpus: cpus().length, memoryBytes: totalmem(),
  disk: command('/bin/df', ['-k', '.']), macos: command('/usr/bin/sw_vers', []), node: process.version,
  runner: process.env.RUNNER_NAME ?? null, imageVersion: process.env.ImageVersion ?? null })
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`)
const mode = process.argv[2]
if (mode === 'preflight') {
  if (platform() !== 'darwin' || arch() !== 'arm64') throw new Error('Fork packaging requires a native macOS arm64 runner')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 9)) throw new Error('Node >=24.9 is required')
  if (command('pnpm', ['--version']) !== '11.28.5') throw new Error('pnpm 11.28.5 is required')
  if (source !== process.env.GITHUB_SHA) throw new Error('Checkout does not match the workflow source SHA')
  writeFileSync(join(evidence, 'SOURCE_SHA.txt'), `${source}\n`)
  save('source.json', { source, repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    requestedSigning: 'ad-hoc', notarization: 'disabled', publication: 'disabled' })
  save('resources-before.json', resources())
} else if (mode === 'resources') {
  save('resources-after.json', resources())
} else if (mode === 'collect') {
  const paths = desktopTargetBuildPaths('mac-arm64')
  const application = join(paths.unsignedArtifacts, 'mac-arm64', `${LOCAL_FORK.productName}.app`)
  command('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', application])
  // codesign emits its signature description on stderr, including successful invocations.
  const inspected = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', application], { encoding: 'utf8' })
  if (inspected.status !== 0 || inspected.error) throw new Error('Could not inspect the packaged application signature')
  const signature = inspected.stdout + inspected.stderr
  if (!/^Signature=adhoc$/mu.test(signature)) throw new Error('The fork artifact must use an ad-hoc signature')
  writeFileSync(join(evidence, 'signature.txt'), signature)
  mkdirSync(artifacts, { recursive: true, mode: 0o700 })
  const names = readdirSync(paths.unsignedArtifacts)
    .filter(name => name.startsWith(`${LOCAL_FORK.artifactName}-`) && name.endsWith('.dmg')).sort()
  if (names.length !== 1) throw new Error('Expected exactly one unsigned local-fork DMG')
  const hashes = []
  for (const name of names) {
    const path = join(paths.unsignedArtifacts, name)
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path)) digest.update(chunk)
    copyFileSync(path, join(artifacts, name))
    hashes.push(`${digest.digest('hex')}  ${name}`)
  }
  writeFileSync(join(artifacts, 'SHA256SUMS.txt'), `${hashes.join('\n')}\n`)
  for (const name of ['SOURCE_SHA.txt', 'source.json', 'signature.txt']) copyFileSync(join(evidence, name), join(artifacts, name))
} else throw new Error('Expected preflight, resources, or collect')
