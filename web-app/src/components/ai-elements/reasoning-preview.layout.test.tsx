import { act, fireEvent, render } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { beforeEach, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { MessageItem } from '@/containers/MessageItem'
import { useReasoningAutoScroll } from '@/hooks/useReasoningAutoScroll'
import { seedServiceHub } from '@/test/service-hub'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ReasoningViewport,
} from './reasoning'
import {
  DEFAULT_FONT_SIZE,
  XL_FONT_SIZE,
  expectNoHorizontalOverflow,
  setFontSize,
  setTheme,
  settle,
  withTranslations,
} from '@/test/layout'

it.each(
  [1024, 1280].flatMap((width) =>
    [DEFAULT_FONT_SIZE, XL_FONT_SIZE].flatMap((font) =>
      (['light', 'dark'] as const).map((theme) => ({ width, font, theme }))
    )
  )
)(
  'keeps the preview through the turn, then collapses it at $width / $font / $theme',
  async ({ width, font, theme }) => {
    await page.viewport(width, 800)
    setFontSize(font)
    setTheme(theme)
    const text =
      '**A meaningful observation**\n' +
      'Long reasoning content with a long_unbroken_identifier_'.repeat(200)
    const view = (active: boolean, thinking = active) => (
      <div style={{ marginLeft: 256, padding: 24 }}>
        <Reasoning livePreview defaultOpen={false} isStreaming={thinking} isTurnActive={active}>
          <ReasoningTrigger />
          <ReasoningViewport>
            <ReasoningContent isStreaming={thinking}>{text}</ReasoningContent>
          </ReasoningViewport>
        </Reasoning>
        <div data-testid="after">Visible answer</div>
      </div>
    )
    const { container, rerender, getByRole, getByTestId } = render(view(true))
    await settle(container)
    const panel = container.querySelector<HTMLElement>(
      '[data-reasoning-viewport]'
    )!
    const height = panel.getBoundingClientRect().height
    expect(height).toBeGreaterThan(50)
    expect(height).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(document.documentElement).fontSize) * 10 + 1
    )
    const restingOpacity = parseFloat(
      getComputedStyle(container.querySelector('[data-atomic-find-reasoning]')!)
        .opacity
    )
    expect(restingOpacity).toBeCloseTo(0.67, 2)
    const before = getByTestId('after').getBoundingClientRect().top
    rerender(view(true, false))
    await settle(container)
    expect(panel.getBoundingClientRect().height).toBeCloseTo(height, 0)
    expect(getByTestId('after').getBoundingClientRect().top).toBeCloseTo(
      before,
      0
    )
    rerender(view(false))
    await settle(container)
    expect(panel.getBoundingClientRect().height).toBe(0)
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    rerender(view(true))
    await settle(container)
    fireEvent.click(getByRole('button'))
    await settle(container)
    rerender(view(true))
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    })
    expect(panel.getBoundingClientRect().height).toBe(0)
    fireEvent.click(getByRole('button'))
    await settle(container)
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(height)
    const manualHeight = panel.getBoundingClientRect().height
    rerender(view(false))
    await settle(container)
    expect(panel.getBoundingClientRect().height).toBeCloseTo(manualHeight, 0)
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expectNoHorizontalOverflow(container)
  }
)

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: unknown) => unknown) =>
    selector({ selectedModel: { id: 'test-model' } }),
}))
beforeEach(() => seedServiceHub())

it('preserves the working order and collapses automatic previews when the turn finishes', async () => {
  await page.viewport(1280, 800)
  setFontSize(DEFAULT_FONT_SIZE)
  setTheme('dark')
  const parts: UIMessage['parts'] = [
    { type: 'reasoning', text: 'First thought.', state: 'done' },
    { type: 'text', text: 'The evidence suggests a different approach.' },
    {
      type: 'tool-search',
      toolCallId: 'lookup',
      state: 'output-available',
      input: {},
      output: {},
    },
    {
      type: 'reasoning',
      text: 'A second live thought.\n'.repeat(40),
      state: 'streaming',
    },
  ]
  const view = (active: boolean) => (
    <OrderedTimeline parts={parts} active={active} />
  )
  const { container, getByText, rerender } = render(view(true))
  await settle(container)
  const thoughts = container.querySelectorAll<HTMLElement>(
    '[data-atomic-find-reasoning]'
  )
  expect(thoughts).toHaveLength(2)
  const tool = container.querySelector<HTMLElement>(
    '[data-testid="tool-activity-group"]'
  )!
  const positions = [
    thoughts[0],
    getByText('The evidence suggests a different approach.'),
    tool,
    thoughts[1],
  ].map((el) => el.getBoundingClientRect().top)
  expect(
    positions.every((value, index) => !index || value > positions[index - 1])
  ).toBe(true)
  expect(thoughts[0].querySelector('button')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(thoughts[1].querySelector('button')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  const preview = thoughts[1].querySelector<HTMLElement>(
    '[data-reasoning-viewport]'
  )!
  expect(
    preview.scrollHeight - preview.clientHeight - preview.scrollTop
  ).toBeLessThanOrEqual(1)
  const height = thoughts[1].getBoundingClientRect().height
  rerender(view(false))
  await settle(container)
  expect(container.querySelectorAll('[data-atomic-find-reasoning]')[1]).toBe(
    thoughts[1]
  )
  expect(thoughts[1].getBoundingClientRect().height).toBeLessThan(height)
  expect(preview.getBoundingClientRect().height).toBe(0)
  expect(thoughts[1].querySelector('button')).toHaveAttribute('aria-expanded', 'false')
  expect(getByText('Verified outcome.')).toBeVisible()
  expectNoHorizontalOverflow(container)
})

function OrderedTimeline({
  active,
  parts,
}: {
  active: boolean
  parts: UIMessage['parts']
}) {
  const { containerRef, onScroll } = useReasoningAutoScroll(active, parts)
  return withTranslations(
    <div style={{ marginLeft: 256, padding: 24 }}>
      <MessageItem
        message={{
          id: 'ordered',
          role: 'assistant',
          parts: active
            ? parts
            : [
                ...parts.slice(0, -1),
                {
                  ...parts.at(-1)!,
                  state: 'done',
                } as UIMessage['parts'][number],
                { type: 'text', text: 'Verified outcome.' },
              ],
        }}
        isFirstMessage={false}
        isLastMessage
        status={active ? 'streaming' : 'ready'}
        hideActions
        reasoningContainerRef={containerRef}
        onReasoningScroll={onScroll}
      />
    </div>
  )
}
