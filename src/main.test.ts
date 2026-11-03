import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

interface LogEntry {
  level: 'error' | 'info' | 'warn'
  message: string
}

/**
 * puppeteer.launch をモックして main.ts を実行し、記録されたログを返す
 *
 * @param alwaysFail true なら全ての起動を失敗させる（false は 1 回目のみ失敗）
 * @returns 記録されたログエントリ
 */
function runMainWithLaunchFailures(alwaysFail: boolean): LogEntry[] {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kindle-booklog-main-test-')
  )
  const configPath = path.join(temporaryDirectory, 'config.json')
  const logPath = path.join(temporaryDirectory, 'logs.json')
  const preloadPath = path.join(temporaryDirectory, 'preload.cjs')

  fs.writeFileSync(configPath, JSON.stringify({ amazon: {}, discord: {} }))
  fs.writeFileSync(
    preloadPath,
    `
const Module = require('node:module')
const fs = require('node:fs')
const logEntries = []
let launchAttempts = 0
const browser = {
  newPage: async () => {
    throw new Error('downstream fixture failure')
  },
  pages: async () => [],
  close: async () => {},
}
const logger = {
  info: (message) => logEntries.push({ level: 'info', message }),
  warn: (message) => logEntries.push({ level: 'warn', message }),
  error: (message) => logEntries.push({ level: 'error', message }),
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === '@book000/node-utils') {
    return {
      Logger: { configure: () => logger },
      Discord: class {
        async sendMessage() {}
      },
    }
  }
  if (request === 'puppeteer-core') {
    return {
      __esModule: true,
      default: {
        launch: async () => {
          launchAttempts += 1
          if (${alwaysFail} || launchAttempts === 1) {
            throw new Error('first launch failure')
          }
          return browser
        },
      },
    }
  }
  if (request === 'node:timers/promises') {
    return { setTimeout: async () => {} }
  }
  return originalLoad.call(this, request, parent, isMain)
}
process.on('exit', () => {
  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(logEntries))
})
`
  )

  try {
    const result = spawnSync(
      process.execPath,
      ['--require', preloadPath, '--import', 'tsx', 'src/main.ts'],
      {
        cwd: path.resolve(),
        encoding: 'utf8',
        env: {
          ...process.env,
          BROWSER_USER_DATA_DIR: path.join(temporaryDirectory, 'userdata'),
          CONFIG_PATH: configPath,
          DISPLAY: '',
        },
      }
    )

    assert.equal(result.status, 0, result.stderr)

    return JSON.parse(fs.readFileSync(logPath, 'utf8')) as LogEntry[]
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

test('Chromium 起動診断は成功時に情報ログとして出力し、1 回目の起動失敗は info にする', () => {
  const logEntries = runMainWithLaunchFailures(false)
  {
    const diagnosticEntries = logEntries.filter((entry) =>
      entry.message.startsWith('Chromium launch diagnostics:')
    )

    assert.equal(diagnosticEntries.length, 12)
    assert.ok(diagnosticEntries.every((entry) => entry.level === 'info'))
    assert.equal(
      logEntries.some(
        (entry) =>
          entry.level === 'info' &&
          entry.message === 'Failed to launch Chromium (attempt 1/2), retrying'
      ),
      true
    )
  }
}).catch((error: unknown) => {
  throw error
})

test('Chromium の最終起動失敗は error を 1 回だけ報告する', () => {
  const errors = runMainWithLaunchFailures(true).filter(
    (entry) => entry.level === 'error'
  )
  assert.deepEqual(
    errors.map((entry) => entry.message),
    ['Failed to launch Chromium']
  )
}).catch((error: unknown) => {
  throw error
})
