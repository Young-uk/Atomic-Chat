import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { AudioPlayer } from '../AudioPlayer'

// The seek bar is a Radix slider, which measures its thumb.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SRC = 'asset://localhost/%2Fdata%2Faudios%2Fclip.wav'

describe('AudioPlayer switching clips (QA 2.3.2)', () => {
  let load: ReturnType<typeof vi.spyOn>

  beforeAll(() => {
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver
  })

  beforeEach(() => {
    vi.useFakeTimers()
    load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    load.mockRestore()
  })

  it('shows the known length and an enabled Play at once, and no spinner for a quick load', () => {
    const { container } = render(
      <AudioPlayer src={SRC} mediaType="audio/wav" durationHint={30.2} />
    )
    const play = screen.getByRole('button', { name: 'Play' })

    expect(screen.getByText('0:00 / 0:30')).toBeInTheDocument()
    expect(play).toBeEnabled()
    expect(container.querySelector('.animate-spin')).toBeNull()
    // The element loads its first source itself; a second load() would restart it.
    expect(load).not.toHaveBeenCalled()

    act(() => {
      fireEvent(container.querySelector('audio')!, new Event('canplay'))
      vi.advanceTimersByTime(1000)
    })
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('shows the spinner only once a load is slow', () => {
    const { container } = render(
      <AudioPlayer src={SRC} mediaType="audio/wav" />
    )

    act(() => vi.advanceTimersByTime(299))
    expect(container.querySelector('.animate-spin')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  it('returns to Play when metadata-only preload stops before canplay', () => {
    const { container } = render(
      <AudioPlayer src={SRC} mediaType="audio/wav" durationHint={5} />
    )

    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('.animate-spin')).not.toBeNull()
    fireEvent.loadedMetadata(container.querySelector('audio')!)

    const play = screen.getByRole('button', { name: 'Play' })
    expect(play).toHaveAttribute('aria-busy', 'false')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('reloads when the same player is given another clip', () => {
    const { container, rerender } = render(
      <AudioPlayer src={SRC} mediaType="audio/wav" />
    )
    const audio = container.querySelector('audio')!
    Object.defineProperty(audio, 'duration', { configurable: true, value: 30 })
    fireEvent.loadedMetadata(audio)
    expect(screen.getByText('0:00 / 0:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-busy',
      'false'
    )

    rerender(<AudioPlayer src={`${SRC}?next`} mediaType="audio/wav" />)

    expect(container.querySelector('audio')).toBe(audio)
    expect(audio).toHaveAttribute('src', `${SRC}?next`)
    expect(audio.querySelector('source')).toHaveAttribute('src', `${SRC}?next`)
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
    act(() => vi.advanceTimersByTime(300))
    expect(container.querySelector('.animate-spin')).not.toBeNull()

    Object.defineProperty(audio, 'duration', { configurable: true, value: 12 })
    fireEvent.loadedMetadata(audio)
    expect(screen.getByText('0:00 / 0:12')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '12')
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})
