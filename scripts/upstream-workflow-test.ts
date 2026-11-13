/** Upstream policy suites inspect the existing policy beneath the separately tested fork admission guard. */
const guard = "github.repository == 'deepseek-ai/deepseek-harness'"

/**
 * Project guarded jobs into their upstream context; steps and every original condition remain intact.
 * @param value Parsed workflow used by upstream scheduling and publication assertions.
 * @returns The same parsed workflow with only the exact repository guard evaluated as true.
 */
export function upstreamWorkflow(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('jobs' in value)
    || typeof value.jobs !== 'object' || value.jobs === null) return value
  for (const key of Object.keys(value.jobs)) {
    const job: unknown = Reflect.get(value.jobs, key)
    if (typeof job !== 'object' || job === null || !('if' in job) || typeof job.if !== 'string') continue
    if (job.if === guard) Reflect.deleteProperty(job, 'if')
    else if (job.if.startsWith(`${guard} && (`) && job.if.endsWith(')')) {
      const original = job.if.slice(`${guard} && (`.length, -1)
      job.if = original === 'false' ? false : original === 'true' ? true : original
    }
  }
  return value
}
