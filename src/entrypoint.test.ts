import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

const ENTRYPOINT_PATH = path.resolve('entrypoint.sh')

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`)
    }
    await delay(20)
  }
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 })
}

test('X server の準備完了後にアプリを起動する', async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kindle-booklog-entrypoint-test-')
  )
  const fakeBin = path.join(temporaryDirectory, 'bin')
  const markerPath = path.join(temporaryDirectory, 'pnpm-started')
  fs.mkdirSync(fakeBin)

  writeExecutable(
    path.join(fakeBin, 'Xvfb'),
    `#!/bin/sh
sleep 0.3
display="\${1#:}"
mkdir -p /tmp/.X11-unix
touch "/tmp/.X11-unix/X$display"
sleep 10
`
  )
  writeExecutable(path.join(fakeBin, 'x11vnc'), '#!/bin/sh\nsleep 10\n')
  writeExecutable(
    path.join(fakeBin, 'pnpm'),
    `#!/bin/sh
touch "${markerPath}"
exit 0
`
  )

  const startedAt = Date.now()
  const child = spawn('sh', [ENTRYPOINT_PATH], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      DISPLAY: ':199',
      WINDOW_WIDTH: '1200',
      WINDOW_HEIGHT: '1700',
    },
  })

  try {
    await waitForFile(markerPath, 2000)
    const elapsedMs = Date.now() - startedAt
    assert.ok(
      elapsedMs >= 250,
      `app started before X server was ready: ${elapsedMs}ms`
    )
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }
    fs.rmSync('/tmp/.X11-unix/X199', { force: true })
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})
