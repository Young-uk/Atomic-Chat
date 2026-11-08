/** Both engines schedule against actual foreground context (60% raw / 85% pressure).
 * Native qualification bounds govern admission independently, never the trigger. */
export function summarySchedulingContext(actualContext: number): number {
  return actualContext
}

export class SummaryAdmission {
  private latestTokens?: number
  private refusedAt?: number
  private blocked = false
  private observedCompletions = new Set<string>()
  constructor(private maxMainTokens: number) {}
  get allowed(): boolean { return !this.blocked }
  observeForeground(tokens: number, completionId: string): void {
    if (!completionId || this.observedCompletions.has(completionId)) return
    this.observedCompletions.add(completionId)
    if (!Number.isSafeInteger(tokens) || tokens < 0) return
    this.latestTokens = tokens
    // An unknown initial state gets one opportunity after a new measured
    // completion. Another refusal captures that count, so unchanged state cannot
    // repeatedly rearm. A known refusal requires a strictly smaller state.
    if (this.blocked && (this.refusedAt === undefined || tokens < this.refusedAt) &&
        tokens <= this.maxMainTokens * 0.5) this.blocked = false
  }
  refuse(): void {
    this.blocked = true
    this.refusedAt = this.latestTokens
  }
  assertAllowed(): void {
    if (this.blocked) throw new Error('Background summary deferred after server admission refusal; originals retained')
  }
}
