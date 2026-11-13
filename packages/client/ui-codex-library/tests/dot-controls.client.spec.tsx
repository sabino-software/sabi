// @vitest-environment jsdom
/** Dot visibility requires both independent preferences; settings persist them separately. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DotSettingsRow, DotSidebarRow } from '../src/client/dot-controls.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en)
it.each([[false, false], [false, true], [true, false], [true, true]])('gates Dot with enabled=%s and sidebar=%s', (enabled, showInSidebar) => {
  const props = { t, wide: true, chooseDot: vi.fn(), setDotPreferences: vi.fn(),
    useDot: (selector: (value: object) => unknown) => selector({ preferences: { enabled, showInSidebar },
      busy: false, failed: false, preferencesFailed: false, pending: false }) }
  render(<DotSidebarRow {...props as Parameters<typeof DotSidebarRow>[0]} />)
  expect(screen.queryByRole('button', { name: 'Dot' }) !== null).toBe(enabled && showInSidebar)
})
it('changes sidebar visibility without enabling the integration', async () => {
  const setDotPreferences = vi.fn(async () => {})
  const props = { t, chooseDot: vi.fn(), setDotPreferences,
    useDot: (selector: (value: object) => unknown) => selector({ preferences: { enabled: false, showInSidebar: false },
      busy: false, failed: false, preferencesFailed: false, pending: false }) }
  render(<DotSettingsRow {...props as Parameters<typeof DotSettingsRow>[0]} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Show Dot in sidebar' }))
  await waitFor(() => { expect(setDotPreferences).toHaveBeenCalledWith({ enabled: false, showInSidebar: true }) })
})
