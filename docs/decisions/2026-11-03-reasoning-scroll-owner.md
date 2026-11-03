# Keep expanded reasoning under the conversation scroll owner

Expanded reasoning uses `h-auto overflow-visible`, while closed reasoning hides
its content. Neither is an independent scrolling viewport. The legacy reasoning
hook nevertheless wrote `scrollTop` during streaming, alongside the conversation's
own tail follower. A live WebKit sample showed repeated asynchronous scroll and
compositing work during reported vertical oscillation; this does not alone prove
that all observed oscillation has the same cause.

Skip inner scroll writes for production reasoning viewports in both states.
Preserve the conversation tail follower and reader escape behavior, and preserve
bounded-viewport hook behavior for other consumers. Regression tests exercise
both production states with overflowing metrics, as well as existing bounded
viewport tests. Installed WebKit validation remains separate from source tests.
