import { createRequire } from "node:module";
const bootRequire = createRequire(import.meta.url);
function isSeaBuild() {
  try {
    const sea = bootRequire("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}
function selfInvocation(input) {
  const execArgv = input.execArgv ?? [];
  if (input.isSea) {
    return { cmd: input.execPath, args: [...execArgv] };
  }
  const scriptPath = input.argv[1];
  if (!scriptPath) {
    throw new Error("cannot re-run this program: no script path in argv");
  }
  return { cmd: input.execPath, args: [...execArgv, scriptPath] };
}
export {
  isSeaBuild,
  selfInvocation
};
