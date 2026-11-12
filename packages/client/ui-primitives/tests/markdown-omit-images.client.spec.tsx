// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

const text = [
  'Before ![inline diagram](https://example.com/inline.png) after.',
  '![reference diagram][diagram]\n\n[diagram]: https://example.com/reference.png',
  '![local diagram](/workspace/diagram.png)',
  '![](https://example.com/last.png)',
  'Tail one.',
  'Tail two.',
].join('\n\n')

describe('MarkdownText image omission', () => {
  it.each([false, true])('retains alt text without image elements or source resolution with streaming=%s', (streaming) => {
    const resolve = vi.fn(() => 'https://example.com/rewritten.png')
    const view = render(<MarkdownText text={text} streaming={streaming} omitImages pathImages={{ resolve }} />)

    expect(view.container.querySelectorAll('img')).toHaveLength(0)
    expect(view.container.textContent).toContain('Before inline diagram after.')
    expect(view.container.textContent).toContain('reference diagram')
    expect(view.container.textContent).toContain('local diagram')
    expect(view.container.textContent).not.toContain('https://example.com/last.png')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('preserves normal image rendering by default and rebuilds settled results when the choice changes', () => {
    const source = '![inline](https://example.com/inline.png) ![reference][image]\n\n[image]: https://example.com/reference.png'
    const view = render(<MarkdownText text={source} />)
    expect([...view.container.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
      'https://example.com/inline.png', 'https://example.com/reference.png',
    ])

    view.rerender(<MarkdownText text={source} omitImages />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toBe('inline reference')

    view.rerender(<MarkdownText text={source} />)
    expect(view.container.querySelectorAll('img')).toHaveLength(2)
  })

  it('rebuilds frozen streaming image blocks when omission changes and retains omission as text grows and settles', () => {
    const view = render(<MarkdownText text={text} streaming />)
    expect(view.container.querySelectorAll('img').length).toBeGreaterThan(0)

    view.rerender(<MarkdownText text={text} streaming omitImages />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('inline diagram')
    expect(view.container.textContent).toContain('reference diagram')

    const grown = `${text}\n\n![new image](https://example.com/new.png)`
    view.rerender(<MarkdownText text={grown} streaming omitImages />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('new image')

    view.rerender(<MarkdownText text={grown} omitImages />)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain('reference diagram')

    view.rerender(<MarkdownText text={grown} streaming />)
    expect(view.container.querySelectorAll('img').length).toBeGreaterThan(0)
  })
})
