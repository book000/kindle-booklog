import axios from 'axios'
import fs from 'node:fs'
import puppeteer, {
  BrowserConnectOptions,
  BrowserLaunchArgumentOptions,
  LaunchOptions,
  Product,
} from 'puppeteer-core'
import Amazon from './amazon'
import Booklog from './booklog'

interface Config {
  amazon: {
    username: string
    password: string
    otpSecret?: string
  }
  booklog: {
    username: string
    password: string
  }
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  puppeteer: Record<string, unknown>
}

async function main() {
  const configPath = process.env.CONFIG_PATH ?? 'config.json'
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const puppeteerOptions: LaunchOptions &
    BrowserLaunchArgumentOptions &
    BrowserConnectOptions & {
      product?: Product
      extraPrefsFirefox?: Record<string, unknown>
    } = {
    // DISPLAYがないときはheadlessモードにする
    headless: !process.env.DISPLAY,
    slowMo: 100,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
    ...config.puppeteer,
  }

  if (config.proxy?.server) {
    puppeteerOptions.args?.push('--proxy-server=' + config.proxy.server)
  }

  const browser = await puppeteer.launch(puppeteerOptions)

  try {
    const amazon = new Amazon(
      {
        browser,
        username: config.amazon.username,
        password: config.amazon.password,
        otpSecret: config.amazon.otpSecret,
        cookiePath: process.env.COOKIE_AMAZON,
      },
      config.proxy,
    )
    await amazon.login()
    const kindleBooks = await amazon.getBooks()
    await amazon.destroy()

    const booklog = new Booklog(
      {
        browser,
        username: config.booklog.username,
        password: config.booklog.password,
        cookiePath: process.env.COOKIE_BOOKLOG,
      },
      config.proxy,
    )
    await booklog.login()
    const booklogBooks = await booklog.getBookshelfBooks()

    const newBooks = []

    for (const kindleBook of kindleBooks) {
      const booklogBook = booklogBooks.find(
        (book) => book.itemId.toUpperCase() === kindleBook.toUpperCase(),
      )
      if (!booklogBook) {
        newBooks.push(kindleBook)
      }
    }

    // 一度登録した本は除外する
    const addedPath = process.env.ADDED_FILE ?? 'added.json'
    const addedBooks: string[] = fs.existsSync(addedPath)
      ? JSON.parse(fs.readFileSync(addedPath, 'utf8'))
      : []

    for (const book of newBooks) {
      if (addedBooks.includes(book)) {
        continue
      }
      console.log('add book: ' + book)
      await booklog.addBookshelfBook(book)
      await axios
        .post('http://discord-deliver', {
          content: `kindle-booklog: Read https://www.amazon.co.jp/dp/${book}/`,
        })
        .catch(() => null)
      addedBooks.push(book)
    }
    fs.writeFileSync(addedPath, JSON.stringify(addedBooks))
    await booklog.destroy()
  } catch {
    const pages = await browser.pages()
    if (!fs.existsSync('debug')) {
      fs.mkdirSync('debug')
    }

    let index = 0
    for (const page of pages) {
      await page.screenshot({
        path: `debug/error-${new Date()
          .toISOString()
          .replaceAll(':', '-')}-${index}.png`,
        fullPage: true,
      })
      fs.writeFileSync(
        `debug/error-${new Date()
          .toISOString()
          .replaceAll(':', '-')}-${index}.html`,
        await page.content(),
      )
      index++
    }
  } finally {
    await browser.close()
  }
}

;(async () => {
  await main().catch(async (error: unknown) => {
    console.log(error)
    await axios
      .post('http://discord-deliver', {
        embed: {
          title: `Error`,
          description: (error as Error).message,
          color: 0xff_00_00,
        },
      })
      .catch(() => null)
  })
})()
