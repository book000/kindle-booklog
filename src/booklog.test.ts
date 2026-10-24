import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import Booklog, { BooklogLoginRequiredError } from './booklog'

// 既存テストが実ファイル（data/）を触らないよう保存先を隔離する
const isolatedDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'booklog-test-')
)
process.env.BOOKLOG_LOGIN_STATE = path.join(isolatedDirectory, 'state.json')
process.env.COOKIE_BOOKLOG = path.join(isolatedDirectory, 'cookie.json')
process.on('exit', () => {
  fs.rmSync(isolatedDirectory, { recursive: true, force: true })
})

const BOOKLOG_EXPORT_URL = 'https://booklog.jp/export'
const BOOKLOG_LOGIN_URL = 'https://booklog.jp/login'

class FakePage {
  public gotoCalls: string[] = []
  public closed = false
  public waitForSelectorCalled = false
  public waitForFunctionCalled = false
  public gotoWaitUntil: (string | undefined)[] = []
  private currentUrl = 'about:blank'
  private urlChecks = 0

  constructor(
    private readonly authenticated: boolean,
    private readonly manualLoginSucceeds = false,
    private gotoFailuresRemaining = 0
  ) {}

  public goto(url: string, options?: { waitUntil?: string }): Promise<void> {
    this.gotoCalls.push(url)
    this.gotoWaitUntil.push(options?.waitUntil)
    if (this.gotoFailuresRemaining > 0) {
      this.gotoFailuresRemaining -= 1
      return Promise.reject(new Error('transient navigation failure'))
    }
    this.currentUrl =
      url === BOOKLOG_EXPORT_URL && !this.authenticated
        ? BOOKLOG_LOGIN_URL
        : url
    return Promise.resolve()
  }

  public url(): string {
    this.urlChecks += 1
    if (
      this.manualLoginSucceeds &&
      this.currentUrl === BOOKLOG_LOGIN_URL &&
      this.urlChecks >= 2
    ) {
      this.currentUrl = BOOKLOG_EXPORT_URL
    }
    return this.currentUrl
  }

  public waitForFunction(): Promise<void> {
    this.waitForFunctionCalled = true
    return Promise.reject(new Error('page script evaluation must not run'))
  }

  public waitForSelector(): Promise<never> {
    this.waitForSelectorCalled = true
    return Promise.reject(new Error('automatic login must not run'))
  }

  public close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

class FakeMutationPage {
  public waitForNavigationOptions: { waitUntil?: string }[] = []
  public closed = false

  public goto(): Promise<void> {
    return Promise.resolve()
  }

  public waitForSelector(): Promise<{ click: () => Promise<void> }> {
    return Promise.resolve({ click: () => Promise.resolve() })
  }

  public waitForNavigation(options?: { waitUntil?: string }): Promise<void> {
    this.waitForNavigationOptions.push(options ?? {})
    return Promise.resolve()
  }

  public close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

function createBooklog(page: FakePage): Booklog {
  const browser = {
    newPage: () => Promise.resolve(page),
    cookies: () => Promise.resolve([]),
  } as unknown as Browser

  return new Booklog({ browser })
}

test('認証済みプロファイルでは Booklog の自動ログインを実行しない', async () => {
  const page = new FakePage(true)
  const booklog = createBooklog(page)

  await booklog.login()

  assert.deepEqual(page.gotoCalls, [BOOKLOG_EXPORT_URL])
  assert.equal(page.waitForSelectorCalled, false)
  assert.equal(page.closed, true)
}).catch((error: unknown) => {
  throw error
})

test('Booklog の画面遷移は network idle ではなく DOMContentLoaded を待つ', async () => {
  const page = new FakePage(true)
  const booklog = createBooklog(page)

  await booklog.login()

  assert.deepEqual(page.gotoWaitUntil, ['domcontentloaded'])
}).catch((error: unknown) => {
  throw error
})

test('Booklog の一時的な画面遷移失敗を再試行する', async () => {
  const page = new FakePage(true, false, 1)
  const booklog = createBooklog(page)

  await booklog.login()

  assert.deepEqual(page.gotoCalls, [BOOKLOG_EXPORT_URL, BOOKLOG_EXPORT_URL])
  assert.equal(page.closed, true)
}).catch((error: unknown) => {
  throw error
})

test('Booklog の登録後遷移は DOMContentLoaded を待つ', async () => {
  const page = new FakeMutationPage()
  const browser = {
    newPage: () => Promise.resolve(page),
  } as unknown as Browser
  const booklog = new Booklog({ browser })

  await booklog.addBookshelfBook('TEST')

  assert.deepEqual(page.waitForNavigationOptions, [
    { waitUntil: 'domcontentloaded' },
  ])
  assert.equal(page.closed, true)
}).catch((error: unknown) => {
  throw error
})

test('未認証なら資格情報を自動送信せず手動ログイン要求を返す', async () => {
  const page = new FakePage(false)
  const booklog = createBooklog(page)
  const previousTimeout = process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS
  process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS = '1'

  try {
    await assert.rejects(booklog.login(), /Booklog manual login required/)
  } finally {
    // 後続テストがバックオフの影響を受けないよう状態を消す
    fs.rmSync(process.env.BOOKLOG_LOGIN_STATE ?? '', { force: true })
    if (previousTimeout === undefined) {
      delete process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS
    } else {
      process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS = previousTimeout
    }
  }

  assert.equal(page.waitForSelectorCalled, false)
}).catch((error: unknown) => {
  throw error
})

test('手動ログイン待ちはページ内 JavaScript を評価せず URL 変化を検出する', async () => {
  const page = new FakePage(false, true)
  const booklog = createBooklog(page)

  await booklog.login()

  assert.equal(page.waitForFunctionCalled, false)
  assert.equal(page.closed, true)
  assert.deepEqual(page.gotoCalls, [BOOKLOG_EXPORT_URL, BOOKLOG_EXPORT_URL])
}).catch((error: unknown) => {
  throw error
})

test('本棚取得時に認証切れなら selector timeout より先に失敗する', async () => {
  const page = new FakePage(false)
  const booklog = createBooklog(page)

  await assert.rejects(
    booklog.getBookshelfBooks(),
    /Booklog authentication required/
  )

  assert.equal(page.waitForSelectorCalled, false)
}).catch((error: unknown) => {
  throw error
})

class FakeExportPage {
  public closed = false

  public goto(): Promise<void> {
    return Promise.resolve()
  }

  public url(): string {
    return BOOKLOG_EXPORT_URL
  }

  public waitForSelector(): Promise<unknown> {
    return Promise.resolve({})
  }

  public $eval(): Promise<string> {
    return Promise.resolve('https://booklog.jp/export/xxxx.csv')
  }

  public close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

function withFakeFetch<T>(
  impl: () => Promise<Response>,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = fetch
  globalThis.fetch = impl
  return run().finally(() => {
    globalThis.fetch = originalFetch
  })
}

test('CSV エクスポート取得の一時的な fetch 失敗を再試行する', async () => {
  const page = new FakeExportPage()
  const booklog = createBooklog(page as unknown as FakePage)

  let calls = 0
  const books = await withFakeFetch(
    () => {
      calls += 1
      return calls === 1
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(new Response(''))
    },
    () => booklog.getBookshelfBooks()
  )

  assert.equal(calls, 2)
  assert.deepEqual(books, [])
}).catch((error: unknown) => {
  throw error
})

test('CSV エクスポート取得が再試行上限に達したら最後のエラーを投げる', async () => {
  const page = new FakeExportPage()
  const booklog = createBooklog(page as unknown as FakePage)

  let calls = 0
  await assert.rejects(
    withFakeFetch(
      () => {
        calls += 1
        return Promise.reject(new TypeError('fetch failed'))
      },
      () => booklog.getBookshelfBooks()
    ),
    /fetch failed/
  )

  assert.equal(calls, 3)
}).catch((error: unknown) => {
  throw error
})

/**
 * 一時ディレクトリを状態・Cookie ファイルの保存先に設定して処理を実行する
 *
 * @param run 実行する処理
 */
async function withTemporaryState(run: (statePath: string) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'booklog-state-'))
  const statePath = path.join(directory, 'state.json')
  const previous = {
    state: process.env.BOOKLOG_LOGIN_STATE,
    cookie: process.env.COOKIE_BOOKLOG,
    timeout: process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS,
  }
  process.env.BOOKLOG_LOGIN_STATE = statePath
  process.env.COOKIE_BOOKLOG = path.join(directory, 'cookie.json')
  process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS = '1'
  try {
    await run(statePath)
  } finally {
    for (const [key, value] of [
      ['BOOKLOG_LOGIN_STATE', previous.state],
      ['COOKIE_BOOKLOG', previous.cookie],
      ['BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS', previous.timeout],
    ] as const) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('バックオフ期間内は手動ログインを待たず即座に BooklogLoginRequiredError を投げる', async () => {
  await withTemporaryState(async (statePath) => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({ lastAttempt: Date.now(), notified: true })
    )
    // 待機すれば成功する page でも、待たずに失敗する
    const page = new FakePage(false, true)
    await assert.rejects(createBooklog(page).login(), BooklogLoginRequiredError)
    assert.equal(page.closed, true)
  })
}).catch((error: unknown) => {
  throw error
})

test('手動ログインがタイムアウトしたら状態ファイルを書き込む', async () => {
  await withTemporaryState(async (statePath) => {
    await assert.rejects(
      createBooklog(new FakePage(false)).login(),
      BooklogLoginRequiredError
    )
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      lastAttempt: unknown
      notified: unknown
    }
    assert.equal(typeof state.lastAttempt, 'number')
    assert.equal(state.notified, false)
  })
}).catch((error: unknown) => {
  throw error
})

test('バックオフ期間を過ぎていれば再び手動ログインを待ち、成功すれば状態と Cookie を保存する', async () => {
  await withTemporaryState(async (statePath) => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({ lastAttempt: Date.now() - 3_700_000, notified: true })
    )
    const browser = {
      newPage: () => Promise.resolve(new FakePage(false, true)),
      cookies: () =>
        Promise.resolve([
          {
            name: 'a',
            value: 'x',
            domain: '.booklog.jp',
            session: true,
            expires: -1,
          },
          {
            name: 'b',
            value: 'x',
            domain: '.amazon.co.jp',
            session: true,
            expires: -1,
          },
        ]),
    } as unknown as Browser
    await new Booklog({ browser }).login()
    assert.equal(fs.existsSync(statePath), false)
    const saved = JSON.parse(
      fs.readFileSync(process.env.COOKIE_BOOKLOG ?? '', 'utf8')
    ) as { session: boolean; expires: number }[]
    assert.equal(saved.length, 1)
    assert.equal(saved[0].session, false)
    assert.ok(saved[0].expires > Date.now() / 1000)
  })
}).catch((error: unknown) => {
  throw error
})

test('認証済みなら状態ファイルを削除する', async () => {
  await withTemporaryState(async (statePath) => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({ lastAttempt: 1, notified: true })
    )
    await createBooklog(new FakePage(true)).login()
    assert.equal(fs.existsSync(statePath), false)
  })
}).catch((error: unknown) => {
  throw error
})

test('a#execExport が見つからなければ BooklogLoginRequiredError を投げ状態を記録する', async () => {
  await withTemporaryState(async (statePath) => {
    const page = new FakeExportPage()
    page.waitForSelector = () => Promise.reject(new Error('timeout'))
    const browser = {
      newPage: () => Promise.resolve(page),
    } as unknown as Browser
    await assert.rejects(
      new Booklog({ browser }).getBookshelfBooks(),
      (error: unknown) =>
        error instanceof BooklogLoginRequiredError &&
        (error.cause as Error).message === 'timeout'
    )
    assert.equal(fs.existsSync(statePath), true)
  })
}).catch((error: unknown) => {
  throw error
})
