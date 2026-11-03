# Dstar tool images are not textual context

Dstar's custom endpoint uses the same text-serialized tool results as the local backends. Apply the existing image-result preparation to this endpoint too: Dstar receives separate image parts even when its discovery response omits vision metadata. Other local providers still use their declared vision capability and receive an explicit image-unavailable placeholder when unsupported. Do not change the archived original or claim that an unsupported model saw the screenshot.

Summary evidence and incremental conversation estimates also strip tool-result image bytes in model-bound copies. Treating base64 as text can falsely exhaust the context and invoke emergency compaction even when there are no remaining older turns. Genuine oversized textual turns still retain the existing recovery/error behavior.

Regression coverage checks custom-endpoint transport payloads, preserved source data, summary evidence, and incremental usage estimates. No automatic retry of the screenshot tool is introduced.

Model-only image messages follow their owning retained turn through compaction projection. Dropping these derived messages would leave an image-attachment placeholder without the actual image. Archived turns do not retain their derived image messages.
