/** Local authorization conversation for the assembled Models settings test. */
import { credentialKey } from '@deepseek-ai/dsh-credentials'

export const name = 'fixture-provider-authorization'
export const inject = ['authorization']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context. */
export function apply(ctx) {
  ctx.effect(() => ctx.authorization.registerFlow({
    key: credentialKey('llm-pi-ai', 'openai-codex'),
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async run(session) {
      session.notify({ message: 'Continue with the local test flow', url: 'https://example.test/codex-login', code: 'LOCAL-CODE' })
      const callback = await session.prompt({ kind: 'secret', message: 'Paste callback code' })
      if (callback !== 'private-callback-code') throw new Error('Unexpected local callback')
      await session.commit({ kind: 'grant', payload: { refreshToken: 'private-refresh-token', accessToken: 'private-access-token' } })
    },
  }), 'fixture-provider-authorization: flow')
}
