/** Fork jobs never allocate upstream runners or acquire publishing/live-API permissions. */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'
import { upstreamWorkflow } from './upstream-workflow-test.ts'

const directory = resolve(import.meta.dirname, '../.github/workflows')
const guard = "github.repository == 'deepseek-ai/deepseek-harness'"
interface Workflow { jobs: Record<string, { if?: string; permissions?: object; steps?: object[] }>; permissions?: object }

it('refuses every inherited job on a fork before any runner or reusable workflow starts', () => {
  const files = readdirSync(directory).filter(name => name.endsWith('.yml') && name !== 'sabi-artifacts.yml')
  expect(files.length).toBeGreaterThanOrEqual(34)
  let jobs = 0
  for (const file of files) {
    const workflow = load(readFileSync(resolve(directory, file), 'utf8')) as Workflow
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.if, `${file}/${name}`).toMatch(new RegExp(`^${guard.replaceAll('.', '\\.')}($| && \\()`))
      const expression = job.if!.replaceAll('needs.*.result', '[]')
      expect(runInNewContext(expression, { github: { repository: 'sabino/sabi' } }, { timeout: 1000 })).toBe(false)
      jobs++
    }
  }
  expect(jobs).toBeGreaterThanOrEqual(84)
})

it('evaluates only the repository guard in upstream policy fixtures, retaining original status and trigger conditions', () => {
  expect(upstreamWorkflow({ jobs: { task: { if: guard } } })).toEqual({ jobs: { task: {} } })
  const original = "!cancelled() && github.event_name == 'pull_request'"
  expect(upstreamWorkflow({ jobs: { task: { if: `${guard} && (${original})` } } }))
    .toEqual({ jobs: { task: { if: original } } })
})

it('keeps fork CI read-only and uses an asserted arm64 runner, frozen dependencies, real packaging, tests and diagnostics', () => {
  const workflow = load(readFileSync(resolve(directory, 'sabi-artifacts.yml'), 'utf8')) as Workflow
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(JSON.stringify(workflow)).not.toContain('secrets.')
  const job = workflow.jobs['macos-arm64']!
  expect(job).toMatchObject({ if: "github.repository != 'deepseek-ai/deepseek-harness'", 'runs-on': 'macos-15' })
  const source = JSON.stringify(job)
  expect(source).toContain('persist-credentials')
  expect(source).toContain('pnpm install --frozen-lockfile')
  expect(source).toContain('package mac-arm64 --unsigned --local-fork')
  expect(source).toContain('vitest run --maxWorkers=2')
  expect(source).not.toContain('--skip-notarization')
  expect(source).not.toContain('continue-on-error')
  expect(job.steps).toContainEqual(expect.objectContaining({ name: 'Retain build and test diagnostics', if: 'always()' }))
})
