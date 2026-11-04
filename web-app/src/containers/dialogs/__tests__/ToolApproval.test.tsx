import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

import ToolApproval from '../ToolApproval'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useSecureEnvironments } from '@/hooks/useSecureEnvironments'
import { useThreads } from '@/hooks/useThreads'

function open(toolName: string, toolParameters: object) {
  useToolApproval.setState({
    isModalOpen: true,
    modalProps: {
      toolName,
      threadId: 't1',
      toolParameters,
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    },
  })
  render(<ToolApproval />)
}

describe('ToolApproval for commands and scripts', () => {
  beforeEach(() => {
    useThreads.setState({
      threads: { t1: { id: 't1', title: 'Chat', updated: 0 } },
    } as never)
    useSecureEnvironments.setState({ environments: {} })
  })

  it('shows the command itself and that an ordinary chat runs it on the computer', () => {
    open('run_command', { command: 'dir /s', timeout_seconds: 30 })

    expect(
      screen.getByText('tools:toolApproval.exec.commandTitle')
    ).toBeInTheDocument()
    expect(screen.getByTestId('exec-approval-source')).toHaveTextContent(
      'dir /s'
    )
    expect(
      screen.getByText(/tools:toolApproval\.exec\.unsandboxed/)
    ).toHaveTextContent('{"seconds":30}')
    expect(
      screen.queryByText('tools:toolApproval.parameters')
    ).not.toBeInTheDocument()
  })

  it("names the script language and, in a secure project, the project's folders", () => {
    useThreads.setState({
      threads: {
        t1: {
          id: 't1',
          title: 'Chat',
          updated: 0,
          metadata: { project: { id: 'p1', name: 'P1', updated_at: 0 } },
        },
      },
    } as never)
    useSecureEnvironments.setState({
      environments: {
        p1: {
          folders: [{ path: 'D:\\Work', canEdit: false }],
          network: false,
          allowedMcpServers: [],
        },
      },
    })

    open('run_script', { language: 'python', code: 'print(42)' })

    expect(
      screen.getByText(
        'tools:toolApproval.exec.scriptTitle {"language":"Python"}'
      )
    ).toBeInTheDocument()
    expect(screen.getByTestId('exec-approval-source')).toHaveTextContent(
      'print(42)'
    )
    const notice = screen.getByText(/tools:toolApproval\.exec\.secure /)
    expect(notice).toHaveTextContent('secureFolderReadOnly')
    expect(notice).toHaveTextContent('tools:toolApproval.exec.secureOffline')
    expect(notice).not.toHaveTextContent('unsandboxed')
  })

  it('keeps the parameter view for any other tool', () => {
    open('search', { query: 'alpha' })

    expect(screen.getByText('tools:toolApproval.title')).toBeInTheDocument()
    expect(
      screen.getByText('tools:toolApproval.parameters')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('exec-approval-source')).not.toBeInTheDocument()
  })
})


describe('Personal native approval descriptions', () => {
  it('explains catalog discovery without suggesting file or command execution', () => {
    open('personal_native', { action: 'catalog' })
    expect(screen.getByText('tools:toolApproval.native.catalogTitle')).toBeInTheDocument()
    expect(screen.getByText('tools:toolApproval.native.catalogDescription')).toBeInTheDocument()
    expect(screen.getByText('tools:toolApproval.native.threadScope')).toBeInTheDocument()
    expect(screen.getByText(/"action": "catalog"/)).toBeInTheDocument()
  })
  it('shows the actual native tool for a stored confirmation', () => {
    open('personal_native', { action: 'confirm', nativeTool: 'os.fs.write', arguments: { path: '/long/path/file.txt' }, approval: { reason: 'write file' } })
    expect(screen.getByText('tools:toolApproval.native.confirmTitle')).toBeInTheDocument()
    expect(screen.getByText('os.fs.write')).toBeInTheDocument()
    expect(screen.getByText(/long\/path\/file.txt/)).toBeInTheDocument()
    expect(screen.queryByText('tools:toolApproval.native.catalogDescription')).not.toBeInTheDocument()
  })
  it('does not describe an unknown operation as harmless discovery', () => {
    open('personal_native', { action: 'unknown' })
    expect(screen.getByText('tools:toolApproval.title')).toBeInTheDocument()
    expect(screen.queryByText('tools:toolApproval.native.catalogDescription')).not.toBeInTheDocument()
  })
})

it('shows a separate persistent permission action and hides remembered choices for fresh proposals', () => {
  const always = vi.fn()
  useToolApproval.setState({ isModalOpen: true, modalProps: { toolName: 'test', threadId: 'test', onApprove: vi.fn(), onDeny: vi.fn(), onAlwaysAllow: always, permissionSource: 'provider' } })
  const view = render(<ToolApproval />)
  screen.getByRole('button', { name: 'tools:toolApproval.allowAlways' }).click()
  expect(always).toHaveBeenCalledOnce()
  view.unmount()
  useToolApproval.setState({ isModalOpen: true, modalProps: { toolName: 'personal_native', threadId: 'test', onApprove: vi.fn(), onDeny: vi.fn(), requireFreshApproval: true, toolParameters: { action: 'confirm' } } })
  render(<ToolApproval />)
  expect(screen.queryByRole('button', { name: 'tools:toolApproval.allowAlways' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'tools:toolApproval.alwaysAllow' })).toBeNull()
  expect(screen.getByRole('button', { name: 'tools:toolApproval.allowOnce' })).toBeDefined()
})

it('offers an exact-action persistent choice while keeping thread-wide approval hidden', () => {
  const always = vi.fn()
  useToolApproval.setState({ isModalOpen: true, modalProps: { toolName: 'personal_native', threadId: 'test', onApprove: vi.fn(), onDeny: vi.fn(), requireFreshApproval: true, storedActionPermission: true, onAlwaysAllow: always, toolParameters: { action: 'confirm', nativeTool: 'os.shell.run' } } })
  render(<ToolApproval />)
  expect(screen.getByText('tools:toolApproval.storedActionScope')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'tools:toolApproval.alwaysAllow' })).toBeNull()
  screen.getByRole('button', { name: 'tools:toolApproval.allowAlways' }).click()
  expect(always).toHaveBeenCalledOnce()
})
