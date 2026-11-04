import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

export const WORKER_LABEL = 'chat.atomic.personal.worker'
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')

// Generate registration separately from activation. Installing Personal tools
// must never silently enable a login agent or start an unattended tool runner.
export function workerPlist({ node, entry, directory, log, enabledAtLogin = false, environment = {} }) {
  for (const path of [node, entry, directory, log]) if (!isAbsolute(path) || path.includes('\0')) throw new Error('Worker paths must be absolute')
  const variables = Object.entries(environment).filter(([key, value]) => ['ATOMIC_PERSONAL_ENDPOINT', 'ATOMIC_PERSONAL_MODEL', 'ATOMIC_PERSONAL_WORKSPACE'].includes(key) && typeof value === 'string').map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${WORKER_LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string><string>--worker</string></array>
<key>EnvironmentVariables</key><dict><key>ATOMIC_PERSONAL_TOOLS_DIR</key><string>${xml(directory)}</string>${variables}</dict>
<key>RunAtLoad</key><${enabledAtLogin ? 'true' : 'false'}/>
<key>KeepAlive</key><false/>
<key>ProcessType</key><string>Background</string>
<key>Umask</key><integer>63</integer>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`
}

export class WorkerService {
  constructor({ home = homedir(), uid = process.getuid?.(), platform = process.platform, run = promisify(execFile) } = {}) {
    this.path = join(home, 'Library/LaunchAgents', `${WORKER_LABEL}.plist`)
    this.domain = `gui/${uid}`
    this.platform = platform
    this.run = run
  }
  async status() {
    if (this.platform !== 'darwin') return { supported: false, running: false, registered: false }
    let registered = false, enabledAtLogin = false
    try { const plist = await readFile(this.path, 'utf8'); registered = true; enabledAtLogin = /RunAtLoad<\/key>\s*<true\//.test(plist) } catch (error) { if (error.code !== 'ENOENT') throw error }
    try {
      const { stdout } = await this.run('/bin/launchctl', ['print', `${this.domain}/${WORKER_LABEL}`], { timeout: 10000 })
      return { supported: true, registered, enabledAtLogin, running: /state = running/.test(stdout) }
    } catch (error) {
      // A missing job is expected before the user opts in. Other failures must
      // remain distinguishable from a successfully stopped worker.
      if (!/could not find service|not found|no such process/i.test(`${error.stderr ?? ''} ${error.message}`)) throw error
      return { supported: true, registered, enabledAtLogin, running: false }
    }
  }
  async start(options) {
    const current = await this.status()
    if (!current.supported) throw new Error('Background service requires macOS')
    if (current.running) return current
    if (!current.registered) await this.register(options)
    // bootstrap loads but does not necessarily run a disabled-at-login job.
    try { await this.run('/bin/launchctl', ['bootstrap', this.domain, this.path], { timeout: 10000 }) }
    catch (error) {
      const loaded = await this.status()
      if (!loaded.running) {
        // A loaded, idle job is valid. kickstart is the authoritative start.
        try { await this.run('/bin/launchctl', ['print', `${this.domain}/${WORKER_LABEL}`], { timeout: 10000 }) }
        catch { throw error }
      }
    }
    await this.run('/bin/launchctl', ['kickstart', `${this.domain}/${WORKER_LABEL}`], { timeout: 10000 })
    return this.status()
  }
  async stop() {
    const current = await this.status()
    if (!current.supported) throw new Error('Background service requires macOS')
    try { await this.run('/bin/launchctl', ['bootout', `${this.domain}/${WORKER_LABEL}`], { timeout: 10000 }) }
    catch (error) { if (!/could not find service|not found|no such process/i.test(`${error.stderr ?? ''} ${error.message}`)) throw error }
    return this.status()
  }
  async configureLogin(options, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Login setting must be a boolean')
    const previous = await this.status()
    await this.stop()
    await this.register({ ...options, enabledAtLogin: enabled })
    if (enabled || previous.running) await this.start(options)
    return this.status()
  }
  async register(options) {
    if (this.platform !== 'darwin') throw new Error('Background service registration requires macOS')
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, workerPlist(options), { mode: 0o600, flag: 'wx' })
    await rename(temporary, this.path)
    return { registered: true, started: false, enabledAtLogin: options.enabledAtLogin ?? false }
  }
}
