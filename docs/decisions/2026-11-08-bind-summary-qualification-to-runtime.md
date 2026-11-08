# Bind optional summary qualification to the tested runtime

- **Context:** A Boolean and three limits could retain summary capability after native, model/configuration or Python lane changes. Archive fingerprint separation alone did not revoke operational qualification.
- **Decision:** The Strata server now requires three explicit expected pins before configuring its optional lane: native full SHA256, model/configuration fingerprint, and a digest of the full `server.py` and `atomic_summary.py` source hashes. Pin keys are excluded from the fingerprint payload. Bind actual post-fallback/retry `engine.spawn` executable, argv and native/device/loader environment plus all explicit environment overrides, rather than only intended config. The working directory resolves artifact paths and matches the reviewed fixed launcher configuration; the working-directory value itself is not independently hashed. The prelaunch helper uses the same argument/environment resolution and refuses unqualified effort-end inference instead of guessing token IDs. Revalidate before every BEGIN under the inference FIFO, before native mutation. Missing or changed identity disables only optional summary/review, with an observable status reason; it does not restart, poison or block an otherwise healthy foreground engine.
- **Fingerprint coverage:** Native/model/PLE/profile and vision artifact identity; every pack-directory member; tokenizer/template bytes; generation configuration, user overrides and actual native/device/loader environment (excluding ownership fields and unrelated GUI/session variables). Device/inode/size/mtime/ctime detect ordinary artifact replacement and in-place writes. This is not a fresh full model-content integrity proof or protection from adversarial metadata-preserving tampering; qualification retains separately verified full model hashes.
- **Failure behavior:** Optional bounds, snapshot-directory or CAPS initialization failure is nonfatal to normal startup. Existing rollback uncertainty still poisons inference; this gate does not relax transaction recovery. An active transaction completes rollback before ownership is released. Completion review remains independently disabled in the app for both engines.
- **Verification:** Fifteen new CPU-only pin/drift/mock-startup tests plus the existing summary/fake-server suite pass (58 total). Actual-device and installed-app qualification are separate from these CPU tests. The conditional source wiring and live results are recorded below.

## Conditional production wiring and measured qualification

The app source now contains summary=true, completion-review=false, main-token
limit8192, snapshot-byte limit369098752, protected-byte limit1879048192, and
three literal pins copied from the exact production-shaped private config.
The final 8K paired intervention passed on 2026-11-08: six checkpoints, four
parked entries using 98.8% of the unchanged 1 GiB cache, 14,328 summary input
tokens and the full 2,048 output tokens. Main snapshots, middle checkpoint
reuse, parked revisit results and eviction counters matched the fresh control.
Memory pressure stayed normal and sampled swap usage never grew. One token
above the admitted main envelope was refused with byte-identical foreground
state and a successful subsequent foreground response. Full application
verification, signed build and installed-app checks remain separate release gates.
No 64K summary restore qualification is claimed; requests outside the qualified
conditional envelope must defer without changing the user's foreground output.
The foreground max-context65536, existing model paths, generation arguments,
Metal environment, Max/preload settings and independent review prohibition
remain unchanged.

`qualification/check_provisional_app_summary_config.py` extracts the literal
Rust JSON configuration, checks every non-transport/storage field against the
private config, and derives pins for both using the existing offline helper
under the verified captured GUI environment. It does not start an engine.
Rust unit expectations were updated, but compilation/full verification remains
a separate release gate.

The production transaction directory is a dedicated
Application Support/dstar/strata-summary-transactions directory. Backend
initialization currently resolves symlinks and uses mkdir without enforcing
private modes; merely naming a directory does not make it private. Before the
first production launch, the operator must provision a new owner-owned 0700
non-symlink directory, verify its parent chain and privacy, and refuse unexpected
existing content or redirects rather than deleting or following them. Retained
recovery snapshots may contain conversation state and must not be copied into
public evidence or automatically discarded. Failure to provision is a release
blocker, not a reason to relax permissions or runtime identity pins. No backend
source changes were made while the pinned live qualification was running.

The operator provisioned and verified the new 0700, owner-owned, non-symlink
transaction directory after the live tests. Recheck that invariant before the
first installed-app launch; the backend does not itself enforce it.
