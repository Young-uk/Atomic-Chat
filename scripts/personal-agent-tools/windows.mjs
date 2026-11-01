import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)

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
  if (!['list', 'focus', 'move', 'resize', 'minimize'].includes(args.action)) throw new Error('Unknown window action')
  if (args.action !== 'list' && (typeof args.app !== 'string' || !Number.isInteger(args.index) || args.index < 1)) throw new Error('An application name and window index from list are required')
  const fields = args.action === 'move' ? ['x', 'y'] : args.action === 'resize' ? ['width', 'height'] : []
  for (const field of fields) if (!Number.isInteger(args[field]) || Math.abs(args[field]) > 20000 || (args.action === 'resize' && args[field] < 100)) throw new Error('Invalid window geometry')
  const { stdout } = await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify(args)], { timeout: 10000, maxBuffer: 1024 * 1024 })
  return JSON.parse(stdout)
}

export async function notifyTask({ title }, runner = execute) {
  if (process.platform !== 'darwin') return
  await runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'function run(argv) { const app=Application.currentApplication(); app.includeStandardAdditions=true; app.displayNotification("Open Personal Chat → Connectors → Scheduled tasks to view the result.", {withTitle:argv[0]}); }', title], { timeout: 10000 })
}
