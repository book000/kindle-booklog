import assert from 'node:assert/strict'
import childProcess, { type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  captureChromiumLaunch,
  ChromiumLaunchError,
  collectChromiumLaunchEnvironment,
  type ChromiumLaunchAttemptReport,
  type ChromiumLaunchCapture,
  type ChromiumLaunchReportContext,
  readChromiumVersion,
  redactCredentials,
  STDERR_CAPTURE_MAX_BYTES,
} from './chromium-launch-diagnostics'

const spawnedChildren: ChildProcess[] = []

after(() => {
  for (const child of spawnedChildren) {
    child.kill('SIGKILL')
  }
})

/**
 * 偽の Chromium として node を起動する(puppeteer と同じく child_process.spawn 経由)
 *
 * @param script node -e に渡すスクリプト
 * @returns 起動した子プロセス
 */
function spawnFakeChromium(script: string): ChildProcess {
  const child = childProcess.spawn(process.execPath, ['-e', script])
  spawnedChildren.push(child)
  return child
}

function createContext(error: unknown): ChromiumLaunchReportContext {
  return {
    attempt: 1,
    userDataDir: '/tmp/userdata',
    headless: true,
    args: ['--no-sandbox'],
    environment: { display: null, x11Socket: null, singletonFiles: {} },
    chromiumVersion: 'fake-chromium 1.0.0',
    error,
  }
}

async function captureFailure(
  executablePath: string,
  timeoutMs: number,
  launch: () => Promise<never>
): Promise<ChromiumLaunchCapture> {
  const result = await captureChromiumLaunch(
    { executablePath, timeoutMs },
    launch
  )
  assert.equal(result.ok, false)
  return result.capture
}

test('startup timeout: 子が生きたまま launch が reject しても、timeout 時点の生存と stderr を記録する', async () => {
  const capture = await captureFailure(process.execPath, 100, async () => {
    spawnFakeChromium(
      "process.stderr.write('fake-chromium-stderr\\n'); setInterval(() => {}, 1000)"
    )
    await sleep(400)
    throw new Error('Timed out')
  })

  const report = capture.buildReport(createContext(new Error('Timed out')))
  assert.equal(report.failureKind, 'startup-timeout')
  assert.equal(report.processCaptured, true)
  assert.equal(typeof report.pid, 'number')
  const timeoutSample = report.samples.find(
    (sample) => sample.label === 'timeout'
  )
  assert.equal(timeoutSample?.alive, true)
  assert.equal(timeoutSample.exitCode, null)
  assert.equal(timeoutSample.signal, null)
  assert.ok(capture.stderr().text.includes('fake-chromium-stderr'))
}).catch((error: unknown) => {
  throw error
})

test('timeoutMs より前に launch が settle した場合は timeout サンプルを採取しない', async () => {
  const capture = await captureFailure(process.execPath, 200, () => {
    spawnFakeChromium('setInterval(() => {}, 1000)')
    return Promise.reject(new Error('failed immediately'))
  })
  await sleep(400)

  const report = capture.buildReport(createContext(new Error('x')))
  assert.deepEqual(
    report.samples.map((sample) => sample.label),
    ['rejection']
  )
}).catch((error: unknown) => {
  throw error
})

test('early exit: 終了コードと stderr を記録する', async () => {
  const capture = await captureFailure(process.execPath, 5000, async () => {
    const child = spawnFakeChromium(
      "process.stderr.write('fatal: boom\\n'); process.exit(3)"
    )
    await once(child, 'close')
    throw new Error('Failed to launch the browser process: Code: 3')
  })
  await capture.waitForExit(1000)
  capture.sample('final')

  const report = capture.buildReport(createContext(new Error('x')))
  assert.equal(report.failureKind, 'early-exit')
  const finalSample = report.samples.find((sample) => sample.label === 'final')
  assert.equal(finalSample?.alive, false)
  assert.equal(finalSample.exitCode, 3)
  assert.equal(finalSample.signal, null)
  assert.equal(capture.stderr().text, 'fatal: boom\n')
}).catch((error: unknown) => {
  throw error
})

test('signal 終了: signal 名を記録する', async () => {
  const capture = await captureFailure(process.execPath, 5000, async () => {
    const child = spawnFakeChromium(
      "process.stderr.write('about to die\\n'); process.kill(process.pid, 'SIGSEGV')"
    )
    await once(child, 'close')
    throw new Error('Failed to launch the browser process: Code: null')
  })
  await capture.waitForExit(1000)
  capture.sample('final')

  const report = capture.buildReport(createContext(new Error('x')))
  assert.equal(report.failureKind, 'signal')
  const finalSample = report.samples.find((sample) => sample.label === 'final')
  assert.equal(finalSample?.alive, false)
  assert.equal(finalSample.exitCode, null)
  assert.equal(finalSample.signal, 'SIGSEGV')
}).catch((error: unknown) => {
  throw error
})

test('spawn エラー: 存在しない実行ファイルは spawn-error で pid は null', async () => {
  const missing = '/nonexistent/chromium-for-test'
  const capture = await captureFailure(missing, 5000, async () => {
    const child = childProcess.spawn(missing, [])
    await once(child, 'error')
    throw new Error('spawn ENOENT')
  })

  const report = capture.buildReport(createContext(new Error('x')))
  assert.equal(report.failureKind, 'spawn-error')
  assert.equal(report.processCaptured, true)
  assert.equal(report.pid, null)
}).catch((error: unknown) => {
  throw error
})

test('executablePath と異なるコマンドの spawn は記録せず、failureKind は unknown', async () => {
  const capture = await captureFailure('/nonexistent/other', 5000, () => {
    spawnFakeChromium('')
    return Promise.reject(new Error('failed'))
  })

  const report = capture.buildReport(createContext(new Error('x')))
  assert.equal(report.processCaptured, false)
  assert.equal(report.pid, null)
  assert.deepEqual(report.samples, [])
  assert.equal(report.failureKind, 'unknown')
  assert.equal(capture.stderr().text, '')
  await capture.waitForExit(1000)
}).catch((error: unknown) => {
  throw error
})

test('child_process.spawn は成功・失敗のどちらの後でも元の関数に戻る', async () => {
  const original = childProcess.spawn

  const success = await captureChromiumLaunch(
    { executablePath: process.execPath, timeoutMs: 5000 },
    () => {
      assert.notEqual(childProcess.spawn, original)
      return Promise.resolve('launched')
    }
  )
  assert.deepEqual(success, { ok: true, value: 'launched' })
  assert.equal(childProcess.spawn, original)

  await captureFailure(process.execPath, 5000, () =>
    Promise.reject(new Error('failed'))
  )
  assert.equal(childProcess.spawn, original)
}).catch((error: unknown) => {
  throw error
})

test('captureChromiumLaunch の再入は例外にする', async () => {
  const original = childProcess.spawn
  await captureFailure(process.execPath, 5000, async () => {
    await assert.rejects(
      captureChromiumLaunch(
        { executablePath: process.execPath, timeoutMs: 5000 },
        () => Promise.resolve('nested')
      ),
      { message: 'captureChromiumLaunch is already running' }
    )
    throw new Error('failed')
  })
  assert.equal(childProcess.spawn, original)
}).catch((error: unknown) => {
  throw error
})

test('成功時は stderr のリスナーを解除し、子プロセスは生かしたままにする', async () => {
  let child: ChildProcess | undefined
  const result = await captureChromiumLaunch(
    { executablePath: process.execPath, timeoutMs: 5000 },
    () => {
      child = spawnFakeChromium('setInterval(() => {}, 1000)')
      return Promise.resolve(child)
    }
  )

  assert.equal(result.ok, true)
  assert.ok(child)
  assert.equal(child.stderr?.listenerCount('data'), 0)
  assert.equal(child.exitCode, null)
  assert.equal(child.signalCode, null)
}).catch((error: unknown) => {
  throw error
})

test('stderr は末尾 STDERR_CAPTURE_MAX_BYTES だけ保持し、切り詰めを記録する', async () => {
  const capture = await captureFailure(process.execPath, 5000, async () => {
    const child = spawnFakeChromium(
      "process.stderr.write('x'.repeat(200 * 1024)); process.stderr.write('TAIL-MARKER\\n')"
    )
    await once(child, 'close')
    throw new Error('failed')
  })

  const { text, truncated } = capture.stderr()
  assert.equal(truncated, true)
  assert.ok(Buffer.byteLength(text) <= STDERR_CAPTURE_MAX_BYTES)
  assert.ok(text.endsWith('TAIL-MARKER\n'))
}).catch((error: unknown) => {
  throw error
})

test('redactCredentials は scheme://user:pass@host の認証情報を伏せる', () => {
  assert.equal(
    redactCredentials('--proxy-server=http://user:pass@host:8080'),
    '--proxy-server=http://***@host:8080'
  )
  assert.equal(
    redactCredentials('no credentials: http://host:8080/path'),
    'no credentials: http://host:8080/path'
  )
}).catch((error: unknown) => {
  throw error
})

test('redactCredentials は長い英数字の連続でも短時間で終わる', () => {
  const longRun = 'x'.repeat(STDERR_CAPTURE_MAX_BYTES)
  const startedAt = Date.now()

  assert.equal(redactCredentials(longRun), longRun)
  assert.ok(Date.now() - startedAt < 500)
}).catch((error: unknown) => {
  throw error
})

test('レポートの args・stderr・error に認証情報を含めない', async () => {
  const capture = await captureFailure(process.execPath, 5000, async () => {
    const child = spawnFakeChromium(
      "process.stderr.write('proxy http://user:pass@host:8080 refused\\n')"
    )
    await once(child, 'close')
    throw new Error('connect http://user:pass@host:8080 failed')
  })
  const context = {
    ...createContext(new Error('connect http://user:pass@host:8080 failed')),
    args: ['--proxy-server=http://user:pass@host:8080'],
  }

  const report = capture.buildReport(context)
  assert.deepEqual(report.args, ['--proxy-server=http://***@host:8080'])
  assert.equal(report.stderrTail, 'proxy http://***@host:8080 refused\n')
  assert.equal(report.error.message, 'connect http://***@host:8080 failed')
  assert.equal(capture.stderr().text, 'proxy http://***@host:8080 refused\n')
  assert.equal(JSON.stringify(report).includes('user:pass'), false)
}).catch((error: unknown) => {
  throw error
})

test('Error 以外が投げられた場合は NonError として記録する', async () => {
  const capture = await captureFailure(process.execPath, 5000, () =>
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    Promise.reject('plain string failure')
  )

  const report = capture.buildReport(createContext('plain string failure'))
  assert.deepEqual(report.error, {
    name: 'NonError',
    message: 'plain string failure',
  })
}).catch((error: unknown) => {
  throw error
})

/**
 * shebang を node にした実行可能なスクリプトを作る(偽の chromium --version 用)
 *
 * @param directory 作成先ディレクトリ
 * @param name ファイル名
 * @param body スクリプト本体
 * @returns 作成したスクリプトのパス
 */
function createExecutableScript(
  directory: string,
  name: string,
  body: string
): string {
  const scriptPath = path.join(directory, name)
  fs.writeFileSync(scriptPath, `#!${process.execPath}\n${body}\n`)
  fs.chmodSync(scriptPath, 0o755)
  return scriptPath
}

test('readChromiumVersion は --version の出力を返し、失敗・timeout では unavailable を返す', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-version-'))
  try {
    const okScript = createExecutableScript(
      directory,
      'ok.js',
      "if (process.argv[2] === '--version') console.log('fake-chromium 1.2.3')"
    )
    const hangScript = createExecutableScript(
      directory,
      'hang.js',
      'setTimeout(() => {}, 10_000)'
    )

    assert.equal(
      await readChromiumVersion(okScript, 3000),
      'fake-chromium 1.2.3'
    )

    const startedAt = Date.now()
    const timedOut = await readChromiumVersion(hangScript, 200)
    assert.ok(timedOut.startsWith('unavailable: '), timedOut)
    assert.ok(Date.now() - startedAt < 3000)

    const missing = await readChromiumVersion('/nonexistent/chromium', 3000)
    assert.ok(missing.startsWith('unavailable: '), missing)
    const empty = await readChromiumVersion('', 3000)
    assert.ok(empty.startsWith('unavailable: '), empty)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})

/**
 * DISPLAY を一時的に差し替えて関数を実行する
 *
 * @param display 設定する値。undefined なら未設定にする
 * @param run 実行する関数
 * @returns run の戻り値
 */
function withDisplay<T>(display: string | undefined, run: () => T): T {
  const original = process.env.DISPLAY
  if (display === undefined) {
    delete process.env.DISPLAY
  } else {
    process.env.DISPLAY = display
  }
  try {
    return run()
  } finally {
    if (original === undefined) {
      delete process.env.DISPLAY
    } else {
      process.env.DISPLAY = original
    }
  }
}

test('collectChromiumLaunchEnvironment は DISPLAY・X11 ソケット・Singleton* の有無を返す', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-env-'))
  try {
    fs.writeFileSync(path.join(directory, 'SingletonLock'), '')

    const unset = withDisplay(undefined, () =>
      collectChromiumLaunchEnvironment(directory)
    )
    assert.deepEqual(unset, {
      display: null,
      x11Socket: null,
      singletonFiles: {
        SingletonLock: true,
        SingletonCookie: false,
        SingletonSocket: false,
      },
    })

    const empty = withDisplay('', () =>
      collectChromiumLaunchEnvironment(directory)
    )
    assert.equal(empty.display, '')
    assert.equal(empty.x11Socket, null)

    const set = withDisplay(':99.0', () =>
      collectChromiumLaunchEnvironment(directory)
    )
    assert.equal(set.display, ':99.0')
    assert.deepEqual(set.x11Socket, {
      path: '/tmp/.X11-unix/X99',
      exists: fs.existsSync('/tmp/.X11-unix/X99'),
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}).catch((error: unknown) => {
  throw error
})

function createLaunchError(
  cause: unknown,
  attempts: ChromiumLaunchAttemptReport[]
): ChromiumLaunchError {
  return new ChromiumLaunchError('Failed to launch Chromium after retry', {
    cause,
    attempts,
  })
}

test('ChromiumLaunchError は attempts と cause を保持し、stack の先頭フレームは呼び出し元にする', () => {
  const cause = new Error('second attempt failure')
  const attempts: ChromiumLaunchAttemptReport[] = []

  const error = createLaunchError(cause, attempts)

  assert.equal(error.name, 'Error')
  assert.equal(error.message, 'Failed to launch Chromium after retry')
  assert.equal(error.cause, cause)
  assert.equal(error.attempts, attempts)
  assert.ok(error instanceof Error)
  const firstFrame = (error.stack ?? '').split('\n', 2)[1]
  assert.ok(firstFrame.includes('createLaunchError'), firstFrame)
}).catch((error: unknown) => {
  throw error
})
