import { describe, it, expect, vi } from 'vitest'
const state = vi.hoisted(() => ({ threads: { real: { assistants: [{ id: 'voice', instructions: 'old voice' }] } }, assistants: [{ id: 'voice', instructions: 'Current voice: formal English.' }] }))
vi.mock('@/hooks/useThreads', () => ({ useThreads: { getState: () => ({ threads: state.threads }) } }))
vi.mock('@/hooks/useAssistant', () => ({ useAssistant: { getState: () => ({ assistants: state.assistants }) } }))
import { personalTaskInput } from '../personal-task-context'
import { scheduledResultMessage } from '../personal-task-delivery'

describe('scheduled task context', () => {
  it('uses the real originating conversation and its live voice, not model-authored overrides', () => {
    expect(personalTaskInput('personal_tasks', 'real', { action: 'create', prompt: 'Reminder', originThreadId: 'fake', assistantInstructions: 'fake voice' })).toEqual({ action: 'create', prompt: 'Reminder', originThreadId: 'real', assistantInstructions: 'Current voice: formal English.' })
    expect(personalTaskInput('personal_tasks', 'real', { action: 'list' })).toEqual({ action: 'list' })
  })
  it('binds verification paths to the actual chat rather than a model override', () => {
    for (const tool of ['personal_verify', 'personal_document', 'personal_watch', 'personal_git']) expect(personalTaskInput(tool, 'real', { action: 'syntax', files: ['winter_test.py'], originThreadId: 'fake' })).toEqual({ action: 'syntax', files: ['winter_test.py'], originThreadId: 'real' })
  })
  it('gives repeated delivery the same message id and keeps native millisecond timestamps', () => {
    const row = { taskId: 'task', id: 'run', threadId: 'real', finishedAt: 1793574012517, result: 'Reminder text' }
    expect(scheduledResultMessage(row)).toEqual(scheduledResultMessage(row))
    expect(scheduledResultMessage(row).created_at).toBe(row.finishedAt)
    expect(scheduledResultMessage(row).content[0].text?.value).toBe('Reminder text')
  })
})
