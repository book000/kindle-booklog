import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import Amazon from './amazon'

type LoginStage = 'landing' | 'email' | 'password' | 'mfa' | 'library'

interface FakeAmazonLoginPageOptions {
  hasContinue?: boolean
  requireMfa?: boolean
}

class FakeAmazonLoginPage {
  public waitForNavigationOptions: { waitUntil?: string }[] = []
  public unsynchronizedActions: string[] = []
  private currentUrl = 'about:blank'
  private stage: LoginStage = 'landing'
  private navigationResolver?: () => void

  constructor(private options: FakeAmazonLoginPageOptions = {}) {}

  public goto(): Promise<void> {
    this.currentUrl = 'https://read.amazon.co.jp/landing'
    this.stage = 'landing'
    return Promise.resolve()
  }

  public url(): string {
    return this.currentUrl
  }

  public title(): Promise<string> {
    return Promise.resolve('Amazon Sign-In')
  }

  public waitForNavigation(options?: { waitUntil?: string }): Promise<void> {
    this.waitForNavigationOptions.push(options ?? {})
    return new Promise((resolve) => {
      this.navigationResolver = resolve
    })
  }

  private navigate(label: string, url: string, stage: LoginStage): void {
    if (this.navigationResolver) {
      const resolve = this.navigationResolver
      this.navigationResolver = undefined
      this.currentUrl = url
      this.stage = stage
      resolve()
      return
    }

    this.unsynchronizedActions.push(label)
    this.currentUrl = url
    this.stage = stage
  }

  public waitForSelector(selector: string): Promise<Record<string, unknown>> {
    if (selector === 'button#top-sign-in-btn') {
      return Promise.resolve({
        click: () => {
          this.navigate(
            'top sign-in',
            'https://www.amazon.co.jp/ap/signin',
            'email'
          )
          return Promise.resolve()
        },
      })
    }

    if (selector === 'div#authportal-center-section') {
      return Promise.resolve({})
    }

    if (selector === 'input#ap_email') {
      return Promise.resolve({
        click: () => Promise.resolve(),
        type: () => {
          if (this.options.hasContinue === false) this.stage = 'password'
          return Promise.resolve()
        },
      })
    }

    if (selector === 'input#continue') {
      if (this.options.hasContinue === false) {
        return Promise.reject(new Error('continue button not shown'))
      }
      return Promise.resolve({
        click: () => {
          this.navigate(
            'continue',
            'https://www.amazon.co.jp/ap/signin',
            'password'
          )
          return Promise.resolve()
        },
      })
    }

    if (selector === 'input#ap_password') {
      if (this.stage !== 'password') {
        return Promise.reject(new Error(`password requested at ${this.stage}`))
      }
      return Promise.resolve({
        click: () => Promise.resolve(),
        type: () => Promise.resolve(),
      })
    }

    if (selector === 'input#auth-mfa-otpcode') {
      return Promise.resolve({ type: () => Promise.resolve() })
    }

    if (selector === 'input#auth-signin-button') {
      return Promise.resolve({
        click: () => {
          this.navigate(
            'MFA submit',
            'https://read.amazon.co.jp/kindle-library',
            'library'
          )
          return Promise.resolve()
        },
      })
    }

    return Promise.reject(new Error(`unexpected selector: ${selector}`))
  }

  public click(selector: string): Promise<void> {
    if (selector !== 'input#signInSubmit') {
      return Promise.reject(new Error(`unexpected click: ${selector}`))
    }
    const requireMfa = this.options.requireMfa === true
    this.navigate(
      'password submit',
      requireMfa
        ? 'https://www.amazon.co.jp/ap/mfa'
        : 'https://read.amazon.co.jp/kindle-library',
      requireMfa ? 'mfa' : 'library'
    )
    return Promise.resolve()
  }

  public evaluate(): Promise<void> {
    return Promise.resolve()
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}

function createAmazon(
  page: FakeAmazonLoginPage,
  options: { otpSecret?: string } = {}
): Amazon {
  const browser = {
    newPage: () => Promise.resolve(page),
    cookies: () => Promise.resolve([]),
  } as unknown as Browser

  return new Amazon({
    browser,
    username: 'test@example.com',
    password: 'password',
    otpSecret: options.otpSecret,
    cookiePath: '/tmp/kindle-booklog-amazon-test-cookie.json',
    isIgnoreCookie: true,
  })
}

async function withoutLoginDelays(action: () => Promise<void>): Promise<void> {
  const originalSetTimeout = setTimeout
  globalThis.setTimeout = ((callback: () => void) => {
    queueMicrotask(callback)
    return 0 as unknown as NodeJS.Timeout
  }) as typeof setTimeout

  try {
    await action()
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
}

async function assertSynchronizedLogin(
  page: FakeAmazonLoginPage,
  amazon: Amazon,
  expectedNavigationCount: number
): Promise<void> {
  await withoutLoginDelays(() => amazon.login())
  assert.deepEqual(page.unsynchronizedActions, [])
  assert.equal(page.waitForNavigationOptions.length, expectedNavigationCount)
  assert.deepEqual(
    page.waitForNavigationOptions,
    Array.from({ length: expectedNavigationCount }, () => ({
      waitUntil: 'domcontentloaded',
    }))
  )
}

test('Amazon の全ログイン遷移で navigation 待機を先に登録する', async () => {
  const page = new FakeAmazonLoginPage()
  const amazon = createAmazon(page)

  await assertSynchronizedLogin(page, amazon, 3)
}).catch((error: unknown) => {
  throw error
})

test('Amazon の Continue がない場合もパスワード送信を同期する', async () => {
  const page = new FakeAmazonLoginPage({ hasContinue: false })
  const amazon = createAmazon(page)

  await assertSynchronizedLogin(page, amazon, 2)
}).catch((error: unknown) => {
  throw error
})

test('Amazon の MFA 送信まで全 navigation を同期する', async () => {
  const page = new FakeAmazonLoginPage({ requireMfa: true })
  const amazon = createAmazon(page, {
    otpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  })

  await assertSynchronizedLogin(page, amazon, 4)
}).catch((error: unknown) => {
  throw error
})
