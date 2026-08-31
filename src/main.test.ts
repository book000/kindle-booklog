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

test('Chromium 起動診断は成功時に情報ログとして出力し、起動失敗は error にする', () => {
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
          if (launchAttempts === 1) {
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

    const logEntries = JSON.parse(
      fs.readFileSync(logPath, 'utf8')
    ) as LogEntry[]
    const diagnosticEntries = logEntries.filter((entry) =>
      entry.message.startsWith('Chromium launch diagnostics:')
    )

    assert.equal(diagnosticEntries.length, 12)
    assert.ok(diagnosticEntries.every((entry) => entry.level === 'info'))
    assert.equal(
      logEntries.some(
        (entry) =>
          entry.level === 'error' &&
          entry.message === 'Failed to launch Chromium (attempt 1/2)'
      ),
      true
    )
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})
