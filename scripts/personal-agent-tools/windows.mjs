import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
let accessibilityPrompted = false

// Ask from the same osascript process that performs window access so macOS
// attributes the request to the actual responsible host. Never change TCC.
const ACCESSIBILITY_SCRIPT = `ObjC.import('ApplicationServices');
function run(argv) {
  const prompt = JSON.parse(argv[0]).prompt;
  const granted = prompt
    ? $.AXIsProcessTrustedWithOptions($({AXTrustedCheckOptionPrompt:true}))
    : $.AXIsProcessTrusted();
  return JSON.stringify({granted:!!granted});
}`
const permissionRequired = () => ({
  status: 'permission_required', code: 'accessibility_permission_required',
  retryable: false, performed: false,
  settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  message: 'macOS Accessibility permission is required. Open System Settings > Privacy & Security > Accessibility and enable the responsible Personal Chat host shown by macOS. Return after granting permission; do not retry window operations until then. Use request_permission to show the system request again.',
  hostExecutable: process.execPath,
})

// Arguments are JSON data passed in argv, never interpolated AppleScript.
const SCRIPT = `function run(argv) {
  const a = JSON.parse(argv[0]); const se = Application('System Events');
  const processes = se.applicationProcesses.whose({backgroundOnly:false})();
  if(a.action === 'list') return JSON.stringify(processes.map(p => ({app:p.name(), windows:p.windows().map((w,i)=>({index:i+1,title:w.name(),position:w.position(),size:w.size()}))})));
  const p = processes.find(p => p.name() === a.app); if(!p) throw Error('Application not found');
  const windows = p.windows(); const w = windows[a.index-1]; if(!w) throw Error('Window not found; list windows first');
  if(a.action === 'focus') {p.frontmost=true; w.actions.byName('AXRaise').perform();}
  else if(a.action === 'move') w.position=[a.x,a.y];
  else if(a.action === 'resize') w.size=[a.width,a.height];
  else if(a.action === 'minimize') w.attributes.byName('AXMinimized').value=true;
  else throw Error('Unsupported window action');
  return JSON.stringify({app:a.app,index:a.index,action:a.action});
}`

export async function windowCall(args, runner = execute) {
  if (process.platform !== 'darwin') throw new Error('Window control currently requires macOS')
  if (!['list', 'focus', 'move', 'resize', 'minimize', 'permissions', 'request_permission'].includes(args.action)) throw new Error('Unknown window action')
  if (!['list', 'permissions', 'request_permission'].includes(args.action) && (typeof args.app !== 'string' || !Number.isInteger(args.index) || args.index < 1)) throw new Error('An application name and window index from list are required')
  const fields = args.action === 'move' ? ['x', 'y'] : args.action === 'resize' ? ['width', 'height'] : []
  for (const field of fields) if (!Number.isInteger(args[field]) || Math.abs(args[field]) > 20000 || (args.action === 'resize' && args[field] < 100)) throw new Error('Invalid window geometry')
  const prompt = args.action === 'request_permission' || (args.action !== 'permissions' && !accessibilityPrompted)
  if (prompt) accessibilityPrompted = true
  const checked = await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', ACCESSIBILITY_SCRIPT, JSON.stringify({ prompt })], { timeout: 10000 })
  const { granted } = JSON.parse(checked.stdout)
  if (args.action === 'permissions' || args.action === 'request_permission')
    return granted ? { status: 'ready', granted: true } : permissionRequired()
  if (!granted) return permissionRequired()
  try {
    const { stdout } = await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify(args)], { timeout: 10000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout)
  } catch (error) {
    // Permission can be revoked after the preflight. Do not expose a raw
    // AppleScript error as a retryable window operation.
    if (String(error.stderr ?? error.message).includes('-25211')) return permissionRequired()
    throw error
  }
}

export async function notifyTask({ title }, runner = execute) {
  if (process.platform !== 'darwin') return
  await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'function run(argv) { const app=Application.currentApplication(); app.includeStandardAdditions=true; app.displayNotification("Open Personal Chat → Connectors → Scheduled tasks to view the result.", {withTitle:argv[0]}); }', title], { timeout: 10000 })
}
