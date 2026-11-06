import { createServer, createConnection } from 'node:net'
import { chmod, mkdir, lstat, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function brokerPath(directory) {
  if (!directory) throw new Error('Personal data directory is required')
  const key = createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 24)
  return join(tmpdir(), `atomic-personal-${process.getuid?.() ?? 'local'}`, `${key}.sock`)
}
const connect = path => new Promise((resolve, reject) => {
  const socket = createConnection(path)
  socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket) })
  socket.once('error', reject)
})

// A draining owner can accept a socket and close it without serving MCP.
function probeWorker(socket, timeout) {
  return new Promise(resolve => {
    let buffer = ''
    const finish = ready => {
      clearTimeout(timer)
      socket.pause()
      socket.off('data', read)
      socket.off('close', failed)
      socket.off('error', failed)
      resolve(ready)
    }
    const failed = () => finish(false)
    const read = chunk => {
      buffer += chunk.toString()
      const end = buffer.indexOf('\n')
      if (end < 0 && buffer.length <= 4096) return
      try {
        const reply = JSON.parse(buffer.slice(0, end))
        finish(reply.id === 'worker-ready' && reply.result != null)
      } catch { failed() }
    }
    const timer = setTimeout(failed, timeout)
    socket.on('data', read)
    socket.once('close', failed)
    socket.once('error', failed)
    socket.write('{"jsonrpc":"2.0","id":"worker-ready","method":"ping"}\n')
  })
}

export async function connectWorker(directory, { entry = fileURLToPath(new URL('./server.mjs', import.meta.url)), timeout = 10000 } = {}) {
  const path = brokerPath(directory)
  const deadline = Date.now() + timeout
  let child, spawnError
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    try {
      const socket = await connect(path)
      if (await probeWorker(socket, Math.min(1000, deadline - Date.now()))) return socket
      socket.destroy()
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        child = spawn(process.execPath, [entry, '--broker'], { detached: true, stdio: 'ignore', env: { ...process.env, ATOMIC_PERSONAL_TOOLS_DIR: directory } })
        child.once('error', error => { spawnError = error })
        child.unref()
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Personal worker did not respond to its readiness check')
}

// Bind before constructing stores: concurrent app/service connections elect one
// owner through the OS socket. No second process may reconcile running tasks.
export async function runBroker(directory, { create, serve, idleMs = 1000 } = {}) {
  const path = brokerPath(directory)
  const parent = join(path, '..')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const parentStat = await lstat(parent)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || (process.getuid && parentStat.uid !== process.getuid())) throw new Error('Unsafe Personal worker socket directory')
  await chmod(parent, 0o700)
  // A crash can leave a socket inode. Remove only our own refused socket;
  // permission failures and another live owner are never treated as stale.
  try {
    const live = await connect(path)
    live.end()
    return
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      const stat = await lstat(path)
      if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe stale worker socket')
      await unlink(path)
    } else if (error.code !== 'ENOENT') throw error
  }
  const sockets = new Set()
  const work = new Set()
  let idle, timer, tools, closing = false
  let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  ready.catch(() => {})
  let finish
  const finished = new Promise(resolve => { finish = resolve })
  const shutdown = async () => {
    if (closing) return
    closing = true
    clearTimeout(idle)
    clearInterval(timer)
    for (const socket of sockets) socket.destroy()
    if (tools) { tools.closed = true; for (const controller of tools.controllers.values()) controller.abort() }
    await Promise.allSettled([...work])
    await tools?.shutdown()
    // Keep the socket bound until stores have drained. Otherwise a reconnect
    // could construct a second owner while the old scheduler is still saving.
    await new Promise(resolve => server.close(resolve))
    finish()
  }
  const scheduleIdle = () => { clearTimeout(idle); if (!closing && !sockets.size) idle = setTimeout(() => {
    if (work.size || tools?.ticking) scheduleIdle()
    else void shutdown()
  }, idleMs) }
  const server = createServer(socket => {
    if (closing) { socket.destroy(); return }
    clearTimeout(idle)
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket); scheduleIdle() })
    const request = ready.then(() => socket.destroyed ? undefined : serve({ tools, input: socket, output: socket })).catch(() => socket.destroy())
    work.add(request)
    void request.finally(() => work.delete(request))
  })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  } catch (error) { if (error.code === 'EADDRINUSE') return; throw error }
  try {
    await chmod(path, 0o600)
    tools = await create()
    readyResolve()
  } catch (error) { readyReject(error); await shutdown(); throw error }
  timer = setInterval(() => { void tools.tick().catch(error => process.stderr.write(`Scheduler: ${error.message}\n`)) }, 1000)
  const stop = () => { void shutdown() }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  scheduleIdle()
  await finished
  clearInterval(timer)
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
}

export async function bridgeWorker(directory, { hold = false } = {}) {
  const socket = await connectWorker(directory)
  socket.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
  const stop = () => socket.end()
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  if (hold) socket.resume()
  if (!hold) {
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
    socket.resume()
  }
  await new Promise(resolve => socket.once('close', resolve))
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
}
