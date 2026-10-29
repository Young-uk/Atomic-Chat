# Percentage-based interface text scale

The original 13px default is 100%. Replace the named size chooser with a synchronized slider and percentage selector, covering 75–200% in five-percent steps, plus a 100% restoration action. Preserve the existing title/body/caption hierarchy through the shared type-scale variable. This is text scaling, not webview zoom.

Persist a version-2 percentage and derive the CSS base size from it. Migrate previous font choices to the nearest supported percentage after applying the existing version-0 migration. Reset restores 100%. Retain the legacy size setter as an adapter for existing consumers. Controls and page headers retain their default geometry at 100%, and gain enough height for enlarged text rather than clipping it.

Validate slider/selector synchronization, bounds, legacy migration, persisted rehydration, and actual browser geometry at 75%, 100%, 125%, and 200%. No inference, download, or model-selection behavior changes.
