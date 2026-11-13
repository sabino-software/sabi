/** Authentication navigation stays on official origins and returns to the selected Dot. */
import { describe, expect, it } from 'vitest'
import { axiomChooserNavigation, axiomNavigation } from '../src/axiom-navigation.ts'

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

  it('rejects lookalikes, arbitrary OpenAI subdomains, hidden identity flows and unsafe URLs', () => {
    for (const destination of ['https://auth.openai.com.evil.test/login', 'https://auth-openai.com/login',
      'https://api.openai.com/login', 'https://accounts.google.com/login', 'https://login.microsoftonline.com/login',
      'https://accounts.google.com.evil.test/login', 'https://appleid.apple.com.evil.test/auth',
      'https://login.microsoftonline.com:8443/common', 'https://user:secret@login.live.com/oauth20_authorize.srf',
      'http://auth.openai.com/login', 'https://auth.openai.com:8443/login',
      'https://user:secret@auth.openai.com/login', 'file:///private/auth.json', 'javascript:alert(1)', 'invalid']) {
      expect(axiomNavigation(destination, selected, true)).toBe('blocked')
    }
  })
  it('admits exact documented identity origins only during an explicitly revealed OpenAI authentication flow', () => {
    for (const destination of ['https://accounts.google.com/o/oauth2/v2/auth?state=private',
      'https://appleid.apple.com/auth/authorize?state=private',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=private',
      'https://login.live.com/oauth20_authorize.srf?state=private']) {
      expect(axiomNavigation(destination, selected, false, false)).toBe('blocked')
      expect(axiomNavigation(destination, selected, true, false)).toBe('blocked')
      expect(axiomNavigation(destination, selected, false, true)).toBe('blocked')
      expect(axiomNavigation(destination, selected, true, true)).toBe('authentication')
    }
    for (const destination of ['https://accounts.google.com.evil.test/login',
      'https://appleid.apple.com:8443/auth', 'https://login.microsoft.com/login', 'https://tenant.example.com/sso',
      'https://user:secret@login.live.com/login', 'http://accounts.google.com/login']) {
      expect(axiomNavigation(destination, selected, true, true)).toBe('blocked')
    }
  })

})

it('admits unobserved ChatGPT selection pages only in a revealed chooser and keeps the identity allowlist', () => {
  for (const destination of ['https://chatgpt.com/', 'https://chatgpt.com/dots', 'https://chatgpt.com/c/other']) {
    expect(axiomChooserNavigation(destination, false, true)).toBe('selection')
    expect(axiomChooserNavigation(destination, false, false)).toBe('blocked')
  }
  expect(axiomChooserNavigation(selected, false, true)).toBe('conversation')
  expect(axiomChooserNavigation(`${selected}?private=opaque`, false, true)).toBe('selection')
  expect(axiomChooserNavigation('https://accounts.google.com/sign-in', false, true)).toBe('blocked')
  expect(axiomChooserNavigation('https://accounts.google.com/sign-in', true, true)).toBe('authentication')
  for (const destination of ['https://evil.test/', 'https://chatgpt.com.evil.test/', 'https://user:secret@chatgpt.com/', 'http://chatgpt.com/']) {
    expect(axiomChooserNavigation(destination, true, true)).toBe('blocked')
  }
})
