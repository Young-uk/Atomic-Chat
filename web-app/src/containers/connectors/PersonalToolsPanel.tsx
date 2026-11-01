import { useEffect, useState } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Memory = { id: string; text: string; source: string }
type Task = { id: string; prompt: string; status: string; dueAt: number; runs: { result?: string; error?: string }[] }

/** A user-operated view of the same persistent tools available in chat. */
export function PersonalToolsPanel() {
  const service = useServiceHub()
  const [memories, setMemories] = useState<Memory[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [query, setQuery] = useState('')
  const [prompt, setPrompt] = useState('')
  const [at, setAt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function call(toolName: string, args: object) {
    const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName, arguments: args })
    const text = result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? ''
    if (('isError' in result && result.isError) || result.error) throw new Error(text || String(result.error))
    return JSON.parse(text)
  }
  async function refresh() {
    const [memoryRows, taskRows] = await Promise.all([
      call('personal_memory', { action: 'search', query }),
      call('personal_tasks', { action: 'list' }),
    ])
    setMemories(memoryRows)
    setTasks(taskRows)
  }
  async function perform(operation: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await operation(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let disposed = false
    // Polling is read-only. No timer sends model requests or changes a task.
    const poll = async () => {
      try {
        const rows = await call('personal_tasks', { action: 'list' })
        if (!disposed) setTasks(rows)
      } catch (cause) { if (!disposed) setError(String(cause)) }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 15000)
    return () => { disposed = true; clearInterval(timer) }
    // Service identity is stable; query is deliberately excluded from task polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])

  return <section className="flex min-w-0 flex-col gap-3 rounded-xl border p-4" aria-label="Personal tools">
    <h2 className="font-medium">Personal tools</h2>
    <p className="text-sm text-muted-foreground">Browser and window controls are available in chat. Memories retain their sources. Scheduled text tasks run while the app is open; missed runs are not replayed.</p>
    <details>
      <summary>Long-term memory</summary>
      <div className="mt-3 flex min-w-0 gap-2">
        <Input aria-label="Search personal memory" value={query} onChange={event => setQuery(event.target.value)} />
        <Button disabled={busy} onClick={() => void perform(refresh)}>Search</Button>
      </div>
      {memories.map(memory => <div key={memory.id} className="mt-3 min-w-0 border-t pt-3">
        <p className="whitespace-pre-wrap break-words">{memory.text}</p>
        <p className="break-all text-xs text-muted-foreground">{memory.source}</p>
        <Button variant="outline" disabled={busy} onClick={() => {
          if (window.confirm('Forget this saved memory? Conversation archives remain unchanged.')) void perform(async () => { await call('personal_memory', { action: 'forget', id: memory.id }) })
        }}>Forget</Button>
      </div>)}
    </details>
    <details>
      <summary>Scheduled tasks ({tasks.length})</summary>
      <div className="mt-3 flex flex-col gap-2">
        <Input aria-label="Scheduled task prompt" placeholder="Reminder or text-only task" value={prompt} onChange={event => setPrompt(event.target.value)} />
        <Input aria-label="Scheduled task time" type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
        <Button disabled={busy || !prompt.trim() || !at} onClick={() => void perform(async () => {
          await call('personal_tasks', { action: 'create', prompt, at: new Date(at).toISOString() })
          setPrompt('')
        })}>Schedule</Button>
      </div>
      {tasks.map(task => <div key={task.id} className="mt-3 min-w-0 border-t pt-3">
        <p className="break-words">{task.prompt}</p>
        <p className="text-sm text-muted-foreground">{task.status} · {new Date(task.dueAt).toLocaleString()}</p>
        {task.runs.map((run, index) => <p key={index} className="whitespace-pre-wrap break-words text-sm">{run.error || run.result}</p>)}
        {['scheduled', 'running', 'missed'].includes(task.status) && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await call('personal_tasks', { action: 'cancel', id: task.id }) })}>Cancel</Button>}
      </div>)}
    </details>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  </section>
}
