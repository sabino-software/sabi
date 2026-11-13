// @vitest-environment jsdom
/** The blank landing uses the selected build's identity without changing upstream branding. */
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HeroShell } from '../src/client/skeleton/EmptyHero.tsx'
import { en } from '../src/client/locales.ts'

const renderSlot = (_key: string, _owner: object, options?: { fallback?: ReactNode }): ReactNode => options?.fallback
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

it('shows the Sabi name and existing theme-aware mark on the fork landing', () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'skeinlet')
  vi.stubEnv('DSH_CLIENT_TITLE', 'Sabi')
  const view = render(<HeroShell t={makeTranslate(en)} renderSlot={renderSlot as never} />)
  expect(screen.getByText('Sabi')).toBeTruthy()
  expect(screen.queryByText('Into the Unknown')).toBeNull()
  expect(view.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 64 64')
  expect(view.container.querySelector('path')?.getAttribute('stroke')).toBe('currentColor')
  expect(view.container.querySelector('animate')).toBeNull()
})

it('preserves the official landing headline and whale independently of an inherited custom title', () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
  vi.stubEnv('DSH_CLIENT_TITLE', 'Sabi')
  const view = render(<HeroShell t={makeTranslate(en)} renderSlot={renderSlot as never} />)
  expect(screen.getByText('Into the Unknown')).toBeTruthy()
  expect(screen.queryByText('Sabi')).toBeNull()
  expect(view.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
})
