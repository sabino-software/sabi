/** Local Axiom bundle through the real Loader, Client slots, store, and Sidebar Browser. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const PLUGIN = fileURLToPath(new URL('../../../plugins/axiom-link', import.meta.url))
const HISTORY = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const HISTORY_ID = 'session-c4421b66-252e-44c0-80ed-6e320abeba25'
const TITLE = 'Axiom link session'
const AXIOM_URL = 'https://chatgpt.com/c/fixture-original-conversation'
const FIXTURE_TITLE = 'Synthetic ChatGPT page fixture'

it.each([true, false])('opens the selected original URL only on request with Browser available=%s and unloads its controls', async (browserAvailable) => {
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(PLUGIN, 'package.json')],
    ...(browserAvailable ? {
      extraOverlayPath: fileURLToPath(new URL('./sidebar-browser.overlay.yml', import.meta.url)),
    } : {}),
  })
  let browser: Browser | undefined
  try {
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    const sessionId = await seedSession(scaffold, await readFile(HISTORY, 'utf8'), HISTORY_ID)
    await workspace.attachSession(sessionId)
    await scaffold.ctx.sessionController.rename({ sessionId, title: TITLE })
    const entryId = await scaffold.ctx.loader.create({ name: '@local/skeinlet-axiom-link' })
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const console = watchConsole(page)
    const navigations: string[] = []
    // Only the remote page is synthetic: never contact ChatGPT or claim authenticated Dot access.
    await page.context().route('https://chatgpt.com/**', async (route) => {
      navigations.push(route.request().url())
      await route.fulfill({ contentType: 'text/html', body: `<h1>${FIXTURE_TITLE}</h1>` })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const row = page.getByRole('treeitem').filter({ has: page.getByText(TITLE, { exact: true }) })
    await row.waitFor({ timeout: 20_000 })
    await row.click()
    const link = page.getByRole('region', { name: 'Axiom link', exact: true })
    await link.waitFor()
    const input = link.getByRole('textbox', { name: 'ChatGPT conversation URL', exact: true })
    expect(await input.inputValue()).toBe('')
    expect(await link.getByRole('button', { name: 'Open Axiom here', exact: true }).count()).toBe(0)
    expect(await link.getByRole('link', { name: 'Open in ChatGPT', exact: true }).count()).toBe(0)
    expect(navigations).toEqual([])

    await input.fill(`${AXIOM_URL}?token=fixture-only`)
    await link.getByRole('button', { name: 'Save link', exact: true }).click()
    await link.getByRole('alert').filter({
      hasText: 'Enter an HTTPS chatgpt.com URL without a query, fragment, or embedded credentials.',
    }).waitFor()
    expect(await link.getByRole('link', { name: 'Open in ChatGPT', exact: true }).count()).toBe(0)
    expect(navigations).toEqual([])

    await input.fill(AXIOM_URL)
    await link.getByRole('button', { name: 'Save link', exact: true }).click()
    const external = link.getByRole('link', { name: 'Open in ChatGPT', exact: true })
    await external.waitFor()
    expect(await external.getAttribute('href')).toBe(AXIOM_URL)
    expect(await external.getAttribute('target')).toBe('_blank')
    expect(await external.getAttribute('rel')).toBe('noopener noreferrer')
    expect(navigations).toEqual([])
    expect(await page.locator('[data-sidebar-browser-frame]').count()).toBe(0)

    // Persistence restores the chosen URL without navigating to it.
    await page.reload({ waitUntil: 'load' })
    await external.waitFor()
    expect(await external.getAttribute('href')).toBe(AXIOM_URL)
    expect(navigations).toEqual([])
    expect(await page.locator('[data-sidebar-browser-frame]').count()).toBe(0)

    await link.getByRole('button', { name: 'Open Axiom here', exact: true }).click()
    if (browserAvailable) {
      await page.frameLocator('[data-sidebar-browser-frame]').getByRole('heading', { name: FIXTURE_TITLE }).waitFor()
      expect(await page.locator('[data-sidebar-browser-frame]').getAttribute('src')).toBe(AXIOM_URL)
      expect(navigations).toEqual([AXIOM_URL])
    } else {
      await link.getByRole('alert').filter({ hasText: 'The Browser tab is unavailable. Use Open in ChatGPT.' }).waitFor()
      expect(navigations).toEqual([])
      expect(await page.locator('[data-sidebar-browser-frame]').count()).toBe(0)
      const [popup] = await Promise.all([page.waitForEvent('popup'), external.click()])
      await popup.getByRole('heading', { name: FIXTURE_TITLE }).waitFor()
      expect(popup.url()).toBe(AXIOM_URL)
      expect(navigations).toEqual([AXIOM_URL])
      await popup.close()
    }

    scaffold.ctx.loader.remove(entryId)
    await expect.poll(() => link.count()).toBe(0)
    await expect.poll(() => page.locator('style').filter({ hasText: '.skeinlet-axiom{' }).count()).toBe(0)
    if (browserAvailable) {
      // The Browser tab belongs to Harness, so removing the opener preserves it.
      await page.frameLocator('[data-sidebar-browser-frame]').getByRole('heading', { name: FIXTURE_TITLE }).waitFor()
    }
    expect(navigations).toEqual([AXIOM_URL])
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 60_000)
