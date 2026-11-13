// @vitest-environment jsdom
/** Browser viewport behavior across estimated prepends and later variable-height Markdown measurement. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DotPage } from '../src/client/dot-page.tsx'
import { emptyDotState, type DotState } from '../src/client/dot-controller.ts'
import type { DotMessage, DotSnapshot } from '../src/client/desktop-axiom.ts'
import { en } from '../src/client/locales.ts'

interface Options { count: number; getScrollElement(): HTMLElement | null; getItemKey(index: number): string | number }
const virtual = vi.hoisted(() => ({ options: null as Options | null, heights: new Map<string, number>(),
  rows: [] as { key: string | number; index: number; start: number; end: number; size: number }[] }))
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: (options: Options) => {
  virtual.options = options
  let start = 0
  virtual.rows = Array.from({ length: options.count }, (_, index) => {
    const key = options.getItemKey(index)
    const size = virtual.heights.get(String(key)) ?? 120
    const row = { key, index, start, size, end: start + size }
    start += size
    return row
  })
  return {
    measurementsCache: virtual.rows,
    getVirtualItems: () => virtual.rows,
    getTotalSize: () => virtual.rows.at(-1)?.end ?? 0,
    measureElement: () => {},
    scrollToOffset: (offset: number) => { const node = options.getScrollElement(); if (node !== null) node.scrollTop = offset },
    scrollToIndex: (index: number) => {
      const node = options.getScrollElement()
      if (node !== null) node.scrollTop = Math.max(0, (virtual.rows[index]?.end ?? 0) - node.clientHeight)
    },
  }
} }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  MarkdownText: ({ text }: { text: string }) => <p>{text}</p>,
}))
afterEach(() => { cleanup(); virtual.heights.clear() })
const message = (id: string): DotMessage => ({ id, role: 'assistant', text: id, timestamp: null, truncated: false })
const snapshot: DotSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/original', title: 'Axiom', revision: 1,
  phase: 'ready', messages: [], canSend: true, draftPresent: false, siteStatus: null, limited: true }

it('preserves the same source row and pixel offset through prepend and later measurements; initial auto-scroll never loads history', () => {
  const initial = Array.from({ length: 8 }, (_, index) => message(`source-${index}`))
  let state: DotState = { ...emptyDotState, preferences: { enabled: true, showInSidebar: true, sidebarStyle: 'sameNewSession' },
    selection: { url: snapshot.url!, title: 'Axiom' }, snapshot, messages: initial }
  const waiting = Promise.withResolvers<undefined>()
  const loadDotHistory = vi.fn(() => waiting.promise)
  const props = { t: makeTranslate(en), useDot: (selector: (value: DotState) => unknown) => selector(state),
    setDotDraft: vi.fn(), sendDot: vi.fn(async () => {}), loadDotHistory, showDotOriginal: vi.fn(async () => {}) }
  const page = () => <DotPage {...props as Parameters<typeof DotPage>[0]} />
  const view = render(page())
  const viewport = screen.getByLabelText('Dot conversation')
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 240 })
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => virtual.rows.at(-1)?.end ?? 0 })
  viewport.scrollTop = 50
  fireEvent.scroll(viewport)
  expect(loadDotHistory).not.toHaveBeenCalled()
  const sourceRow = view.container.querySelector('[data-dot-message-id="source-0"]')!
  const rowPixelOffset = (): number => {
    const transform = (sourceRow as HTMLElement).style.transform
    return Number(/translateY\(([-\d.]+)px\)/.exec(transform)?.[1]) - viewport.scrollTop
  }
  const before = rowPixelOffset()
  fireEvent.wheel(viewport, { deltaY: -30 })
  fireEvent.scroll(viewport)
  expect(loadDotHistory).toHaveBeenCalledOnce()
  state = { ...state, history: 'loading' }
  view.rerender(page())
  virtual.heights.set('older-long', 100)
  virtual.heights.set('older-short', 100)
  state = { ...state, history: 'ready', messages: [message('older-long'), message('older-short'), ...initial] }
  view.rerender(page())
  expect(view.container.querySelector('[data-dot-message-id="source-0"]')).toBe(sourceRow)
  expect(rowPixelOffset()).toBe(before)
  // A second layout pass replaces estimates with measured, unequal Markdown heights.
  virtual.heights.set('older-long', 420)
  virtual.heights.set('older-short', 80)
  view.rerender(page())
  expect(rowPixelOffset()).toBe(before)
  const readingOffset = viewport.scrollTop
  state = { ...state, messages: [...state.messages, message('autonomous-update')] }
  view.rerender(page())
  expect(viewport.scrollTop).toBe(readingOffset)
  expect(loadDotHistory).toHaveBeenCalledOnce()
  waiting.resolve(undefined)
})
