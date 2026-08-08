import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'puppeteer-core'
import BooklogUpdateBook from './booklog-update-book'

class FakePage {
  public waitForNavigationOptions: { waitUntil?: string }[] = []
  public closed = false

  public url(): string {
    return 'https://booklog.jp/edit/1/TEST'
  }

  public waitForSelector(): Promise<{ click: () => Promise<void> }> {
    return Promise.resolve({ click: () => Promise.resolve() })
  }

  public waitForNavigation(options: { waitUntil?: string }): Promise<void> {
    this.waitForNavigationOptions.push(options)
    return Promise.resolve()
  }

  public close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

test('Booklog の保存後遷移は DOMContentLoaded を待つ', async () => {
  const page = new FakePage()
  const updater = new BooklogUpdateBook(page as unknown as Page, 'TEST', {})

  await updater.update()

  assert.deepEqual(page.waitForNavigationOptions, [
    { waitUntil: 'domcontentloaded' },
  ])
  assert.equal(page.closed, true)
}).catch((error: unknown) => {
  throw error
})
