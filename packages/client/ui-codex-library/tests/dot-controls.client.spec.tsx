// @vitest-environment jsdom
/** Dot appearance uses shell-owned New Session classes while independent preferences persist. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DotSettingsRow, DotSidebarRow } from '../src/client/dot-controls.tsx'
import type { DotPreferences } from '../src/client/desktop-axiom.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en)
const appearance = {
  wide: true,
  buttonClasses: { sameNewSession: 'new-session-class', subtle: 'subtle-class', outline: 'outline-class' },
  labelMaskClassName: 'mask-class', contentClassName: 'content-class', labelClassName: 'label-class', iconSize: 14,
}
function injected(preferences: DotPreferences) {
  return { t, chooseDot: vi.fn(async () => {}), setDotPreferences: vi.fn(async (_next: DotPreferences) => {}),
    useDot: (selector: (value: object) => unknown) => selector({ preferences,
      busy: false, failed: false, preferencesFailed: false, pending: false }) }
}
it.each([[false, false], [false, true], [true, false], [true, true]])('gates Dot with enabled=%s and sidebar=%s', (enabled, showInSidebar) => {
  const props = { ...appearance, ...injected({ enabled, showInSidebar, sidebarStyle: 'sameNewSession' }) }
  render(<DotSidebarRow {...props as Parameters<typeof DotSidebarRow>[0]} />)
  expect(screen.queryByRole('button', { name: 'Dot' }) !== null).toBe(enabled && showInSidebar)
})
it.each(['sameNewSession', 'subtle', 'outline'] as const)('uses the shell-owned %s appearance', (sidebarStyle) => {
  const props = { ...appearance, ...injected({ enabled: true, showInSidebar: true, sidebarStyle }) }
  render(<DotSidebarRow {...props as Parameters<typeof DotSidebarRow>[0]} />)
  expect(screen.getByRole('button', { name: 'Dot' }).className).toBe(appearance.buttonClasses[sidebarStyle])
  expect(screen.getByText('Dot').className).toBe(appearance.labelClassName)
})
it('changes sidebar visibility without enabling the integration or changing its appearance', async () => {
  const props = injected({ enabled: false, showInSidebar: false, sidebarStyle: 'outline' })
  render(<DotSettingsRow {...props as Parameters<typeof DotSettingsRow>[0]} />)
  fireEvent.click(screen.getByRole('switch', { name: 'Show Dot in sidebar' }))
  await waitFor(() => {
    expect(props.setDotPreferences).toHaveBeenCalledWith({ enabled: false, showInSidebar: true, sidebarStyle: 'outline' })
  })
})
it('offers explicit style choices and preserves both independent switches', async () => {
  const props = injected({ enabled: false, showInSidebar: true, sidebarStyle: 'sameNewSession' })
  render(<DotSettingsRow {...props as Parameters<typeof DotSettingsRow>[0]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dot button style' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Outline' }))
  await waitFor(() => {
    expect(props.setDotPreferences).toHaveBeenCalledWith({ enabled: false, showInSidebar: true, sidebarStyle: 'outline' })
  })
})
