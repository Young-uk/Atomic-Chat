#!/bin/bash
# Install a trusted copy of this script outside the checkout before using it.
set -euo pipefail

checkout=/private/tmp/atomic-personal-cache-nov03
[[ $# == 0 || ( $# == 1 && "$1" == --check ) ]]
app="$HOME/Applications/Atomic Chat Personal.app"
executable=Atomic-Chat
tools=/private/tmp/atomic-build-tools-nov03
export PATH="$HOME/Library/Application Support/Atomic Chat Personal Tools:$tools/cargo/bin:/private/tmp/atomic-output-reserve-bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
export CARGO_HOME="$tools/cargo" RUSTUP_HOME="$tools/rustup" TZ=UTC
export CARGO_TARGET_DIR=/private/tmp/atomic-cache-app-target-nov03

[[ "$(uname -s)" == Darwin && -f "$checkout/package.json" && -d "$app" && ! -L "$app" ]]
/usr/bin/codesign --verify --deep --strict "$app"
signing_info="$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1)"
installed_hash="$(printf '%s\n' "$signing_info" | /usr/bin/sed -n 's/^CDHash=//p')"
identity="$(printf '%s\n' "$signing_info" | /usr/bin/sed -n 's/^Authority=\(Developer ID Application: .*\)/\1/p')"
team="$(printf '%s\n' "$signing_info" | /usr/bin/sed -n 's/^TeamIdentifier=//p')"
[[ -n "$installed_hash" && -n "$identity" && "$team" =~ ^[A-Z0-9]{10}$ ]]
requirement="=identifier \"chat.atomic.app\" and anchor apple generic and certificate leaf[subject.OU] = \"$team\""

confirm() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "Atomic Chat Personal update" buttons {"Cancel", "Continue"} default button "Cancel" cancel button "Cancel" giving up after 120
  if gave up of result then error number -128
end run
APPLESCRIPT
}

# NSWorkspace targets the exact installed bundle, even when the official
# app shares its bundle identifier. A normal terminate preserves checkpoints.
app_processes() {
  /usr/bin/osascript -l JavaScript - "$app" "$1" <<'JXA'
ObjC.import('AppKit')
function run(argv) {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications
  const pids = []
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i)
    const url = app.bundleURL
    if (!url || url.isNil()) continue
    const path = ObjC.unwrap(url.path)
    if (path !== argv[0] || app.terminated) continue
    pids.push(app.processIdentifier)
    if (argv[1] === 'quit') app.terminate
  }
  return pids.join(',')
}
JXA
}

wait_for_exit() {
  for ((i=0; i<90; i++)); do
    [[ -z "$(app_processes status)" ]] && return 0
    sleep 1
  done
  return 1
}

if [[ "${1:-}" == --check ]]; then
  /usr/bin/codesign --verify --strict -R "$requirement" "$app"
  app_processes status
  exit
fi
confirm "Run tests and build Personal from $checkout? This runs the checkout's build scripts with your account."

cd "$checkout"
make verify
yarn build:personal
binary="$CARGO_TARGET_DIR/release/$executable"
[[ -x "$binary" ]]

# Keep the verified candidate and backup on the same volume as the app.
stage="$(/usr/bin/mktemp -d "$HOME/Applications/.atomic-personal-update.XXXXXXXX")"
candidate="$stage/Atomic Chat Personal.app"
backup="$stage/Previous Atomic Chat Personal.app"
/usr/bin/ditto "$app" "$candidate"
/bin/cp "$binary" "$candidate/Contents/MacOS/$executable"
entitlements="$stage/entitlements.plist"
/usr/bin/codesign -d --entitlements "$entitlements" "$app"
sign_options=(--force --sign "$identity" --options runtime)
if [[ -s "$entitlements" ]]; then
  sign_options+=(--entitlements "$entitlements")
fi
/usr/bin/codesign "${sign_options[@]}" "$candidate"
/usr/bin/codesign --verify --deep --strict -R "$requirement" "$candidate"

confirm "Install the tested build? Finish any active chat or summary first. The updater will quit and reopen Personal. The current app will be backed up."
app_processes quit >/dev/null
wait_for_exit
current_hash="$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 | /usr/bin/sed -n 's/^CDHash=//p')"
[[ "$current_hash" == "$installed_hash" ]]
/bin/mv "$app" "$backup"
if ! /bin/mv "$candidate" "$app"; then
  /bin/mv "$backup" "$app"
  /usr/bin/open -n "$app"
  exit 1
fi

if /usr/bin/open -n "$app" &&
   confirm "Check that the new Personal window has loaded and responds. Continue keeps it. Cancel restores the previous build." &&
   [[ -n "$(app_processes status)" ]]; then
  printf 'Updated Personal. Previous app: %s\n' "$backup"
  exit 0
fi

app_processes quit >/dev/null
if ! wait_for_exit; then
  printf 'Personal is still running. Quit it normally before restoring the backup at %s\n' "$backup" >&2
  exit 1
fi
/bin/mv "$app" "$stage/Rejected Atomic Chat Personal.app"
/bin/mv "$backup" "$app"
/usr/bin/open -n "$app"
printf 'Restored previous Personal build.\n' >&2
exit 1
