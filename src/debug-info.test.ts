import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import type { Logger } from '@book000/node-utils'
import type { ChromiumLaunchAttemptReport } from './chromium-launch-diagnostics'
import {
  pruneDebugDirectory,
  saveChromiumLaunchLog,
  saveDebugInfo,
} from './debug-info'

/** テスト用ロガーが記録するログエントリ */
interface LogEntry {
  level: 'debug' | 'info' | 'warn'
  message: string
}

/**
 * テスト用ロガーとログ記録先を生成する
 *
 * @returns ロガーとログ記録配列
 */
function createLogger() {
  const entries: LogEntry[] = []
  const logger = {
    debug: (message: string) => {
      entries.push({ level: 'debug', message })
    },
    info: (message: string) => {
      entries.push({ level: 'info', message })
    },
    warn: (message: string) => {
      entries.push({ level: 'warn', message })
    },
  } as unknown as Logger
  return { logger, entries }
}

/**
 * 一時ディレクトリを DEBUG_DIRECTORY に設定して処理を実行する
 *
 * @param action 実行する処理
 */
async function withDebugDirectory(
  action: (directory: string) => Promise<void>
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-debug-test-'))
  const original = process.env.DEBUG_DIRECTORY
  process.env.DEBUG_DIRECTORY = directory
  try {
    await action(directory)
  } finally {
    if (original === undefined) delete process.env.DEBUG_DIRECTORY
    else process.env.DEBUG_DIRECTORY = original
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * テスト用の page を生成する
 *
 * @param options page の挙動
 * @returns page のモック
 */
function createPage(options: {
  url: string
  closed?: boolean
  screenshotError?: Error
}) {
  const calls = { screenshot: 0, content: 0 }
  const page = {
    isClosed: () => options.closed ?? false,
    url: () => options.url,
    screenshot: (screenshotOptions: Record<string, unknown>) => {
      calls.screenshot++
      assert.equal(screenshotOptions.fullPage, undefined)
      return options.screenshotError
        ? Promise.reject(options.screenshotError)
        : Promise.resolve()
    },
    content: () => {
      calls.content++
      return Promise.resolve('<html></html>')
    },
  }
  return { page, calls }
}

test('saveDebugInfo は閉じた page と about:blank をスキップする', async () => {
  await withDebugDirectory(async () => {
    const closed = createPage({ url: 'https://example.com', closed: true })
    const blank = createPage({ url: 'about:blank' })
    const { logger } = createLogger()
    const browser = {
      pages: () => Promise.resolve([closed.page, blank.page]),
    } as unknown as Browser

    await saveDebugInfo(browser, logger)

    assert.deepEqual(closed.calls, { screenshot: 0, content: 0 })
    assert.deepEqual(blank.calls, { screenshot: 0, content: 0 })
  })
}).catch((error: unknown) => {
  throw error
})

test('saveDebugInfo は screenshot 失敗を warn ではなく debug で記録する', async () => {
  await withDebugDirectory(async (directory) => {
    const target = createPage({
      url: 'https://example.com',
      screenshotError: new Error('screenshot failed'),
    })
    const { logger, entries } = createLogger()
    const browser = {
      pages: () => Promise.resolve([target.page]),
    } as unknown as Browser

    await saveDebugInfo(browser, logger)

    assert.equal(
      entries.some((entry) => entry.level === 'warn'),
      false
    )
    assert.equal(
      entries.some(
        (entry) =>
          entry.level === 'debug' && entry.message.includes('screenshot failed')
      ),
      true
    )
    // HTML は引き続き保存される
    assert.equal(
      fs.readdirSync(directory).filter((name) => name.endsWith('.html')).length,
      1
    )
  })
}).catch((error: unknown) => {
  throw error
})

test('pruneDebugDirectory は 7 日より古いファイルのみ削除する', async () => {
  await withDebugDirectory((directory) => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    for (const [name, ageDays] of [
      ['error-old.png', 8],
      ['error-new.png', 6],
      // saveDebugInfo 由来ではないファイルは古くても削除しない
      ['unrelated.json', 30],
    ] as const) {
      const filePath = path.join(directory, name)
      fs.writeFileSync(filePath, 'x')
      const mtime = new Date(now - ageDays * day)
      fs.utimesSync(filePath, mtime, mtime)
    }
    const { logger } = createLogger()

    pruneDebugDirectory(logger, now)

    assert.deepEqual(
      fs.readdirSync(directory).toSorted((a, b) => a.localeCompare(b)),
      ['error-new.png', 'unrelated.json']
    )
    return Promise.resolve()
  })
}).catch((error: unknown) => {
  throw error
})

const chromiumLaunchReport: ChromiumLaunchAttemptReport = {
  attempt: 1,
  executablePath: '/usr/bin/chromium-browser',
  userDataDir: '/data/userdata',
  timeoutMs: 60_000,
  headless: false,
  args: ['--no-sandbox'],
  processCaptured: true,
  pid: 1234,
  samples: [
    {
      label: 'timeout',
      msSinceSpawn: 60_001,
      alive: true,
      exitCode: null,
      signal: null,
    },
  ],
  stderrTail: 'tail that duplicates the stderr body',
  stderrTruncated: false,
  chromiumVersion: 'Chromium 1.2.3',
  environment: { display: ':99', x11Socket: null, singletonFiles: {} },
  error: { name: 'TimeoutError', message: 'Timed out' },
  failureKind: 'startup-timeout',
}

test('saveChromiumLaunchLog は試行ごとのログファイルに要約と stderr を保存する', async () => {
  await withDebugDirectory((directory) => {
    const { logger, entries } = createLogger()

    saveChromiumLaunchLog(logger, chromiumLaunchReport, 'fake stderr body\n')

    const files = fs.readdirSync(directory)
    assert.equal(files.length, 1)
    assert.match(files[0], /^error-chromium-launch-.+-attempt1\.log$/)
    const content = fs.readFileSync(path.join(directory, files[0]), 'utf8')
    assert.ok(content.includes('"failureKind": "startup-timeout"'))
    assert.ok(content.includes('"pid": 1234'))
    assert.ok(content.endsWith('\n\n--- stderr ---\nfake stderr body\n'))
    assert.equal(content.includes('stderrTail'), false)
    assert.deepEqual(entries, [])
    return Promise.resolve()
  })
}).catch((error: unknown) => {
  throw error
})

test('saveChromiumLaunchLog は保存に失敗しても例外を投げず info で記録する', async () => {
  await withDebugDirectory((directory) => {
    const blocker = path.join(directory, 'blocker')
    fs.writeFileSync(blocker, 'x')
    process.env.DEBUG_DIRECTORY = path.join(blocker, 'sub')
    const { logger, entries } = createLogger()

    assert.doesNotThrow(() => {
      saveChromiumLaunchLog(logger, chromiumLaunchReport, 'stderr')
    })

    assert.deepEqual(entries, [
      { level: 'info', message: 'Failed to save Chromium launch log' },
    ])
    return Promise.resolve()
  })
}).catch((error: unknown) => {
  throw error
})

test('pruneDebugDirectory は Chromium 起動ログも 7 日を超えたものだけ削除する', async () => {
  await withDebugDirectory((directory) => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    for (const [name, ageDays] of [
      ['error-chromium-launch-old-attempt1.log', 8],
      ['error-chromium-launch-new-attempt2.log', 6],
      // error- で始まらないログ(アプリのログなど)は古くても削除しない
      ['app.log', 30],
    ] as const) {
      const filePath = path.join(directory, name)
      fs.writeFileSync(filePath, 'x')
      const mtime = new Date(now - ageDays * day)
      fs.utimesSync(filePath, mtime, mtime)
    }
    const { logger } = createLogger()

    pruneDebugDirectory(logger, now)

    assert.deepEqual(
      fs.readdirSync(directory).toSorted((a, b) => a.localeCompare(b)),
      ['app.log', 'error-chromium-launch-new-attempt2.log']
    )
    return Promise.resolve()
  })
}).catch((error: unknown) => {
  throw error
})

test('saveDebugInfo は browser.pages() の失敗を warn ではなく info で記録する', async () => {
  await withDebugDirectory(async () => {
    const { logger, entries } = createLogger()
    const browser = {
      pages: () => Promise.reject(new Error('browser unresponsive')),
    } as unknown as Browser

    await saveDebugInfo(browser, logger)

    assert.equal(
      entries.some((entry) => entry.level === 'warn'),
      false
    )
    assert.equal(
      entries.some(
        (entry) =>
          entry.level === 'info' &&
          entry.message === 'Failed to save debug info'
      ),
      true
    )
  })
}).catch((error: unknown) => {
  throw error
})
