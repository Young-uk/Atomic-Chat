import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useChatExecStatus } from '@/hooks/useChatExecStatus'
import { useToolApproval } from '@/hooks/useToolApproval'
import {
  approveChatToolCall,
  resolveExecAutoApprove,
  resolveAgentMcpAutoApprove,
  resolveMcpAutoApprove,
  agentDisabledMcpTools,
} from '@/lib/mcp-approval'

it('keeps host-only endpoints and the custom proposal adapter out of the other runner', () => {
  expect(agentDisabledMcpTools(['other::disabled'])).toEqual([
    'other::disabled', 'atomic-personal-tools::personal_native',
    'atomic-personal-tools::personal_memory_lifecycle', 'atomic-personal-tools::personal_task_delivery',
  ])
})

const platformFeatures = vi.hoisted(() => ({}) as Record<string, boolean>)
const nativeCall = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ mcp: () => ({ callTool: nativeCall }) }) }))
vi.mock('@/lib/platform/const', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform/const')>()
  Object.assign(platformFeatures, actual.PlatformFeatures, { chatExec: true })
  return { ...actual, PlatformFeatures: platformFeatures }
})

describe('resolveMcpAutoApprove', () => {
  beforeEach(() => {
    useAgentMode.setState({ approvalModes: {} })
    useToolApproval.setState({ allowAllMCPPermissions: true })
  })

  it('follows the global switch while the thread has no explicit mode', () => {
    expect(resolveMcpAutoApprove('t1')).toBe(true)

    useToolApproval.setState({ allowAllMCPPermissions: false })
    expect(resolveMcpAutoApprove('t1')).toBe(false)
  })

  it('lets an explicit skip auto-approve even with the global switch off', () => {
    useToolApproval.setState({ allowAllMCPPermissions: false })
    useAgentMode.setState({ approvalModes: { t1: 'skip' } })

    expect(resolveMcpAutoApprove('t1')).toBe(true)
  })

  it('lets an explicit manual prompt even with the global switch on', () => {
    useAgentMode.setState({ approvalModes: { t1: 'manual' } })

    expect(resolveMcpAutoApprove('t1')).toBe(false)
    // Other threads are untouched by t1's choice.
    expect(resolveMcpAutoApprove('t2')).toBe(true)
  })
})

describe('approveChatToolCall', () => {
  const showApprovalModal = vi.fn()

  beforeEach(() => {
    showApprovalModal.mockReset().mockResolvedValue(true)
    nativeCall.mockReset()
    useAgentMode.setState({ approvalModes: {} })
    useToolApproval.setState({
      allowAllMCPPermissions: true,
      showApprovalModal,
    })
    useChatExecStatus.setState({
      status: {
        supported: true,
        os: 'macos',
        shell: 'sh',
        languages: ['python'],
        sandbox: { kind: 'none', reason: null },
        userFolders: [],
      },
    })
  })

  afterEach(() => {
    useChatExecStatus.setState({ status: null })
  })

  it('asks before a command even while every MCP tool is auto-approved', async () => {
    await approveChatToolCall('run_command', 't1', { command: 'ls' })

    expect(resolveExecAutoApprove('t1')).toBe(false)
    expect(showApprovalModal).toHaveBeenCalledWith(
      'run_command',
      't1',
      { command: 'ls' },
      { bypassGlobalAutoApprove: true }
    )
  })

  it('runs commands without asking only on Full access', async () => {
    useAgentMode.setState({ approvalModes: { t1: 'skip' } })

    await expect(
      approveChatToolCall('run_script', 't1', { code: 'print(1)' })
    ).resolves.toBe(true)
    expect(showApprovalModal).not.toHaveBeenCalled()
  })

  it('requires explicit approval for personal desktop tools despite the global MCP switch', async () => {
    showApprovalModal.mockResolvedValueOnce(false)
    expect(await approveChatToolCall('personal_browser', 't1', { action: 'click' })).toBe(false)
    expect(showApprovalModal).toHaveBeenCalledWith('personal_browser', 't1', { action: 'click' }, { bypassGlobalAutoApprove: true })
  })

  it('keeps the MCP rule for every other tool', async () => {
    await expect(approveChatToolCall('search', 't1', {})).resolves.toBe(true)
    expect(showApprovalModal).not.toHaveBeenCalled()
  })

  it('shows the stored native proposal instead of model-supplied preview text', async () => {
    const proposal = { id: 'pending', name: 'os.fs.write', args: { path: '/synthetic', content: 'real content' }, request: { category: 'fs_write', reason: 'actual request' }, expiresAt: Date.now() + 10000 }
    nativeCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(proposal) }] })
    expect(await approveChatToolCall('personal_native', 't1', { action: 'confirm', pendingId: 'pending', preview: 'misleading' })).toBe(true)
    expect(showApprovalModal).toHaveBeenCalledWith('personal_native', 't1', {
      action: 'confirm', pendingId: 'pending', nativeTool: proposal.name,
      arguments: proposal.args, approval: proposal.request,
    }, { bypassGlobalAutoApprove: true, requireFreshApproval: true })
  })

  it('requires a human for a valid nested proposal even on Full access', async () => {
    useAgentMode.setState({ approvalModes: { t1: 'skip' } })
    const proposal = { id: 'pending', name: 'os.fs.write', args: { path: 'synthetic.txt' }, request: { category: 'fs_write' }, expiresAt: Date.now() + 10000 }
    nativeCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(proposal) }] })
    showApprovalModal.mockResolvedValueOnce(false)
    expect(await approveChatToolCall('personal_native', 't1', { action: 'confirm', pendingId: 'pending' })).toBe(false)
    expect(showApprovalModal).toHaveBeenCalledWith('personal_native', 't1', expect.objectContaining({ nativeTool: 'os.fs.write', arguments: proposal.args }), { bypassGlobalAutoApprove: true, requireFreshApproval: true })
  })

  it('refuses missing or expired native confirmations even on Full access', async () => {
    useAgentMode.setState({ approvalModes: { t1: 'skip' } })
    nativeCall.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ id: 'pending', name: 'os.fs.write', args: {}, request: {}, expiresAt: 0 }) }] })
    expect(await approveChatToolCall('personal_native', 't1', { action: 'confirm', pendingId: 'pending' })).toBe(false)
    expect(showApprovalModal).not.toHaveBeenCalled()
  })

  it('treats a same-named MCP tool as MCP while chat offers no commands', async () => {
    useChatExecStatus.setState({ status: null })

    await expect(approveChatToolCall('run_command', 't1', {})).resolves.toBe(
      true
    )
    expect(showApprovalModal).not.toHaveBeenCalled()
  })
})

describe('Agent personal-tool approval', () => {
  afterEach(() => useMCPServers.setState({ mcpServers: {} }))
  it('does not let the global MCP switch approve desktop tools in Agent IPC', () => {
    useAgentMode.setState({ approvalModes: {} })
    useToolApproval.setState({ allowAllMCPPermissions: true })
    useMCPServers.setState({ mcpServers: { 'atomic-personal-tools': { active: true, command: 'node', args: [], env: {} } } })
    expect(resolveAgentMcpAutoApprove('t1')).toBe(false)
    useAgentMode.setState({ approvalModes: { t1: 'skip' } })
    expect(resolveAgentMcpAutoApprove('t1')).toBe(true)
  })
})
