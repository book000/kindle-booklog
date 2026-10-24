import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import type { Logger } from '@book000/node-utils'
import { pruneDebugDirectory, saveDebugInfo } from './debug-info'

interface LogEntry {
  level: 'debug' | 'warn'
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
      ['old.png', 8],
      ['new.png', 6],
    ] as const) {
      const filePath = path.join(directory, name)
      fs.writeFileSync(filePath, 'x')
      const mtime = new Date(now - ageDays * day)
      fs.utimesSync(filePath, mtime, mtime)
    }
    const { logger } = createLogger()

    pruneDebugDirectory(logger, now)

    assert.deepEqual(fs.readdirSync(directory), ['new.png'])
    return Promise.resolve()
  })
}).catch((error: unknown) => {
  throw error
})
