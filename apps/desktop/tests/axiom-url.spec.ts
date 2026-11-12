/** Only directly selected original Dot routes are admitted to the native page owner. */
import { expect, it } from 'vitest'
import { axiomConversationUrl } from '../src/axiom-navigation.ts'

it('admits an exact Dot URL without auth or query decorations', () => {
  expect(axiomConversationUrl('https://chatgpt.com/dots/opaque-id~opaque/')).toBe('https://chatgpt.com/dots/opaque-id~opaque')
  for (const url of ['https://example.com/dots/id', 'https://chatgpt.com/auth/login', 'https://chatgpt.com/dots/id?token=private',
    'https://chatgpt.com/dots/id#private', 'https://name:secret@chatgpt.com/dots/id', 'file:///private/auth.json']) {
    expect(() => axiomConversationUrl(url)).toThrow()
  }
})
