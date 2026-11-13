/** Welcome preload admits only the declared public brands, keeping arbitrary arguments out of the renderer. */
import { afterEach, expect, it, vi } from 'vitest'
import type { WelcomeApi } from '../src/welcome-api.ts'

const bridge = vi.hoisted(() => vi.fn<(name: string, api: WelcomeApi) => void>())
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: bridge }, ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }))
afterEach(() => {vi.unstubAllGlobals(); vi.clearAllMocks()})

it.each(['Sabi', 'Skeinlet', 'Unknown', 'Sabi<script>'])('admits only known welcome product %s', async (product) => {
  vi.resetModules()
  vi.stubGlobal('process', { ...process, argv: ['desktop', '--dsh-welcome-locale=en', `--dsh-welcome-product=${product}`] })
  await import('../src/preload-welcome.ts')
  const api: WelcomeApi = bridge.mock.lastCall![1]
  expect(bridge.mock.lastCall![0]).toBe('dshWelcome')
  if (product === 'Sabi' || product === 'Skeinlet') {
    expect(api.productName).toBe(product)
    expect(api.messages.welcomeBrand).toBe(product)
    expect(api.messages.welcomeSignIn).toBe('Open workspace')
  } else {
    expect(api.productName).toBeUndefined()
    expect(api.messages.welcomeBrand).toBe('DeepSeek Harness')
  }
})
