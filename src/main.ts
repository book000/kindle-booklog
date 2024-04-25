import fs from 'node:fs'
import puppeteer, {
  BrowserConnectOptions,
  BrowserLaunchArgumentOptions,
  LaunchOptions,
  Product,
} from 'puppeteer-core'
import Amazon from './amazon'
import Booklog from './booklog'
import { Logger, Discord, DiscordOptions } from '@book000/node-utils'

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
  discord: DiscordOptions
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  puppeteer?: Record<string, unknown>
}

async function main() {
  const logger = Logger.configure('main')

  const configPath = process.env.CONFIG_PATH ?? 'data/config.json'
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  // puppeteerの設定
  const puppeteerOptions: LaunchOptions &
    BrowserLaunchArgumentOptions &
    BrowserConnectOptions & {
      product?: Product
      extraPrefsFirefox?: Record<string, unknown>
    } = {
    // DISPLAYがないときはheadlessモードにする
    headless: !process.env.DISPLAY,
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser',
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

  // discordの設定
  const discord = new Discord(config.discord)

  const browser = await puppeteer.launch(puppeteerOptions)

  try {
    const amazon = new Amazon(
      {
        browser,
        username: config.amazon.username,
        password: config.amazon.password,
        otpSecret: config.amazon.otpSecret,
        cookiePath: process.env.COOKIE_AMAZON ?? 'data/cookie-amazon.json',
      },
      config.proxy
    )
    await amazon.login()
    const kindleBooks = await amazon.getBooks()

    const booklog = new Booklog(
      {
        browser,
        username: config.booklog.username,
        password: config.booklog.password,
        cookiePath: process.env.COOKIE_BOOKLOG ?? 'data/cookie-booklog.json',
      },
      config.proxy
    )
    await booklog.login()
    const booklogBooks = await booklog.getBookshelfBooks()

    const newBooks = kindleBooks.filter(
      (kindleBook) =>
        !booklogBooks.some(
          (book) => book.itemId.toUpperCase() === kindleBook.asin.toUpperCase()
        )
    )

    // 新しく追加された本を登録
    for (const book of newBooks) {
      logger.info(
        `Add new book: ${book.title} - ${book.authors.join(', ')} (${book.asin})`
      )
      await booklog.addBookshelfBook(book.asin)
      await discord.sendMessage({
        embeds: [
          {
            title: '新しい本を登録しました',
            description:
              book.title + ' ' + book.authors.join(', ').replaceAll(':', ', '),
            url: `https://www.amazon.co.jp/dp/${book.asin}`,
            color: 0x00_ff_00, // green
            footer: {
              text: 'Powered by kindle-booklog',
            },
          },
        ],
      })
    }

    // Kindleにあって、かつBooklogでステータスが未設定の本
    const statusUnsetBooks = booklogBooks.filter(
      (book) =>
        book.status === '' &&
        kindleBooks.some(
          (kindleBook) =>
            kindleBook.asin.toUpperCase() === book.itemId.toUpperCase()
        )
    )
    for (const book of statusUnsetBooks) {
      logger.info(`Checking status of book: ${book.title} (${book.itemId})`)
      const kindleBook = kindleBooks.find(
        (kindleBook) =>
          kindleBook.asin.toUpperCase() === book.itemId.toUpperCase()
      )
      if (!kindleBook) {
        continue
      }
      if (!kindleBook.mangaOrComicAsin) {
        logger.info('This book is not unsupported kindle for web')
        continue
      }
      const percentageRead = await amazon.getBookPercentageRead(kindleBook)
      logger.info(`Percentage read: ${percentageRead}`)

      // 完全に読んでも100%にならないことがあるので、99%以上で読み終わったとする
      if (percentageRead < 99) {
        continue
      }
      logger.info(`Set status to read: ${book.title} (${book.itemId})`)
      await booklog.updateBookshelfBook(book.itemId, '読み終わった')
      await discord.sendMessage({
        embeds: [
          {
            title: '本を読み終わりました',
            description: book.title,
            url: `https://www.amazon.co.jp/dp/${book.itemId}`,
            color: 0x00_ff_00, // green
            footer: {
              text: 'Powered by kindle-booklog',
            },
          },
        ],
      })
    }

    await amazon.destroy()
    await booklog.destroy()
  } catch (error) {
    logger.error('Error occurred', error as Error)
    const debugDirectory = process.env.DEBUG_DIRECTORY ?? 'debug'
    const pages = await browser.pages()
    if (!fs.existsSync(debugDirectory)) {
      fs.mkdirSync(debugDirectory)
    }

    let index = 0
    for (const page of pages) {
      await page.screenshot({
        path: `${debugDirectory}/error-${new Date()
          .toISOString()
          .replaceAll(':', '-')}-${index}.png`,
        fullPage: true,
      })
      fs.writeFileSync(
        `${debugDirectory}/error-${new Date()
          .toISOString()
          .replaceAll(':', '-')}-${index}.html`,
        await page.content()
      )
      index++
    }

    await discord.sendMessage({
      embeds: [
        {
          title: 'エラーが発生しました',
          description:
            error instanceof Error
              ? error.message + '\n\n' + (error.stack ?? '')
              : String(error),
          color: 0xff_00_00, // red
          footer: {
            text: 'Powered by kindle-booklog',
          },
        },
      ],
    })
  } finally {
    await browser.close()
  }
}

;(async () => {
  await main().catch((error: unknown) => {
    console.error(error)
  })
})()
