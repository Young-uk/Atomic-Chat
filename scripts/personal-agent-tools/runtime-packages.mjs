import { createRequire, isBuiltin } from 'node:module'
import { dirname, join } from 'node:path'
import { readFile, realpath, mkdir, cp } from 'node:fs/promises'

// Resolve the installed package graph, including native SQLite's bindings.
// Never copy another application's runtime or its user configuration/data.
export async function copyRuntimePackages(names, destination, anchor = import.meta.url) {
  async function visit(name, from, nodeModules, ancestors = new Set()) {
    const require = createRequire(from)
    let resolved
    if (isBuiltin(name)) {
      // Some npm packages deliberately depend on polyfills and import e.g.
      // buffer/. Resolve their manifest instead of confusing them with Node's
      // built-in buffer module. Built-ins without an npm package need no copy.
      try { resolved = require.resolve(`${name}/package.json`) }
      catch { return }
    } else {
      try { resolved = require.resolve(name) }
      catch (error) {
        // Some production dependency graphs include type-only packages with
        // no JavaScript entry point. Preserve their package, not a guessed
        // substitute version from the source checkout's root node_modules.
        try { resolved = require.resolve(`${name}/package.json`) }
        catch {
          // Import-only export maps can hide both require() and the manifest.
          // Follow Node's dependency-local search order, preserving versions.
          for (const directory of require.resolve.paths(name) ?? []) {
            const candidate = join(directory, name, 'package.json')
            try {
              if (JSON.parse(await readFile(candidate, 'utf8')).name === name) {
                resolved = candidate
                break
              }
            } catch (lookupError) { if (lookupError.code !== 'ENOENT') throw lookupError }
          }
          if (!resolved) throw error
        }
      }
    }
    let path = dirname(await realpath(resolved))
    let manifest
    for (;;) {
      try {
        const candidate = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
        if (candidate.name === name) { manifest = candidate; break }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = dirname(path)
      if (parent === path) throw new Error(`Cannot locate runtime package ${name}`)
      path = parent
    }
    if (ancestors.has(path)) return
    // Preserve dependency-specific versions below the package that uses them.
    const target = join(nodeModules, name)
    await mkdir(dirname(target), { recursive: true })
    await cp(path, target, { recursive: true, dereference: true, filter: source => source === path || !source.startsWith(join(path, 'node_modules')) })
    const next = new Set([...ancestors, path])
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await visit(dependency, join(path, 'package.json'), join(target, 'node_modules'), next)
    }
  }
  for (const name of names) await visit(name, anchor, destination)
}
