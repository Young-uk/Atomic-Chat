# Browser target pagination and Safari screen routing

- Context: Installed tool discovery incorrectly directed all browser interaction to the dedicated Chrome tool, despite registered guarded Safari screen controls. DOM reads truncated candidates before visibility filtering, hiding later controls.
- Decision: Describe Safari screenshot/click/type/key fallback explicitly without changing approval or OS permission checks. Include common interactive roles and paginate visible DOM targets with offset/nextOffset. Allocate monotonically increasing references so a stale reference cannot select a different target after another read.
- Validation: Browser regression tests and an isolated real Chrome DOM/click fixture. No user browser interaction or model inference is needed.
- Limits: DOM reads do not enumerate iframe documents. Safari screen interaction still requires host Accessibility/Screen Recording permission and current capture geometry. Installed worker code requires connector restart to reload.
