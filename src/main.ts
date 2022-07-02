import fs from 'fs'
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
  puppeteer: { [key: string]: unknown }
}

;(async () => {
  const configPath = process.env.CONFIG_PATH ?? 'config.json'
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  const puppeteerOptions: LaunchOptions &
    BrowserLaunchArgumentOptions &
    BrowserConnectOptions & {
      product?: Product
      extraPrefsFirefox?: Record<string, unknown>
    } = {
    headless: true,
    slowMo: 100,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...config.puppeteer,
  }

  const browser = await puppeteer.launch(puppeteerOptions)

  const amazon = new Amazon({
    browser,
    username: config.amazon.username,
    password: config.amazon.password,
    otpSecret: config.amazon.otpSecret,
    cookiePath: process.env.COOKIE_AMAZON,
  })
  await amazon.login()
  const kindleBooks = await amazon.getBooks()
  amazon.destroy()

  const booklog = new Booklog({
    browser,
    username: config.booklog.username,
    password: config.booklog.password,
    cookiePath: process.env.COOKIE_BOOKLOG,
  })
  await booklog.login()
  const booklogBooks = await booklog.getBookshelfBooks()

  const newBooks = []

  for (const kindleBook of kindleBooks) {
    const booklogBook = booklogBooks.find(
      (book) => book.itemId.toUpperCase() === kindleBook.toUpperCase()
    )
    if (!booklogBook) {
      newBooks.push(kindleBook)
    }
  }

  // 一度登録した本は除外する
  const addedPath = process.env.ADDED_FILE ?? 'added.json'
  const addedBooks = fs.existsSync(addedPath)
    ? JSON.parse(fs.readFileSync(addedPath, 'utf8'))
    : []

  for (const book of newBooks) {
    if (addedBooks.includes(book)) {
      continue
    }
    console.log('add book: ' + book)
    await booklog.addBookshelfBook(book)
    addedBooks.push(book)
  }
  fs.writeFileSync(addedPath, JSON.stringify(addedBooks))
  booklog.destroy()

  await browser.close()
})()
