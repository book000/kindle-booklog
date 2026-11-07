import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { ChromiumLaunchAttemptReport } from './chromium-launch-diagnostics'

interface LogEntry {
  level: 'error' | 'info' | 'warn'
  message: string
  meta?: {
    extra?: { chromiumLaunch?: ChromiumLaunchAttemptReport[] }
    tags?: Record<string, string>
  }
}

interface DebugFile {
  name: string
  content: string
}

interface MainRunResult {
  logEntries: LogEntry[]
  debugFiles: DebugFile[]
  versionRuns: number
}

/**
 * puppeteer.launch の挙動
 *
 * - first-fails: 1 回目だけ失敗する(プロセスは起動しない)
 * - always-fails: 全ての起動が失敗する(プロセスは起動しない)
 * - always-fails-with-process: 全ての起動で偽の Chromium を起動し、終了コード 3 で失敗する
 */
type LaunchBehavior =
  'first-fails' | 'always-fails' | 'always-fails-with-process'

/**
 * puppeteer.launch をモックして main.ts を実行し、記録されたログと保存されたファイルを返す
 *
 * @param behavior puppeteer.launch の挙動
 * @returns 記録されたログエントリ、DEBUG_DIRECTORY のファイル、`--version` の実行回数
 */
function runMainWithLaunchBehavior(behavior: LaunchBehavior): MainRunResult {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'kindle-booklog-main-test-')
  )
  const configPath = path.join(temporaryDirectory, 'config.json')
  const logPath = path.join(temporaryDirectory, 'logs.json')
  const preloadPath = path.join(temporaryDirectory, 'preload.cjs')
  const debugDirectory = path.join(temporaryDirectory, 'debug')
  const versionLogPath = path.join(temporaryDirectory, 'version-runs.txt')
  const fakeChromiumPath = path.join(temporaryDirectory, 'fake-chromium.js')

  fs.writeFileSync(configPath, JSON.stringify({ amazon: {}, discord: {} }))
  fs.writeFileSync(
    fakeChromiumPath,
    String.raw`#!${process.execPath}
const fs = require('node:fs')
if (process.argv[2] === '--version') {
  fs.appendFileSync(${JSON.stringify(versionLogPath)}, 'run\n')
  console.log('fake-chromium 9.9.9')
} else {
  process.stderr.write('fake-chromium-stderr\n')
  process.exit(3)
}
`,
    { mode: 0o755 }
  )
  fs.writeFileSync(
    preloadPath,
    `
const Module = require('node:module')
const childProcess = require('node:child_process')
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
  debug: () => {},
  info: (message) => logEntries.push({ level: 'info', message }),
  warn: (message) => logEntries.push({ level: 'warn', message }),
  error: (message, _error, meta) =>
    logEntries.push({ level: 'error', message, meta }),
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
        launch: async (options) => {
          launchAttempts += 1
          if (${JSON.stringify(behavior)} === 'always-fails-with-process') {
            const child = childProcess.spawn(options.executablePath, ['--launch'])
            await new Promise((resolve) => child.once('close', resolve))
            throw new Error('Failed to launch the browser process: Code: 3')
          }
          if (${JSON.stringify(behavior)} === 'always-fails' || launchAttempts === 1) {
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
          CHROMIUM_PATH: fakeChromiumPath,
          CONFIG_PATH: configPath,
          DEBUG_DIRECTORY: debugDirectory,
          DISPLAY: '',
        },
      }
    )

    assert.equal(result.status, 0, result.stderr)

    return {
      logEntries: JSON.parse(fs.readFileSync(logPath, 'utf8')) as LogEntry[],
      debugFiles: fs.existsSync(debugDirectory)
        ? fs
            .readdirSync(debugDirectory)
            .toSorted((a, b) => a.localeCompare(b))
            .map((name) => ({
              name,
              content: fs.readFileSync(path.join(debugDirectory, name), 'utf8'),
            }))
        : [],
      versionRuns: fs.existsSync(versionLogPath)
        ? fs.readFileSync(versionLogPath, 'utf8').split('\n').filter(Boolean)
            .length
        : 0,
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

test('Chromium 起動診断は成功時に情報ログとして出力し、1 回目の起動失敗は info にする', () => {
  const { logEntries, debugFiles } = runMainWithLaunchBehavior('first-fails')
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
    assert.equal(
      logEntries.some(
        (entry) =>
          (entry.level === 'error' || entry.level === 'warn') &&
          entry.message.startsWith('Failed to launch Chromium')
      ),
      false
    )
    assert.equal(debugFiles.length, 1)
    assert.match(debugFiles[0].name, /^error-chromium-launch-.+-attempt1\.log$/)
  }
}).catch((error: unknown) => {
  throw error
})

test('Chromium の最終起動失敗は error を 1 回だけ報告し、全試行の診断を添付する', () => {
  const { logEntries, debugFiles, versionRuns } =
    runMainWithLaunchBehavior('always-fails')
  const errors = logEntries.filter((entry) => entry.level === 'error')

  assert.deepEqual(
    errors.map((entry) => entry.message),
    ['Failed to launch Chromium']
  )
  assert.equal(
    logEntries.some((entry) => entry.level === 'warn'),
    false
  )

  const attempts = errors[0].meta?.extra?.chromiumLaunch
  assert.ok(attempts)
  assert.deepEqual(
    attempts.map((report) => report.attempt),
    [1, 2]
  )
  assert.deepEqual(errors[0].meta?.tags, {
    'chromium.failure_kind': 'unknown',
  })
  assert.deepEqual(
    attempts.map((report) => report.chromiumVersion),
    ['fake-chromium 9.9.9', 'fake-chromium 9.9.9']
  )
  assert.equal(versionRuns, 1)
  assert.deepEqual(
    debugFiles.map((file) =>
      file.name.replace(
        /^(error-chromium-launch)-.+-(attempt\d\.log)$/,
        '$1-$2'
      )
    ),
    ['error-chromium-launch-attempt1.log', 'error-chromium-launch-attempt2.log']
  )
}).catch((error: unknown) => {
  throw error
})

test('起動した Chromium が早期 exit した場合、終了コードと stderr を報告とログファイルに残す', () => {
  const { logEntries, debugFiles } = runMainWithLaunchBehavior(
    'always-fails-with-process'
  )
  const errors = logEntries.filter((entry) => entry.level === 'error')

  assert.equal(errors.length, 1)
  assert.deepEqual(errors[0].meta?.tags, {
    'chromium.failure_kind': 'early-exit',
  })
  const attempts = errors[0].meta.extra?.chromiumLaunch
  assert.ok(attempts)
  for (const report of attempts) {
    assert.equal(report.processCaptured, true)
    assert.equal(typeof report.pid, 'number')
    assert.equal(report.failureKind, 'early-exit')
    assert.equal(report.stderrTail, 'fake-chromium-stderr\n')
    assert.ok(
      report.samples.some(
        (sample) =>
          sample.label === 'rejection' &&
          sample.exitCode === 3 &&
          sample.signal === null
      )
    )
  }
  assert.deepEqual(
    attempts[0].samples.map((sample) => sample.label),
    ['rejection', 'retry-start']
  )
  assert.deepEqual(
    attempts[1].samples.map((sample) => sample.label),
    ['rejection', 'final']
  )
  assert.equal(debugFiles.length, 2)
  for (const file of debugFiles) {
    assert.ok(file.content.includes('"failureKind": "early-exit"'))
    assert.ok(file.content.endsWith('--- stderr ---\nfake-chromium-stderr\n'))
  }
}).catch((error: unknown) => {
  throw error
})
