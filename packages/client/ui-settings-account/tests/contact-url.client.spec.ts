import { expect, it } from 'vitest'
import { ContactConfig } from '../src/contact-config.ts'
import { contactUrl } from '../src/client/contact-url.ts'

it('opens the default form without diagnostic parameters', () => {
  const url = new URL(contactUrl(ContactConfig({})))
  expect(url.origin).toBe('https://trtgsjkv6r.feishu.cn')
  expect(url.search).toBe('')
})

it('removes legacy diagnostics while preserving the destination and unrelated query values', () => {
  const form = new URL('https://example.test/custom/form?topic=help&tag=one&tag=two&note=a%26b#section')
  for (const field of ['uid', 'source', 'harness_version', 'device_info', 'os_version', 'device_brand',
    'app_locale', 'screen_resolution', 'app_version', 'device_model']) {
    form.searchParams.append(`prefill_${field}`, 'private')
    form.searchParams.append(`prefill_${field}`, 'duplicate')
    form.searchParams.set(`hide_${field}`, '1')
  }
  const url = new URL(contactUrl(ContactConfig({ contactFormUrl: form.href })))
  expect(url.origin).toBe(form.origin)
  expect(url.pathname).toBe(form.pathname)
  expect(url.hash).toBe('#section')
  expect([...url.searchParams]).toEqual([
    ['topic', 'help'], ['tag', 'one'], ['tag', 'two'], ['note', 'a&b'],
  ])
})
