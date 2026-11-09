# Reboot-stable Strata context verification

A verified Personal Strata installation was rejected after reboot. Native and backend SHA-256 still matched. The qualification model digest included the mount-session device number and inherited the GUI executable search path; the latter changed from the earlier GUI environment to the four system directories after login.

Fingerprint v2 excludes only the device number from persistent model metadata. Paths, inode, size, nanosecond modification time and change time remain bound, as do tokenizer/template bytes and generation configuration. Native and backend code retain full SHA-256 validation. Transient hash-race identities continue to include device numbers, so remounts or replacements during hashing are still rejected. Older version-1 pins are not silently accepted.

Personal Strata explicitly sets its child PATH to /usr/bin:/bin:/usr/sbin:/sbin. Its configured engine, Python runtime, models, projector and libraries use explicit paths. Arithmetic/device/loader environment checks remain enabled. Qualification still observes the actual child spawn and refuses mismatched code, model metadata, arguments or loader settings.

Validation simulates changed device numbers, verifies that native/model replacements and loader changes are rejected, and runs real prelaunch checks for 16K, 32K and 64K under both observed GUI environments. No reboot or model generation is required. Runtime v15 and prior app/cache files are retained for rollback; the updated Python runtime is isolated as v16.
