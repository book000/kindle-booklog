import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import Booklog from './booklog'

const BOOKLOG_EXPORT_URL = 'https://booklog.jp/export'
const BOOKLOG_LOGIN_URL = 'https://booklog.jp/login'

class FakePage {
  public gotoCalls: string[] = []
  public closed = false
  public waitForSelectorCalled = false
  private currentUrl = 'about:blank'

  constructor(
    private readonly authenticated: boolean,
    private readonly manualLoginSucceeds = false
  ) {}

  public goto(url: string): Promise<void> {
    this.gotoCalls.push(url)
    this.currentUrl =
      url === BOOKLOG_EXPORT_URL && !this.authenticated
        ? BOOKLOG_LOGIN_URL
        : url
    return Promise.resolve()
  }

  public url(): string {
    return this.currentUrl
  }

  public waitForFunction(): Promise<void> {
    if (!this.manualLoginSucceeds) {
      return Promise.reject(new Error('timeout'))
    }
    this.currentUrl = BOOKLOG_EXPORT_URL
    return Promise.resolve()
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

test('未認証なら資格情報を自動送信せず手動ログイン要求を返す', async () => {
  const page = new FakePage(false)
  const booklog = createBooklog(page)
  const previousTimeout = process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS
  process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS = '1'

  try {
    await assert.rejects(booklog.login(), /Booklog manual login required/)
  } finally {
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
