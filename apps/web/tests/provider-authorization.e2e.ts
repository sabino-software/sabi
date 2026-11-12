/** Models footer sign-in over the real browser/Host wire with a local authorization flow. */
import { fileURLToPath } from 'node:url'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, openSettings } from './support.ts'

it('signs into Codex from Models settings, cancels safely, and removes the saved grant', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/provider-authorization/overlay.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  const received: string[] = []
  page.on('websocket', (socket) => { socket.on('framereceived', (frame) => { received.push(String(frame.payload)) }) })
  const key = credentialKey('llm-pi-ai', 'openai-codex')
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Models', exact: true }).click()
  const authorization = settings.getByRole('region', { name: 'Provider sign-in', exact: true })
  await authorization.waitFor()
  await authorization.getByText('ChatGPT (Codex)', { exact: true }).waitFor()
  await authorization.getByText('No saved sign-in', { exact: true }).waitFor()
  const signIn = authorization.getByRole('button', { name: 'Sign in with ChatGPT', exact: true })
  await signIn.click()
  const callback = authorization.getByLabel('Paste callback code', { exact: true })
  await callback.waitFor()
  expect(await callback.getAttribute('type')).toBe('password')
  expect(await authorization.getByRole('link', { name: 'Open sign-in page' }).getAttribute('href'))
    .toBe('https://example.test/codex-login')
  await authorization.getByText('LOCAL-CODE', { exact: true }).waitFor()
  await callback.fill('cancelled-private-code')
  await authorization.getByRole('button', { name: 'Cancel', exact: true }).click()
  await authorization.getByText('Sign-in cancelled.', { exact: true }).waitFor()
  await expect.poll(() => callback.count()).toBe(0)
  expect(await scaffold.ctx.credentials.readRecord(key)).toBeUndefined()

  await signIn.click()
  await callback.waitFor()
  expect(await callback.inputValue()).toBe('')
  await callback.fill('private-callback-code')
  await authorization.getByRole('button', { name: 'Continue', exact: true }).click()
  await authorization.getByText('Sign-in saved', { exact: true }).waitFor()
  await expect.poll(() => callback.count()).toBe(0)
  expect(await scaffold.ctx.credentials.readRecord(key)).toMatchObject({ kind: 'grant' })
  const signOut = authorization.getByRole('button', { name: 'Sign out', exact: true })
  await signOut.waitFor()

  for (const secret of ['private-callback-code', 'cancelled-private-code', 'private-refresh-token', 'private-access-token']) {
    expect(await page.content()).not.toContain(secret)
    expect(received.join('\n')).not.toContain(secret)
  }
  await signOut.click()
  const confirmation = page.getByRole('dialog', { name: 'Remove saved sign-in?', exact: true })
  await confirmation.getByRole('button', { name: 'Sign out', exact: true }).click()
  await confirmation.waitFor({ state: 'detached' })
  await authorization.getByText('No saved sign-in', { exact: true }).waitFor()
  await expect.poll(() => scaffold.ctx.credentials.readRecord(key)).toBeUndefined()
  expect(await signOut.count()).toBe(0)
  expect(tripwire.pageErrors).toEqual([])
})
