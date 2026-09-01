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

/**
 * ファイルの中身が期待値と一致するまで待機する
 *
 * @param filePath 監視対象のファイルパス
 * @param expectedContent 期待する内容(前後の空白は無視する)
 * @param timeoutMs タイムアウト時間(ミリ秒)
 */
async function waitForFileContent(
  filePath: string,
  expectedContent: string,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now()
  while (
    !fs.existsSync(filePath) ||
    fs.readFileSync(filePath, 'utf8').trim() !== expectedContent
  ) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${filePath} to contain "${expectedContent}"`
      )
    }
    await delay(20)
  }
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
  writeExecutable(path.join(fakeBin, 'xdpyinfo'), '#!/bin/sh\nexit 0\n')
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

test('X ディスプレイが不健全なら再起動してからアプリを起動する', async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kindle-booklog-entrypoint-test-')
  )
  const fakeBin = path.join(temporaryDirectory, 'bin')
  const markerPath = path.join(temporaryDirectory, 'pnpm-started')
  const xvfbCountPath = path.join(temporaryDirectory, 'xvfb-count')
  fs.mkdirSync(fakeBin)

  // Xvfb は起動するたびに起動回数を記録する(ソケットは常に存在するが、
  // xdpyinfo は 1 回目の起動後は「応答しない」ものとして扱う = 生死不明のスタブ)
  writeExecutable(
    path.join(fakeBin, 'Xvfb'),
    `#!/bin/sh
display="\${1#:}"
count=0
[ -f "${xvfbCountPath}" ] && count=$(cat "${xvfbCountPath}")
count=$((count + 1))
echo "$count" > "${xvfbCountPath}"
mkdir -p /tmp/.X11-unix
touch "/tmp/.X11-unix/X$display"
sleep 10
`
  )
  writeExecutable(path.join(fakeBin, 'x11vnc'), '#!/bin/sh\nsleep 10\n')
  writeExecutable(
    path.join(fakeBin, 'xdpyinfo'),
    // 1 回目の Xvfb 起動時は不健全、再起動後 (2 回目以降) は健全とみなす
    `#!/bin/sh
count=0
[ -f "${xvfbCountPath}" ] && count=$(cat "${xvfbCountPath}")
[ "$count" -ge 2 ]
`
  )
  writeExecutable(
    path.join(fakeBin, 'pnpm'),
    `#!/bin/sh
touch "${markerPath}"
exit 0
`
  )

  const child = spawn('sh', [ENTRYPOINT_PATH], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      DISPLAY: ':198',
      WINDOW_WIDTH: '1200',
      WINDOW_HEIGHT: '1700',
    },
  })

  try {
    await waitForFile(markerPath, 5000)
    await waitForFile(xvfbCountPath, 5000)
    const xvfbLaunchCount = fs.readFileSync(xvfbCountPath, 'utf8').trim()
    assert.equal(
      xvfbLaunchCount,
      '2',
      'Xvfb should be restarted exactly once when the display is unhealthy'
    )
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }
    fs.rmSync('/tmp/.X11-unix/X198', { force: true })
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})

test('再起動してもディスプレイが不健全なままなら、そのサイクルではアプリを起動しない', async () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kindle-booklog-entrypoint-test-')
  )
  const fakeBin = path.join(temporaryDirectory, 'bin')
  const markerPath = path.join(temporaryDirectory, 'pnpm-started')
  const xvfbCountPath = path.join(temporaryDirectory, 'xvfb-count')
  fs.mkdirSync(fakeBin)

  writeExecutable(
    path.join(fakeBin, 'Xvfb'),
    `#!/bin/sh
display="\${1#:}"
count=0
[ -f "${xvfbCountPath}" ] && count=$(cat "${xvfbCountPath}")
count=$((count + 1))
echo "$count" > "${xvfbCountPath}"
mkdir -p /tmp/.X11-unix
touch "/tmp/.X11-unix/X$display"
sleep 10
`
  )
  writeExecutable(path.join(fakeBin, 'x11vnc'), '#!/bin/sh\nsleep 10\n')
  // 再起動してもディスプレイは応答しないままにする
  writeExecutable(path.join(fakeBin, 'xdpyinfo'), '#!/bin/sh\nexit 1\n')
  writeExecutable(
    path.join(fakeBin, 'pnpm'),
    `#!/bin/sh
touch "${markerPath}"
exit 0
`
  )

  const child = spawn('sh', [ENTRYPOINT_PATH], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      DISPLAY: ':197',
      WINDOW_WIDTH: '1200',
      WINDOW_HEIGHT: '1700',
    },
  })

  try {
    // 初回起動 + 再起動 1 回で Xvfb が 2 回起動されるまで待つ
    // (それ以上増え続けないこと = 内部で無限リトライしていないことの傍証にもなる)
    await waitForFileContent(xvfbCountPath, '2', 5000)
    await delay(2000)
    assert.ok(
      !fs.existsSync(markerPath),
      'pnpm start must not run while the display stays unhealthy after one restart'
    )
    const xvfbLaunchCount = fs.readFileSync(xvfbCountPath, 'utf8').trim()
    assert.equal(
      xvfbLaunchCount,
      '2',
      'Xvfb must be restarted only once per unhealthy cycle, not retried indefinitely'
    )
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }
    fs.rmSync('/tmp/.X11-unix/X197', { force: true })
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})
