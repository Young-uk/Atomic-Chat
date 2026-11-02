import { createHash, randomUUID } from 'node:crypto'

const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const digest = value => createHash('sha256').update(stable(value)).digest('hex')
class ReviewRequired extends Error {}

/** Source-native guards ask here instead of approving themselves. The host
 * displays the stored proposal for a separate human-confirmed tool call.
 * Grants are scoped to that exact native call and expire after ten minutes. */
export class NativeApprovalBridge {
  constructor(now = () => Date.now()) { this.now = now; this.pending = new Map() }
  inspect(id) {
    const row = this.pending.get(id)
    if (!row || row.expiresAt <= this.now()) { this.pending.delete(id); throw new Error('Native approval proposal expired or not found') }
    return structuredClone(row)
  }
  async run(name, args, invoke, confirmedId) {
    if (this.current) throw new Error('Native calls must be sequential')
    for (const [id, row] of this.pending) if (row.expiresAt <= this.now()) this.pending.delete(id)
    const argsHash = digest(args)
    const proposal = confirmedId ? this.inspect(confirmedId) : null
    if (proposal && (proposal.name !== name || proposal.argsHash !== argsHash)) throw new Error('Approval does not match this native call')
    const approved = new Set(proposal?.previousApprovals ?? [])
    if (proposal) approved.add(proposal.planHash)
    // Consume a matching confirmation before execution, including failed or
    // changed plans. A retry must obtain a fresh human-reviewed proposal.
    if (confirmedId) this.pending.delete(confirmedId)
    this.current = { name, argsHash, args: structuredClone(args), approved, proposal: null }
    try {
      let result
      try { result = await invoke() }
      catch (error) { if (!this.current.proposal) throw error }
      if (this.current.proposal) {
        const row = this.current.proposal
        return { status: 'approval_required', pendingId: row.id, name, category: row.request.category,
          reason: row.request.reason, instruction: 'A source-native guard has not approved this action. Confirm only through the human approval dialog; inspect the pending proposal before deciding.' }
      }
      return result
    } finally { this.current = null }
  }
  async request(request) {
    const current = this.current
    if (!current || request.tool !== current.name) throw new Error('No matching native call owns this approval')
    const { sessionId: _sessionId, ...plan } = request
    const planHash = digest(plan)
    if (current.approved.has(planHash)) return { approved: true, automatic: false }
    if (this.pending.size >= 64) throw new Error('Too many pending native approval proposals')
    const id = randomUUID()
    const row = { id, name: current.name, args: current.args, argsHash: current.argsHash, planHash,
      request: structuredClone(plan), previousApprovals: [...current.approved], expiresAt: this.now() + 600000 }
    this.pending.set(id, row)
    current.proposal = row
    throw new ReviewRequired('Source-native action requires human review')
  }
  close() { this.pending.clear() }
}
