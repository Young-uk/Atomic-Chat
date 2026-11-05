# Local Personal app replacement

- **Context** — A tool process can disappear during app exit, before it can reopen the new build or restore the old one.
- **Decision** — Run the workstation-specific updater in a separate Terminal session. Confirm before running checkout code and before replacing the fixed Personal bundle. Verify the existing and staged bundle signatures, request normal shutdown of the exact bundle, and keep the previous bundle on the same volume.
- **Consequences** — The operator confirms readiness after checking the reopened window. Cancel or timeout requests normal exit and restores the previous bundle. The helper updates the app executable and its embedded frontend. Independently installed tools, model servers, and application data are outside the update.
