import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { NativeApprovalBridge } from './native-approval.mjs'
import { ToolRegistry } from './agent-source/suite/tools/tool-registry.mjs'
import { registerOsTools, ShellJobRegistry } from './agent-source/suite/tools/os/index.mjs'
import { USER_CONFIG_DEFAULTS } from './agent-source/suite/config/config-schema.mjs'
import { getDefaultArgsJsonSchema } from './agent-source/suite/prompt/default-tool-args-schemas.mjs'
import { findUnknownArguments } from './agent-source/suite/tools/unknown-argument-guard.mjs'
import { findControlMarkers } from './agent-source/suite/tools/control-marker-guard.mjs'
import { confineReads } from './agent-source/suite/tools/read-scope/confine-reads.mjs'
import { ReadScopeGrants } from './agent-source/suite/approval/read-scope-grants.mjs'
import { registerGithubTools } from './agent-source/suite/tools/github/index.mjs'
import { registerVerifyTools } from './agent-source/suite/tools/verify/index.mjs'
import { registerOsScreenTools } from './agent-source/suite/tools/os/screen/index.mjs'
import { buildOsEmailInboxTool, buildOsEmailSendTool } from './agent-source/suite/tools/os/email.mjs'
import { AtomicMailService } from './agent-source/suite/atomic-mail/index.mjs'

/** Direct source adapter only. No Agent bootstrap, model loop, private config
 * or database is loaded. The host owns scheduling and human approval. */
export class PersonalNativeSuite {
  constructor({ workspace, directory, trustConfigPaths = [], screenEnabled = false, mailConfig, githubOptions }) {
    this.workspace = resolve(workspace)
    this.approvals = new NativeApprovalBridge()
    this.approvals.readScopeGrants = new ReadScopeGrants()
    // Fan-out grants must never be fabricated by the embedding host.
    this.approvals.fanoutScopes = { allows: () => false }
    this.jobs = new ShellJobRegistry()
    this.registry = new ToolRegistry()
    const config = structuredClone(USER_CONFIG_DEFAULTS)
    registerOsTools(this.registry, {
      config, approvals: this.approvals, approvalRequired: true,
      listRecentSessionDirs: () => [], trustConfigPaths,
      stateDir: resolve(directory, 'native-state'), shellJobs: this.jobs,
      shellPolicy: { isGitRemoteSyncEnabled: () => false },
    })
    const dangerous = { approvals: this.approvals, approvalRequired: true }
    registerGithubTools(this.registry, { ...dangerous, ...githubOptions })
    registerVerifyTools(this.registry, { ...dangerous, config })
    registerOsScreenTools(this.registry, { ...dangerous, enabled: screenEnabled })
    // Override the original factories' private-Agent-config fallback. Credentials
    // and cached mail state belong only to the Personal worker supplied here.
    const atomicMail = new AtomicMailService({ stateDir: resolve(directory, 'native-state'),
      config: () => ({ atomicMail: { ...config.atomicMail, ...mailConfig },
        paths: { stateDir: resolve(directory, 'native-state') } }) })
    this.registry.register(buildOsEmailInboxTool({ ...dangerous, atomicMail }))
    this.registry.register(buildOsEmailSendTool({ ...dangerous, atomicMail }))
    confineReads(this.registry, {
      grantedDirs: () => [], readScope: () => 'working-dir',
      approvals: { approvals: this.approvals, approvalRequired: true },
    })
  }
  catalog() {
    return this.registry.list().map(tool => ({ name: tool.name,
      description: tool.description, readonly: tool.readonly,
      available: Boolean(getDefaultArgsJsonSchema(tool.name)) }))
  }
  describe(name) {
    const tool = this.registry.get(name)
    const inputSchema = getDefaultArgsJsonSchema(name)
    if (!inputSchema) throw new Error('No authoritative schema for native tool')
    const limits = name === 'os.shell.run'
      ? ' Personal adapter currently runs foreground commands only, with a maximum two-minute timeout; detached jobs require Chat session lifecycle integration.'
      : ''
    return { name, description: tool.description + limits, readonly: tool.readonly, inputSchema }
  }
  inspect(pendingId) { return this.approvals.inspect(pendingId) }
  async run(name, args, pendingId) {
    this.describe(name)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Native arguments must be an object')
    const unknown = findUnknownArguments(name, args)
    if (unknown) throw new Error(unknown.message)
    if (findControlMarkers(args, name).length) throw new Error('Native arguments contain model control markers')
    if (name === 'os.shell.run') {
      if (args.background || args.keep || args.wait !== undefined || args.kill !== undefined || args.jobs) {
        throw new Error('Detached shell jobs require Chat session lifecycle integration; use a foreground command')
      }
      if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > 120000)) {
        throw new Error('Personal foreground shell timeoutMs must be greater than zero and at most 120000')
      }
      // An explicit limit stops the source tool instead of returning a job
      // that this invocation-scoped host cannot honestly keep or wait on.
      args = { ...args, timeoutMs: args.timeoutMs ?? 120000 }
    }
    // Until Chat supplies an authenticated conversation identity, grants and
    // detached jobs live for this invocation only, never across other chats.
    const sessionId = randomUUID()
    try {
      return await this.approvals.run(name, args, () => this.registry.invoke(name, args, {
        workingDir: this.workspace, sessionId, stepIndex: 0,
        signal: AbortSignal.timeout(120000), readRoots: [],
      }), pendingId)
    } finally {
      this.approvals.readScopeGrants.clear(sessionId)
      this.jobs.endSession(sessionId)
    }
  }
  close() { this.jobs.endAll(); this.approvals.close() }
}
