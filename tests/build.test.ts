import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

// Include the application entrypoint, not only the simulation imported by unit tests.
// This catches missing fighter move IDs and accidental window.name calls in tournament UI.
test('web entrypoint typechecks with every fighter special and tournament title', () => {
  const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
  execFileSync(process.execPath, [compiler, '--noEmit'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
  })
}, 30000)
