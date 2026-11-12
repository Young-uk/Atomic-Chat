/* eslint-disable react-refresh/only-export-components */
import { useFindDisclosure } from '@/lib/find-reveal'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { IconBulb } from '@tabler/icons-react'
import { ChevronDownIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  createContext,
  memo,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import remarkGfm from 'remark-gfm'

// Reasoning uses its own renderer. Match the answer renderer's single-tilde
// policy so conversational tildes and numeric ranges stay literal here too.
// Keep explicit ~~strikethrough~~ and all other default plugins unchanged.
const REASONING_GFM: NonNullable<
  ComponentProps<typeof Streamdown>['remarkPlugins']
>[number] = [remarkGfm, { singleTilde: false }]
const REASONING_REMARK_PLUGINS = Object.values({
  ...defaultRemarkPlugins,
  gfm: REASONING_GFM,
})

type ReasoningContextValue = {
  isStreaming: boolean
  isOpen: boolean
  preferPlainText: boolean
  isPreview: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

export const useReasoning = () => {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning')
  }
  return context
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
  /** Bounded automatic preview; an explicit reader toggle takes precedence. */
  livePreview?: boolean
  /** Keep automatic previews only while their enclosing assistant turn runs. */
  isTurnActive?: boolean
}

const MS_IN_S = 1000
const STREAMING_REASONING_FORMAT_LIMIT = 20_000

function normalizeReasoningMarkdown(value: string): string {
  // Some local chat templates concatenate separately-bolded status lines as
  // `**First****Second**`. Markdown treats that boundary inconsistently while
  // streaming. Preserve the words, but make each status a real paragraph.
  return value.replace(/\*\*\*\*/g, '**\n\n**')
}

function StreamingReasoningText({ children }: { children: string }) {
  const pieces: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(children))) {
    if (match.index > cursor) pieces.push(children.slice(cursor, match.index))
    pieces.push(
      <strong key={`${match.index}-${match[1]}`} className="font-semibold">
        {match[1]}
      </strong>
    )
    cursor = match.index + match[0].length
  }
  if (cursor < children.length) pieces.push(children.slice(cursor))
  return <>{pieces}</>
}

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    livePreview = false,
    isTurnActive = isStreaming,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    })
    const [userOpen, setUserOpen] = useState<boolean | undefined>()
    const [sawPreview, setSawPreview] = useState(livePreview && isStreaming)
    if (livePreview && isStreaming && !sawPreview) setSawPreview(true)
    const isPreview =
      livePreview &&
      isTurnActive &&
      open === undefined &&
      userOpen === undefined &&
      (isStreaming || sawPreview)
    const visible = isPreview || isOpen
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: isStreaming ? 1 : undefined,
    })

    const [startTime, setStartTime] = useState<number | null>(() =>
      isStreaming ? performance.now() : null
    )
    const activeClock = useRef({ last: startTime, elapsed: 0 })
    const activeElapsed = useCallback(() => {
      const now = performance.now()
      const clock = activeClock.current
      const delta = clock.last === null ? 0 : Math.max(0, now - clock.last)
      // A suspended webview cannot measure work during the missing interval.
      // Exclude long gaps (sleep or a blocked UI) instead of calling them thought.
      if (delta <= 5_000) clock.elapsed += delta
      clock.last = now
      return Math.max(1, Math.ceil(clock.elapsed / MS_IN_S))
    }, [])
    const streamedThisMountRef = useRef(isStreaming)
    if (isStreaming) streamedThisMountRef.current = true
    const [readerReopened, setReaderReopened] = useState(false)

    // Use observed monotonic time, so wall-clock corrections cannot freeze or
    // jump the timer while the enclosing turn moves through tools and waits.
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          activeClock.current = { last: performance.now(), elapsed: 0 }
          setStartTime(performance.now())
          setDuration((current) => Math.max(current ?? 0, 1))
          return
        }
        const update = () => {
          const elapsed = activeElapsed()
          setDuration((current) => Math.max(current ?? 0, elapsed))
        }
        update()
        const timer = window.setInterval(update, MS_IN_S)
        return () => window.clearInterval(timer)
      }
      if (startTime !== null) {
        const elapsed = activeElapsed()
        setDuration((current) => Math.max(current ?? 0, elapsed))
        setStartTime(null)
      }
    }, [isStreaming, startTime, setDuration, activeElapsed])

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        if (!isStreaming && newOpen && !visible) setReaderReopened(true)
        setUserOpen(newOpen)
        setIsOpen(newOpen)
      },
      [isStreaming, visible, setIsOpen]
    )
    const findRef = useFindDisclosure(visible, handleOpenChange)

    const contextValue = useMemo(
      () => ({
        isStreaming,
        isOpen: visible,
        isPreview,
        // Keep a phase lightweight while the enclosing turn continues.
        // Automatic previews collapse at turn end; an explicit reader open
        // opts into the full trace and survives completion.
        preferPlainText:
          streamedThisMountRef.current && !isStreaming && !readerReopened,
        setIsOpen: handleOpenChange,
        duration,
      }),
      [
        isStreaming,
        visible,
        isPreview,
        readerReopened,
        handleOpenChange,
        duration,
      ]
    )

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          ref={findRef}
          data-atomic-find-reasoning
          className={cn(
            'not-prose mb-4',
            livePreview &&
              'opacity-[0.67] transition-opacity hover:opacity-100 focus-within:opacity-100',
            className
          )}
          onOpenChange={handleOpenChange}
          open={visible}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    )
  }
)

/** Own the viewport geometry with the same closed state Radix receives.
 * A finished, closing panel must never spend a frame at its trace's height.
 */
export const ReasoningViewport = ({
  className,
  ...props
}: ComponentProps<'div'>) => {
  const { isOpen, isPreview } = useReasoning()
  return (
    <div
      {...props}
      data-reasoning-viewport
      data-state={isOpen ? 'open' : 'closed'}
      data-bounded={!isOpen || isPreview}
      className={cn(
        'relative w-full min-w-0 text-sm transition-[margin] duration-150 ease-out motion-reduce:transition-none',
        isOpen
          ? isPreview
            ? 'mt-1 max-h-40 overflow-y-auto overscroll-y-auto'
            : 'mt-2 h-auto overflow-visible'
          : 'mt-0 max-h-0 overflow-hidden',
        className
      )}
    />
  )
}

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming) {
    return `Thinking for ${duration ?? 1}s…`
  }
  if (duration === undefined) {
    return 'Thought for a few seconds'
  }
  return `Thought for ${duration}s`
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, isPreview, duration } = useReasoning()

    return (
      <CollapsibleTrigger
        className={cn(
          'flex min-h-6 w-full min-w-0 items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground',
          isPreview && 'text-xs',
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <IconBulb className="size-[18px] shrink-0" stroke={1.8} />
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">
                {getThinkingMessage(isStreaming, duration)}
              </span>
              <ChevronDownIcon
                className={cn(
                  'size-4 shrink-0 transition-transform',
                  isOpen ? 'rotate-180' : 'rotate-0'
                )}
              />
            </span>
          </>
        )}
      </CollapsibleTrigger>
    )
  }
)

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string
  isStreaming?: boolean
}

export const ReasoningContent = memo(
  ({
    className,
    children,
    isStreaming = false,
    ...props
  }: ReasoningContentProps) => {
    const { isOpen, isPreview, preferPlainText } = useReasoning()
    // Radix keeps the content mounted for the collapse animation, so a panel
    // that is on its way closed would still pay for the full Markdown parse.
    // Only a panel a reader can actually read is worth parsing.
    const showMarkdown = !isStreaming && isOpen && !preferPlainText
    const normalizedChildren = normalizeReasoningMarkdown(children)
    const formatStreaming =
      normalizedChildren.length <= STREAMING_REASONING_FORMAT_LIMIT

    return (
      <CollapsibleContent
        className={cn(
          'mt-1 text-xs relative',
          'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
          className
        )}
        {...props}
      >
        {/* Streamdown's own utility classes (list-inside, pl-6, ...) are not
        emitted by this build (Tailwind doesn't scan node_modules), so markdown
        here must be styled by the app's `.markdown` stylesheet — without it,
        list markers fall back to `outside` with zero padding and overlap the
        dotted border. */}
        <div
          className={cn(
            'markdown',
            !isPreview && 'ml-2 border-l border-border/60 pl-4'
          )}
        >
          {showMarkdown ? (
            <Streamdown
              animate={false}
              remarkPlugins={REASONING_REMARK_PLUGINS}
              {...props}
            >
              {normalizedChildren}
            </Streamdown>
          ) : (
            <div
              className="whitespace-pre-wrap wrap-break-word"
              data-streaming-reasoning
              dir="auto"
            >
              {formatStreaming ? (
                <StreamingReasoningText>
                  {normalizedChildren}
                </StreamingReasoningText>
              ) : (
                normalizedChildren
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    )
  }
)

Reasoning.displayName = 'Reasoning'
ReasoningTrigger.displayName = 'ReasoningTrigger'
ReasoningContent.displayName = 'ReasoningContent'
