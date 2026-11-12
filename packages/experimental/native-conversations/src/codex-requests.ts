/** Native server requests use the exact acknowledged Agent and ordinary Harness human-interaction services. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { CodexJsonObject, CodexServerRequestMethod } from '@deepseek-ai/dsh-host-codex-app-server'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

const text = z.string().max(16000)
const questionSchema = z.object({ id: z.string().min(1).max(200), header: text, question: text,
  isOther: z.boolean(), isSecret: z.boolean(), options: z.array(z.object({ label: text, description: text })).max(20).nullable() })
const questionsSchema = z.object({ questions: z.array(questionSchema).min(1).max(3) })
const permissionSchema = z.object({
  network: z.object({ enabled: z.boolean().nullable() }).strict().nullable(),
  fileSystem: z.object({
    read: z.array(text.refine(isAbsolute)).max(100).nullable(),
    write: z.array(text.refine(isAbsolute)).max(100).nullable(),
  }).strict().nullable(),
}).strict()
const fieldSchema = z.object({ type: z.enum(['string', 'boolean']), title: text.optional(), description: text.optional(),
  enum: z.array(text).min(1).max(20).optional() }).strict()
const formSchema = z.object({ type: z.literal('object'), $schema: text.optional(),
  properties: z.record(z.string().min(1).max(200), fieldSchema), required: z.array(z.string()).optional() }).strict()

function cancelled(method: CodexServerRequestMethod, params?: CodexJsonObject): CodexJsonObject {
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
  if (method === 'item/tool/requestUserInput') return { answers: {} }
  if (method === 'mcpServer/elicitation/request') return { action: 'cancel', content: null, _meta: null }
  if (method === 'applyPatchApproval' || method === 'execCommandApproval') return { decision: 'abort' }
  const offered = params?.availableDecisions
  return { decision: Array.isArray(offered) && !offered.includes('cancel') && offered.includes('decline') ? 'decline' : 'cancel' }
}

function detail(params: CodexJsonObject): string {
  return ['reason', 'command', 'cwd'].flatMap((key) => {
    const value = params[key]
    if (typeof value === 'string') return [`${key}: ${value.slice(0, 16000)}`]
    if (key === 'command' && Array.isArray(value) && value.every(item => typeof item === 'string')) return [`command: ${JSON.stringify(value).slice(0, 16000)}`]
    return []
  }).join('\n\n') || 'Allow this specific Codex operation once?'
}

async function approval(
  ctx: Context, agent: Agent, method: CodexServerRequestMethod, params: CodexJsonObject, signal: AbortSignal,
): Promise<CodexJsonObject> {
  // A one-action answer cannot safely grant a persistent file-write root or policy amendment.
  if (params.grantRoot !== undefined && params.grantRoot !== null) return cancelled(method, params)
  const legacy = method === 'applyPatchApproval' || method === 'execCommandApproval'
  const offered = params.availableDecisions
  if (Array.isArray(offered) && !offered.includes('accept')) return cancelled(method, params)
  const outcome = await ctx.approval.request({ agent, toolName: method.includes('fileChange') || method === 'applyPatchApproval' ? 'Codex file change' : 'Codex command', reason: detail(params), signal })
  signal.throwIfAborted()
  return outcome === 'allowed-once' ? { decision: legacy ? 'approved' : 'accept' }
    : Array.isArray(offered) && !offered.includes('cancel') && offered.includes('decline') ? { decision: 'decline' } : cancelled(method)
}

async function permissions(ctx: Context, agent: Agent, params: CodexJsonObject, signal: AbortSignal): Promise<CodexJsonObject> {
  if (params.environmentId !== undefined && params.environmentId !== null) return cancelled('item/permissions/requestApproval')
  const parsed = permissionSchema.safeParse(params.permissions)
  if (!parsed.success) return cancelled('item/permissions/requestApproval')
  const requested = parsed.data
  const granted: CodexJsonObject = {}
  if (requested.network?.enabled === true) granted.network = { enabled: true }
  if (requested.fileSystem !== null) granted.fileSystem = requested.fileSystem
  if (Object.keys(granted).length === 0) return { permissions: {}, scope: 'turn' }
  const outcome = await ctx.approval.request({ agent, toolName: 'Codex permissions for the current turn only',
    reason: `Grant only the following requested access until this Codex turn ends?\n\n${JSON.stringify(granted, null, 2)}`, signal })
  signal.throwIfAborted()
  return { permissions: outcome === 'allowed-once' ? granted : {}, scope: 'turn' }
}

async function userInput(ctx: Context, agent: Agent, params: CodexJsonObject, signal: AbortSignal): Promise<CodexJsonObject> {
  const parsed = questionsSchema.safeParse(params)
  if (!parsed.success || parsed.data.questions.some(question => question.isSecret)) return { answers: {} }
  const questions = parsed.data.questions
  const answer = await ctx.userQuestions.ask({ agent, signal, questions: questions.map(question => ({
    id: question.id, header: question.header, question: question.question,
    ...question.options === null ? {} : { options: question.options },
  })) })
  signal.throwIfAborted()
  const answers: CodexJsonObject = {}
  for (const value of answer.answers) {
    const question = questions.find(item => item.id === value.id)
    if (question === undefined || answers[value.id] !== undefined) return { answers: {} }
    const options = question.options?.map(option => option.label) ?? []
    if (value.selected.some(selected => !options.includes(selected))) return { answers: {} }
    if (value.custom && question.options !== null && !question.isOther) return { answers: {} }
    answers[value.id] = { answers: [...value.selected, ...value.custom ? [value.custom] : []] }
  }
  return { answers }
}

async function elicitation(ctx: Context, agent: Agent, params: CodexJsonObject, signal: AbortSignal): Promise<CodexJsonObject> {
  const fallback = cancelled('mcpServer/elicitation/request')
  if (typeof params.message !== 'string') return fallback
  const message = params.message
  if (params.mode === 'url') {
    if (typeof params.url !== 'string') return fallback
    let url: URL
    try { url = new URL(params.url) } catch (_invalidUrl: unknown) { return fallback }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fallback
    const answer = await ctx.userQuestions.ask({ agent, signal, questions: [{ id: 'elicitation', header: 'Codex verification',
      question: 'Have you completed this requested flow?', detail: `${message}\n\n${url.href}`,
      options: [{ label: 'Completed' }, { label: 'Cancel' }],
    }] })
    signal.throwIfAborted()
    return answer.answers.some(value => value.id === 'elicitation' && value.selected.length === 1 && value.selected[0] === 'Completed' && !value.custom)
      ? { action: 'accept', content: null, _meta: null } : fallback
  }
  if (typeof params.mode !== 'string' || !['form', 'openai/form', 'openaiForm'].includes(params.mode)) return fallback
  const parsed = formSchema.safeParse(params.requestedSchema)
  if (!parsed.success) return fallback
  const properties = Object.entries(parsed.data.properties)
  const required = new Set(parsed.data.required ?? [])
  if (properties.length > 3 || [...required].some(name => !(name in parsed.data.properties))) return fallback
  if (properties.length === 0) {
    const outcome = await ctx.approval.request({ agent, toolName: 'Codex MCP action', reason: message, signal })
    signal.throwIfAborted()
    return outcome === 'allowed-once' ? { action: 'accept', content: {}, _meta: null } : fallback
  }
  if (properties.some(([name, field]) => /password|secret|token|credential|api.?key|challenge/i.test(`${name} ${field.title ?? ''}`)
    || field.type === 'boolean' && field.enum !== undefined || field.enum?.includes('Omit this optional field'))) return fallback
  const questions: AskUserQuestionItem[] = properties.map(([name, field]) => ({
    id: name, question: field.title ?? name, detail: [message, field.description].filter(Boolean).join('\n\n'),
    ...(field.type === 'boolean' || field.enum !== undefined || !required.has(name) ? { options: [
      ...(field.type === 'boolean' ? ['True', 'False'] : field.enum ?? []).map(label => ({ label })),
      ...required.has(name) ? [] : [{ label: 'Omit this optional field' }],
    ] } : {}),
  }))
  const answer = await ctx.userQuestions.ask({ agent, signal, questions })
  signal.throwIfAborted()
  const values: CodexJsonObject = {}
  const seen = new Set<string>()
  for (const value of answer.answers) {
    const field = parsed.data.properties[value.id]
    if (field === undefined || seen.has(value.id) || value.selected.length > 1) return fallback
    seen.add(value.id)
    const chosen = value.selected[0]
    if (!required.has(value.id) && chosen === 'Omit this optional field' && !value.custom) continue
    if (field.type === 'boolean') {
      if (value.custom || chosen !== 'True' && chosen !== 'False') return fallback
      values[value.id] = chosen === 'True'
    } else {
      const text = value.custom || chosen
      if (text === undefined || field.enum !== undefined && !field.enum.includes(text)) return fallback
      values[value.id] = text
    }
  }
  if ([...required].some(name => values[name] === undefined)) return fallback
  return { action: 'accept', content: values, _meta: null }
}

/**
 * Install fail-closed native requests; cards are serialized per exact owning Agent.
 * @param ctx - Owner context with native transport, approvals, and user questions.
 * @param ownerOf - Await the exact turn/start acknowledgement and reject other clients' requests.
 */
export function registerCodexRequests(
  ctx: Context, ownerOf: (params: CodexJsonObject, signal: AbortSignal) => Promise<Agent | undefined>,
): void {
  const lifetime = new AbortController()
  const queues = new Map<Agent, Promise<void>>()
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...queues.values()]) })
  for (const method of [
    'item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval',
    'applyPatchApproval', 'execCommandApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request',
  ] as const) {
    ctx.effect(() => ctx.codexAppServer.setRequestHandler(method, async (params, request) => {
      const signal = AbortSignal.any([lifetime.signal, request.signal])
      try {
        const agent = await ownerOf(params, signal)
        if (agent === undefined || signal.aborted) return cancelled(method, params)
        const prior = queues.get(agent) ?? Promise.resolve()
        const pending = prior.then(() => ctx.agents.withInitiator(agent, async () => {
          signal.throwIfAborted()
          if (method === 'item/permissions/requestApproval') return permissions(ctx, agent, params, signal)
          if (method === 'item/tool/requestUserInput') return userInput(ctx, agent, params, signal)
          if (method === 'mcpServer/elicitation/request') return elicitation(ctx, agent, params, signal)
          return approval(ctx, agent, method, params, signal)
        }))
        const settled = pending.then(() => {}, () => {})
        queues.set(agent, settled)
        try { return await pending }
        finally { if (queues.get(agent) === settled) queues.delete(agent) }
      } catch (_unavailableOrCancelled: unknown) { return cancelled(method, params) }
    }))
  }
}
