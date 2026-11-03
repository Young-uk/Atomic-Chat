# Dstar tool images are not textual context

Dstar's custom endpoint uses the same text-serialized tool results as the local backends. Apply the existing image-result preparation to this endpoint too: Dstar receives separate image parts even when its discovery response omits vision metadata. Other local providers still use their declared vision capability and receive an explicit image-unavailable placeholder when unsupported. Do not change the archived original or claim that an unsupported model saw the screenshot.

Summary evidence and incremental conversation estimates also strip tool-result image bytes in model-bound copies. Treating base64 as text can falsely exhaust the context and invoke emergency compaction even when there are no remaining older turns. Genuine oversized textual turns still retain the existing recovery/error behavior.

Regression coverage checks custom-endpoint transport payloads, preserved source data, summary evidence, and incremental usage estimates. No automatic retry of the screenshot tool is introduced.

Model-only image messages follow their owning retained turn through compaction projection. Dropping these derived messages would leave an image-attachment placeholder without the actual image. Archived turns do not retain their derived image messages.

Tool-image placement is stable across streaming continuation and persisted replay. Split the model-only assistant copy at an image-bearing tool wave, attach its images there, then retain subsequent assistant text and tool waves in order. Previously, hoisting after the entire accumulated assistant message moved a screenshot past the answer on the next user turn; Dstar rejected the changed vision layout and reread the complete prompt. Derived segments carry their source owner through compaction projection. Original stored history remains unchanged. Regression coverage compares the converted model-message prefix before and after continuation, multiple screenshots, replay, and removal of an archived owner.

Installed-app testing exposed a second boundary: completion review after a tool continuation recorded only the current generation's semantic parts, omitting the existing assistant tool wave. Replay consequently placed the review notice before the screenshot. Record the complete assistant-turn offset instead; image segmentation projects that absolute offset into the owning segment. This does not change the review decision or grant tool permissions. A regression compares the converted screenshot prefix before review with the persisted continuation.
