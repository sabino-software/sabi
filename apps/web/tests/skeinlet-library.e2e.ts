/** Assembled local source library, with synthetic source data and the real browser. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('lists and reads existing source messages without exposing a composer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skeinlet-library-web-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const catalog = new DatabaseSync(join(root, 'state_5.sqlite'))
  catalog.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, history_mode TEXT);
    INSERT INTO threads VALUES ('fixture-chat', NULL, 'Fixture coding task', '/fixture/repo', 1700000000, 0, 'paginated');`)
  catalog.close()
  const history = new DatabaseSync(join(root, 'thread_history_1.sqlite'))
  history.exec('CREATE TABLE thread_items (thread_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT)')
  history.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)').run('fixture-chat', 'message-one', 1, 1700000000000,
    JSON.stringify({ type: 'userMessage', content: [{ type: 'text', text: 'Show the existing source question.' }] }), 'userMessage')
  history.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)').run('fixture-chat', 'message-two', 2, 1700000000100,
    JSON.stringify({ type: 'agentMessage', text: 'The preserved **source answer**.' }), 'agentMessage')
  history.close()
  const overlay = join(root, 'source.overlay.yml')
  await writeFile(overlay, `- id: codex-library-controller\n  config:\n    sourceHome: ${JSON.stringify(root)}\n`)
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  const direct = page.getByRole('button', { name: 'Codex chats', exact: true })
  if (await direct.count() > 0) await direct.click()
  else {
    await page.getByRole('button', { name: 'More', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Codex chats', exact: true }).click()
  }
  await page.getByRole('heading', { name: 'Codex chats', exact: true }).waitFor()
  await page.getByRole('button', { name: /Fixture coding task/ }).click()
  await page.getByText('Show the existing source question.', { exact: true }).waitFor()
  await page.getByText('source answer', { exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Send message', exact: true }).count()).toBe(0)
  expect(await page.getByText('Read-only source', { exact: true }).count()).toBe(1)
  expect(console.pageErrors).toEqual([])
})
