/** Controlled headless page exercises the packaged fixed commands with real browser editing and DOM acknowledgements. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { prepareAxiomBrowserBridge } from '../../desktop/scripts/prepare-axiom-browser.ts'
import type { AxiomSendResult, AxiomSnapshot } from '../../desktop/src/axiom-protocol.ts'

it('uses browser editing for exact multiline text, refuses stale or existing drafts and acknowledges only new original rows', async () => {
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
      composer.addEventListener('input', () => { send.disabled = composer.innerText.trim() === '' });
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
  const before = await command('snapshot') as AxiomSnapshot
  expect(before.messages.map(message => message.text)).toEqual(['Old **original answer**'])
  expect(JSON.stringify(before)).not.toContain('DO_NOT_EXPORT')
  const request = { requestId: 'real-browser-send-1', revision: before.revision, text: 'Exact multiline.\nSecond line.' }
  expect(await command('send', { request: { ...request, revision: before.revision + 1 } })).toMatchObject({ status: 'refused' })
  const result = await command('send', { request: { ...request, requestId: 'real-browser-send-2' } }) as AxiomSendResult
  expect(result).toMatchObject({ status: 'confirmed', messageId: 'new-user' })
  expect(await page.locator('article.self .message-text').innerText()).toBe(request.text)
  expect(await command('send', { request: { ...request, requestId: 'real-browser-send-2' } })).toMatchObject({ status: 'confirmed' })
  expect(await page.locator('article.self').count()).toBe(1)
  await page.getByRole('textbox').fill('User-owned draft')
  const draft = await command('snapshot') as AxiomSnapshot
  expect(await command('send', { request: { ...request, requestId: 'real-browser-send-3', revision: draft.revision } })).toMatchObject({ status: 'refused' })
  expect(await page.getByRole('textbox').innerText()).toBe('User-owned draft')
  expect(await page.locator('article.self').count()).toBe(1)
})
