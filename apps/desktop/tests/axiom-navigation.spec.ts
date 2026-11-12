/** Authentication navigation stays on official origins and returns to the selected Dot. */
import { describe, expect, it } from 'vitest'
import { axiomNavigation } from '../src/axiom-navigation.ts'

const selected = 'https://chatgpt.com/dots/selected~conversation'

describe('Axiom authentication navigation', () => {
  it('admits the exact OpenAI issuer and ChatGPT authentication callbacks', () => {
    for (const destination of ['https://auth.openai.com/log-in', 'https://auth.openai.com/authorize?state=opaque',
      'https://chatgpt.com/auth/login', 'https://chatgpt.com/api/auth/callback/openai?code=opaque']) {
      expect(axiomNavigation(destination, selected, false)).toBe('authentication')
    }
  })

  it('returns only to the selected conversation or an observed authentication landing', () => {
    expect(axiomNavigation(selected, selected, false)).toBe('conversation')
    expect(axiomNavigation(`${selected}/`, selected, true)).toBe('conversation')
    expect(axiomNavigation('https://chatgpt.com/?auth=complete', selected, true)).toBe('return')
    expect(axiomNavigation('https://chatgpt.com/', selected, false)).toBe('blocked')
    for (const destination of ['https://chatgpt.com/dots/other', 'https://chatgpt.com/c/other',
      `${selected}?code=opaque`, 'https://chatgpt.com/authentication']) {
      expect(axiomNavigation(destination, selected, true)).toBe('blocked')
    }
  })

  it('rejects lookalikes, arbitrary OpenAI subdomains, external identity providers and unsafe URLs', () => {
    for (const destination of ['https://auth.openai.com.evil.test/login', 'https://auth-openai.com/login',
      'https://api.openai.com/login', 'https://accounts.google.com/login', 'https://login.microsoftonline.com/login',
      'http://auth.openai.com/login', 'https://auth.openai.com:8443/login',
      'https://user:secret@auth.openai.com/login', 'file:///private/auth.json', 'javascript:alert(1)', 'invalid']) {
      expect(axiomNavigation(destination, selected, true)).toBe('blocked')
    }
  })
})
