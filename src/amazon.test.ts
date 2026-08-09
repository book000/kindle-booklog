import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Browser } from 'puppeteer-core'
import Amazon from './amazon'

class FakeAmazonLoginPage {
  public waitForNavigationOptions: { waitUntil?: string }[] = []
  private navigationWaitRegistered = false
  private currentUrl = 'about:blank'

  public goto(): Promise<void> {
    this.currentUrl = 'https://read.amazon.co.jp/landing'
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
    this.navigationWaitRegistered = true
    return Promise.resolve()
  }

  public waitForSelector(
    selector: string
  ): Promise<{ click?: () => Promise<void> }> {
    if (selector === 'button#top-sign-in-btn') {
      return Promise.resolve({
        click: () => {
          this.currentUrl = 'https://www.amazon.co.jp/ap/signin'
          return Promise.resolve()
        },
      })
    }

    if (selector === 'div#authportal-center-section') {
      if (!this.navigationWaitRegistered) {
        return Promise.reject(
          new Error('Amazon sign-in navigation was not awaited')
        )
      }
      return Promise.resolve({})
    }

    if (selector === 'input#ap_email') {
      return Promise.reject(new Error('reached Amazon email input'))
    }

    return Promise.reject(new Error(`unexpected selector: ${selector}`))
  }

  public evaluate(): Promise<void> {
    return Promise.resolve()
  }
}
function createAmazon(page: FakeAmazonLoginPage): Amazon {
  const browser = {
    newPage: () => Promise.resolve(page),
  } as unknown as Browser

  return new Amazon({
    browser,
    username: 'test@example.com',
    password: 'password',
    isIgnoreCookie: true,
  })
}

test('Amazon のサインイン遷移完了後に認証フォームを待つ', async () => {
  const page = new FakeAmazonLoginPage()
  const amazon = createAmazon(page)

  await assert.rejects(amazon.login(), /reached Amazon email input/)

  assert.deepEqual(page.waitForNavigationOptions, [
    { waitUntil: 'domcontentloaded' },
  ])
}).catch((error: unknown) => {
  throw error
})
