/** Controlled headless page exercises the packaged fixed commands with real browser editing and DOM acknowledgements. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { prepareAxiomBrowserBridge } from '../../desktop/scripts/prepare-axiom-browser.ts'
import type { AxiomSendResult, AxiomSnapshot } from '../../desktop/src/axiom-protocol.ts'

it.each([false, true])('uses exact browser editing and preserves drafts with deferred Send: %s', async (deferredSend) => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-content-'))
  const browser = await chromium.launch({ headless: true })
  onTestFinished(async () => { await browser.close(); await rm(root, { recursive: true, force: true }) })
  prepareAxiomBrowserBridge(root)
  const source = await readFile(join(root, 'extension', 'content.js'), 'utf8')
  const page = await browser.newPage()
  const url = 'https://chatgpt.com/dots/headless~fixture'
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Axiom fixture</title>
    <article class="message-row" data-message-id="old-assistant"><div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"><p>Old <strong>original answer</strong></p></div></div></div><div class="message-inline-actions">DO_NOT_EXPORT</div></div></article>
    <div role="textbox" contenteditable="true" aria-label="Message"></div><button aria-label="Send" disabled>Send</button>
    <script>
      const composer = document.querySelector('[role=textbox]'); const send = document.querySelector('button');
      const updateSend = () => { send.disabled = composer.innerText.trim() === '' };
      composer.addEventListener('input', () => { if (${deferredSend}) setTimeout(updateSend, 50); else updateSend() });
      send.addEventListener('click', () => {
        const article = document.createElement('article'); article.className = 'message-row self'; article.dataset.messageId = 'new-user';
        article.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>';
        article.querySelector('.message-text').innerText = composer.innerText;
        document.body.insertBefore(article, composer); composer.innerText = ''; send.disabled = true;
      });
      window.fixtureListeners = [];
      window.chrome = { runtime: { id: 'fixture-extension', onMessage: {
        addListener: listener => window.fixtureListeners.push(listener), removeListener: listener => { window.fixtureListeners = window.fixtureListeners.filter(value => value !== listener) }
      } } };
      window.fixtureCommand = message => new Promise(resolve => { window.fixtureListeners[0](message, {id: 'fixture-extension'}, resolve) });
    </script>` }))
  await page.goto(url)
  await page.evaluate(source)
  const command = (method: string, args: object = {}): Promise<unknown> => page.evaluate(({ method, args, url }) => {
    const fixture = window as typeof window & { fixtureCommand: (value: object) => Promise<unknown> }
    return fixture.fixtureCommand({ type: 'skeinlet-command', method, args, url })
  }, { method, args, url })
  const initial = await command('snapshot') as AxiomSnapshot
  expect(initial.messages.map(message => message.text)).toEqual(['Old **original answer**'])
  expect(JSON.stringify(initial)).not.toContain('DO_NOT_EXPORT')
  await page.evaluate(() => {
    const first = document.querySelector('article')!
    for (let index = 0; index < 4; index++) {
      const row = first.cloneNode(true) as HTMLElement
      row.dataset.messageId = `older-long-${index}`
      row.querySelector('.message-text')!.textContent = 'a'.repeat(32768)
      first.before(row)
    }
  })
  const before = await command('snapshot') as AxiomSnapshot
  expect(before.messages.at(-1)?.id).toBe('old-assistant')
  expect(before.limited).toBe(true)
  const request = { requestId: 'real-browser-send-1', revision: before.revision, text: 'Exact multiline.\nSecond line.' }
  expect(await command('send', { request: { ...request, revision: before.revision + 1 } })).toMatchObject({ status: 'refused' })
  const result = await command('send', { request: { ...request, requestId: 'real-browser-send-2' } }) as AxiomSendResult
  expect(result).toMatchObject({ status: 'confirmed', messageId: 'new-user' })
  expect(result.snapshot.messages.at(-1)).toMatchObject({ id: 'new-user', role: 'user', text: request.text })
  expect(await page.locator('article.self .message-text').innerText()).toBe(request.text)
  expect(await command('send', { request: { ...request, requestId: 'real-browser-send-2' } })).toMatchObject({ status: 'confirmed' })
  expect(await page.locator('article.self').count()).toBe(1)
  await page.evaluate(() => {
    const row = document.querySelector('article')!.cloneNode(true) as HTMLElement
    row.dataset.messageId = 'new-assistant'
    row.querySelector('.message-text')!.textContent = 'Newest original reply'
    document.querySelector('[role="textbox"]')!.before(row)
  })
  const replied = await command('snapshot') as AxiomSnapshot
  expect(replied.messages.slice(-2).map(message => message.id)).toEqual(['new-user', 'new-assistant'])
  expect(replied.messages.at(-1)?.text).toBe('Newest original reply')
  expect(replied.messages.reduce((size, message) => size + message.text.length, 0)).toBeLessThanOrEqual(131072)
  await page.getByRole('textbox').fill('User-owned draft')
  const draft = await command('snapshot') as AxiomSnapshot
  expect(await command('send', { request: { ...request, requestId: 'real-browser-send-3', revision: draft.revision } })).toMatchObject({ status: 'refused' })
  expect(await page.getByRole('textbox').innerText()).toBe('User-owned draft')
  expect(await page.locator('article.self').count()).toBe(1)
  if (deferredSend) {
    await page.getByRole('textbox').fill('')
    await page.evaluate(() => {
      const composer = document.querySelector('[role="textbox"]') as HTMLElement
      const send = document.querySelector('button[aria-label="Send"]') as HTMLButtonElement
      send.disabled = true
      composer.addEventListener('input', () => {
        setTimeout(() => {
          const until = performance.now() + 2100
          // A suspended or throttled browser can deliver the editing timer after its deadline.
          while (performance.now() < until) { /* Keep this controlled browser task blocked. */ }
          send.disabled = false
        }, 0)
      }, { once: true })
    })
    const timed = await command('snapshot') as AxiomSnapshot
    expect(await command('send', { request: { ...request, requestId: 'real-browser-send-4', revision: timed.revision } })).toMatchObject({ status: 'refused' })
    expect(await page.getByRole('textbox').innerText()).toBe(request.text)
    expect(await page.locator('article.self').count()).toBe(1)
    await page.getByRole('textbox').fill('')
    await page.evaluate(() => {
      const composer = document.querySelector('[role="textbox"]') as HTMLElement
      const send = document.querySelector('button[aria-label="Send"]') as HTMLButtonElement
      send.disabled = true
      composer.addEventListener('input', () => { queueMicrotask(() => { composer.innerText = 'Changed original draft' }) }, { once: true })
    })
    const empty = await command('snapshot') as AxiomSnapshot
    expect(await command('send', { request: { ...request, requestId: 'real-browser-send-5', revision: empty.revision } })).toMatchObject({ status: 'refused' })
    expect(await page.getByRole('textbox').innerText()).toBe('Changed original draft')
    expect(await page.locator('article.self').count()).toBe(1)
    await page.getByRole('textbox').fill('')
    await page.evaluate(() => {
      const composer = document.querySelector('[role="textbox"]') as HTMLElement
      const send = document.querySelector('button[aria-label="Send"]') as HTMLButtonElement
      send.disabled = true
      composer.addEventListener('input', () => { queueMicrotask(() => { composer.replaceWith(composer.cloneNode(true)) }) }, { once: true })
    })
    const replaced = await command('snapshot') as AxiomSnapshot
    expect(await command('send', { request: { ...request, requestId: 'real-browser-send-6', revision: replaced.revision } })).toMatchObject({ status: 'refused' })
    expect(await page.getByRole('textbox').innerText()).toBe(request.text)
    expect(await page.locator('article.self').count()).toBe(1)
  }
})
