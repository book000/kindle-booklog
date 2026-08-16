import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import puppeteer, { Browser, LaunchOptions } from 'puppeteer-core'
import Amazon from './amazon'
import Booklog, { BooklogBook } from './booklog'
import { Logger, Discord, DiscordOptions } from '@book000/node-utils'
import { KindleBook } from './models/kindle-search-response'

interface Config {
  amazon: {
    username: string
    password: string
    otpSecret?: string
  }
  discord: DiscordOptions
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  puppeteer?: Record<string, unknown>
}

/**
 * Kindle本をもとに新しく追加された本をブクログに登録
 *
 * @param booklog Booklogクラスインスタンス
 * @param discord Discordクラスインスタンス
 * @param kindleBooks Kindleの本リスト
 * @param booklogBooks Booklog本棚の本リスト
 */
async function addNewBooks(
  booklog: Booklog,
  discord: Discord,
  kindleBooks: KindleBook[],
  booklogBooks: BooklogBook[]
) {
  const logger = Logger.configure('addNewBooks')
  logger.info('Start adding new books')

  const newBooks = kindleBooks.filter((kindleBook) =>
    booklogBooks.every(
      (book) => book.itemId.toUpperCase() !== kindleBook.asin.toUpperCase()
    )
  )

  for (const book of newBooks) {
    logger.info(
      `Add new book: ${book.title} - ${book.authors.join(', ')} (${book.asin})`
    )
    await booklog.addBookshelfBook(book.asin)

    const originType = book.originType.toLowerCase()
    const resourceType = book.resourceType.toLowerCase()
    await booklog.updateBookshelfBook(book.asin, {
      tags: [originType, resourceType],
    })
    await discord.sendMessage({
      embeds: [
        {
          title: '新しい本を登録しました',
          color: 0x00_ff_00, // green
          fields: [
            {
              name: 'Title',
              value: book.title,
            },
            {
              name: 'Authors',
              value: book.authors.join(', ').replaceAll(':', ', '),
            },
            {
              name: 'Amazon URL',
              value: `https://www.amazon.co.jp/dp/${book.asin}`,
            },
            {
              name: 'Booklog URL',
              value: `https://booklog.jp/item/1/${book.asin}`,
            },
            {
              name: 'Resource Type',
              value: book.resourceType,
            },
            {
              name: 'Origin Type',
              value: book.originType,
            },
          ],
          footer: {
            text: 'Powered by kindle-booklog',
          },
        },
      ],
    })
  }
}

/**
 * Kindle本をもとにブクログのステータスが未設定の本を更新
 *
 * @param amazon Amazonクラスインスタンス
 * @param booklog Booklogクラスインスタンス
 * @param discord Discordクラスインスタンス
 * @param kindleBooks Kindleの本リスト
 * @param booklogBooks Booklog本棚の本リスト
 */
async function updateUnsetStatusBooks(
  amazon: Amazon,
  booklog: Booklog,
  discord: Discord,
  kindleBooks: KindleBook[],
  booklogBooks: BooklogBook[]
) {
  const logger = Logger.configure('updateUnsetStatusBooks')
  logger.info('Start updating unset status books')

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
    const percentageRead = await amazon
      .getBookPercentageRead(kindleBook)
      .catch(() => null)
    logger.info(`Percentage read: ${percentageRead}`)
    if (percentageRead === null) {
      continue
    }
    // 完全に読んでも100%にならないことがあるので、99%以上で読み終わったとする
    if (percentageRead < 99) {
      continue
    }

    logger.info(`Set status to read: ${book.title} (${book.itemId})`)
    await booklog.updateBookshelfBook(book.itemId, {
      status: '読み終わった',
    })
    await discord.sendMessage({
      embeds: [
        {
          title: '本を読み終わりました',
          fields: [
            {
              name: 'Title',
              value: book.title,
            },
            {
              name: 'Authors',
              value: book.author,
            },
            {
              name: 'Amazon URL',
              value: `https://www.amazon.co.jp/dp/${book.itemId}`,
            },
            {
              name: 'Booklog URL',
              value: `https://booklog.jp/item/1/${book.itemId}`,
            },
          ],
          color: 0x00_ff_00, // green
          footer: {
            text: 'Powered by kindle-booklog',
          },
        },
      ],
    })
  }
}

/**
 * Kindle本をもとにブクログの情報をすべて更新
 */
async function updateAllBooks(
  amazon: Amazon,
  booklog: Booklog,
  discord: Discord,
  kindleBooks: KindleBook[],
  booklogBooks: BooklogBook[]
) {
  const logger = Logger.configure('updateAllBooks')
  logger.info('Start updating all books')

  for (const book of booklogBooks) {
    logger.info(`Checking detail of book: ${book.title} (${book.itemId})`)
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
    const percentageRead = await amazon
      .getBookPercentageRead(kindleBook)
      .catch(() => null)
    logger.info(`Percentage read: ${percentageRead}`)
    if (percentageRead === null) {
      continue
    }

    const originType = kindleBook.originType.toLowerCase()
    const resourceType = kindleBook.resourceType.toLowerCase()

    // 完全に読んでも100%にならないことがあるので、99%以上で読み終わったとする
    if (percentageRead < 99) {
      // 読み終わっていない場合、タグだけ更新
      await booklog.updateBookshelfBook(book.itemId, {
        tags: [originType, resourceType],
      })
      continue
    }

    logger.info(`Set status to read: ${book.title} (${book.itemId})`)
    await booklog.updateBookshelfBook(book.itemId, {
      status: '読み終わった',
      tags: [originType, resourceType],
    })
  }

  await discord.sendMessage({
    embeds: [
      {
        title: '全ての本情報を更新しました',
        color: 0x00_ff_00, // green
        footer: {
          text: 'Powered by kindle-booklog',
        },
      },
    ],
  })
}

const CHROMIUM_SINGLETON_LOCK_FILES = [
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
]

/**
 * Chromium 起動失敗時の診断情報をログに出力する
 *
 * @param logger ロガー
 * @param userDataDir Chromium の userDataDir パス
 */
function logChromiumLaunchDiagnostics(logger: Logger, userDataDir: string) {
  const display = process.env.DISPLAY
  logger.warn(`Chromium launch diagnostics: DISPLAY=${display ?? '(not set)'}`)

  if (display) {
    // entrypoint.sh と同じ規則で X11 ソケットパスを組み立てる(":99" -> "X99")
    const displayNumber = display.replace(/^:/, '').split('.', 1)[0]
    const socketPath = `/tmp/.X11-unix/X${displayNumber}`
    logger.warn(
      `Chromium launch diagnostics: X11 socket (${socketPath}) ${
        fs.existsSync(socketPath) ? 'exists' : 'missing'
      }`
    )
  }

  for (const lockFile of CHROMIUM_SINGLETON_LOCK_FILES) {
    const lockPath = `${userDataDir}/${lockFile}`
    logger.warn(
      `Chromium launch diagnostics: ${lockFile} ${
        fs.existsSync(lockPath) ? 'exists' : 'missing'
      }`
    )
  }
}

/**
 * リトライ前に stale なロックが残ったままにならないよう、Singleton* を削除する
 *
 * @param userDataDir Chromium の userDataDir パス
 */
function removeChromiumSingletonLocks(userDataDir: string) {
  for (const lockFile of CHROMIUM_SINGLETON_LOCK_FILES) {
    const lockPath = `${userDataDir}/${lockFile}`
    if (fs.existsSync(lockPath)) {
      fs.rmSync(lockPath, { force: true })
    }
  }
}

/**
 * 診断ログを出力しつつ Chromium を起動する。起動に失敗した場合、ロックファイルを削除した上で 1 回だけリトライする
 *
 * @param options puppeteer の起動オプション
 * @param logger ロガー
 * @returns 起動した Browser インスタンス
 */
async function launchBrowserWithDiagnostics(
  options: LaunchOptions,
  logger: Logger
): Promise<Browser> {
  const userDataDir = options.userDataDir ?? ''
  let firstAttemptError: unknown

  logger.info('Launching Chromium (attempt 1/2)')
  logChromiumLaunchDiagnostics(logger, userDataDir)

  try {
    return await puppeteer.launch(options)
  } catch (error) {
    firstAttemptError = error
    logger.error('Failed to launch Chromium (attempt 1/2)', error as Error)
    // ロック削除前の状態を記録してから自衛的なクリーンアップを行う
    logChromiumLaunchDiagnostics(logger, userDataDir)
    removeChromiumSingletonLocks(userDataDir)
    await delay(3000)
  }

  logger.info('Launching Chromium (attempt 2/2)')
  logChromiumLaunchDiagnostics(logger, userDataDir)

  try {
    return await puppeteer.launch(options)
  } catch (error) {
    logger.error('Failed to launch Chromium (attempt 2/2)', error as Error)
    logChromiumLaunchDiagnostics(logger, userDataDir)
    throw new Error('Failed to launch Chromium after retry', {
      cause: { firstAttemptError, secondAttemptError: error },
    })
  }
}

/**
 * メイン処理
 */
const DIAGNOSTICS_TIMEOUT_MS = 5000

/**
 * Promise に短いタイムアウトを設定する
 *
 * @param promise 対象の Promise
 * @param label タイムアウト時のエラーメッセージに含めるラベル
 * @returns 元の Promise の結果
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${DIAGNOSTICS_TIMEOUT_MS}ms`))
    }, DIAGNOSTICS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * エラー発生時の診断情報（スクリーンショット・HTML）を各 page ごとに保存する
 *
 * screenshot/content の取得失敗を page・処理ごとに隔離し、一次例外を上書きしない。
 * 診断処理自体の失敗は secondary な warn ログとしてのみ記録する。
 *
 * @param browser Puppeteer ブラウザインスタンス
 * @param logger ロガー
 */
async function saveDebugInfo(browser: Browser, logger: Logger) {
  const debugDirectory = process.env.DEBUG_DIRECTORY ?? 'debug'
  try {
    if (!fs.existsSync(debugDirectory)) {
      fs.mkdirSync(debugDirectory)
    }

    const pages = await browser.pages()
    for (const [index, page] of pages.entries()) {
      const timestamp = new Date().toISOString().replaceAll(':', '-')

      try {
        await withTimeout(
          page.screenshot({
            path: `${debugDirectory}/error-${timestamp}-${index}.png`,
            fullPage: true,
          }),
          `page[${index}] screenshot`
        )
      } catch (error) {
        logger.warn(
          `Failed to save debug screenshot for page[${index}]`,
          error as Error
        )
      }

      try {
        const content = await withTimeout(
          page.content(),
          `page[${index}] content`
        )
        fs.writeFileSync(
          `${debugDirectory}/error-${timestamp}-${index}.html`,
          content
        )
      } catch (error) {
        logger.warn(
          `Failed to save debug HTML for page[${index}]`,
          error as Error
        )
      }
    }
  } catch (error) {
    logger.warn('Failed to save debug info', error as Error)
  }
}

async function main() {
  const logger = Logger.configure('main')

  const configPath = process.env.CONFIG_PATH ?? 'data/config.json'
  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  const width = process.env.WINDOW_WIDTH
    ? Number.parseInt(process.env.WINDOW_WIDTH)
    : 600
  const height = process.env.WINDOW_HEIGHT
    ? Number.parseInt(process.env.WINDOW_HEIGHT)
    : 1000

  const userDataDir = process.env.BROWSER_USER_DATA_DIR ?? 'data/userdata'

  // puppeteerの設定
  const puppeteerOptions: LaunchOptions = {
    // DISPLAYがないときはheadlessモードにする
    headless: !process.env.DISPLAY,
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser',
    userDataDir,
    // 起動失敗時の診断のため、Chromium 自身の stdout/stderr をそのまま出力する
    dumpio: true,
    defaultViewport: {
      width,
      height,
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      `--window-size=${width},${height}`,
    ],
    ...config.puppeteer,
  }

  if (config.proxy?.server) {
    puppeteerOptions.args?.push('--proxy-server=' + config.proxy.server)
  }

  // discordの設定
  const discord = new Discord(config.discord)

  let browser: Awaited<ReturnType<typeof launchBrowserWithDiagnostics>>
  try {
    browser = await launchBrowserWithDiagnostics(puppeteerOptions, logger)
  } catch (error) {
    logger.error('Failed to launch Chromium', error as Error)
    // Discord API の embed description は 4096 文字までのため切り詰める
    const description = (
      error instanceof Error
        ? error.message + '\n\n' + (error.stack ?? '')
        : String(error)
    ).slice(0, 4096)
    try {
      await discord.sendMessage({
        embeds: [
          {
            title: 'Chromiumの起動に失敗しました',
            description,
            color: 0xff_00_00, // red
            footer: {
              text: 'Powered by kindle-booklog',
            },
          },
        ],
      })
    } catch (notifyError) {
      logger.error('Failed to send Discord notification', notifyError as Error)
    }
    return
  }

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

    const booklog = new Booklog({ browser }, config.proxy)
    await booklog.login()
    const booklogBooks = await booklog.getBookshelfBooks()

    // 新しく追加された本を登録
    await addNewBooks(booklog, discord, kindleBooks, booklogBooks)

    // Kindleにあって、かつBooklogでステータスが未設定の本を更新
    await updateUnsetStatusBooks(
      amazon,
      booklog,
      discord,
      kindleBooks,
      booklogBooks
    )

    if (process.env.UPDATE_ALL_BOOKS === 'true') {
      // 全ての本情報を更新
      await updateAllBooks(amazon, booklog, discord, kindleBooks, booklogBooks)
    }
  } catch (err) {
    logger.error('Error occurred', err as Error)
    await saveDebugInfo(browser, logger)

    await discord.sendMessage({
      embeds: [
        {
          title: 'エラーが発生しました',
          description:
            err instanceof Error
              ? err.message + '\n\n' + (err.stack ?? '')
              : String(err),
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
  await main().catch((err: unknown) => {
    const logger = Logger.configure('main')
    logger.error('Unhandled error', err as Error)
  })
})()
