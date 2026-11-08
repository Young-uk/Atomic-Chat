import { useEffect, useRef } from 'react'
import { scrollFindTarget, type FindTarget } from './find-highlight'

/** A disclosure can reveal itself without clicking actions, links, or menu items. */
export function useFindDisclosure(open: boolean, setOpen: (open: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    const reveal = () => { if (!open) setOpen(true) }
    node?.addEventListener('atomic-find-reveal', reveal)
    return () => node?.removeEventListener('atomic-find-reveal', reveal)
  }, [open, setOpen])
  return ref
}

/** Wait for React/virtualizer to commit before resolving a range. Cancel stale navigation. */
export function revealFindTarget(root: HTMLElement, prepare: () => void, target: () => FindTarget | null): () => void {
  let stopped = false
  let frame = 0
  const deadline = performance.now() + 1600
  const attempt = () => {
    frame = 0
    if (stopped || !root.isConnected) return
    prepare()
    const resolved = target()
    if (resolved) {
      scrollFindTarget(resolved)
      document.dispatchEvent(new Event('atomic-find-target'))
      return
    }
    if (performance.now() < deadline) frame = requestAnimationFrame(attempt)
  }
  attempt()
  return () => { stopped = true; cancelAnimationFrame(frame) }
}

export function openFindDisclosure(element: HTMLElement | null | undefined): void {
  if (element?.dataset.state !== 'open') element?.dispatchEvent(new Event('atomic-find-reveal'))
}
