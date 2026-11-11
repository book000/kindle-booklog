import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import puppeteer, { Browser, LaunchOptions } from 'puppeteer-core'
import Amazon from './amazon'
import Booklog, {
  BooklogBook,
  BooklogLoginRequiredError,
  readLoginState,
  writeLoginState,
} from './booklog'
import {
  Logger,
  Discord,
  DiscordOptions,
  SentryMeta,
} from '@book000/node-utils'
import { KindleBook } from './models/kindle-search-response'
import {
  captureChromiumLaunch,
  CHROMIUM_SINGLETON_LOCK_FILES,
  ChromiumLaunchAttemptReport,
  ChromiumLaunchCapture,
  ChromiumLaunchEnvironment,
  ChromiumLaunchError,
  ChromiumLaunchReportContext,
  collectChromiumLaunchEnvironment,
  FINAL_EXIT_WAIT_MS,
  readChromiumVersion,
  VERSION_TIMEOUT_MS,
} from './chromium-launch-diagnostics'
import {
  pruneDebugDirectory,
  saveChromiumLaunchLog,
  saveDebugInfo,
} from './debug-info'

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
          color: 0x00_ff_00,
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
          color: 0x00_ff_00,
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
        color: 0x00_ff_00,
        footer: {
          text: 'Powered by kindle-booklog',
        },
      },
    ],
  })
}

/**
 * Chromium 起動時の診断情報をログに出力する
 *
 * @param logger ロガー
 * @param environment collectChromiumLaunchEnvironment で収集した起動環境
 */
function logChromiumLaunchDiagnostics(
  logger: Logger,
  environment: ChromiumLaunchEnvironment
) {
  logger.info(
    `Chromium launch diagnostics: DISPLAY=${environment.display ?? '(not set)'}`
  )

  if (environment.x11Socket) {
    logger.info(
      `Chromium launch diagnostics: X11 socket (${environment.x11Socket.path}) ${
        environment.x11Socket.exists ? 'exists' : 'missing'
      }`
    )
  }

  for (const [lockFile, exists] of Object.entries(environment.singletonFiles)) {
    logger.info(
      `Chromium launch diagnostics: ${lockFile} ${exists ? 'exists' : 'missing'}`
    )
  }
}
/**
 * ブクログの手動ログインが必要な旨を、停止ごとに 1 回だけ Discord に通知する
 *
 * @param discord Discordクラスインスタンス
 * @param logger ロガー
 * @param error ログイン要求エラー
 */
async function notifyLoginRequiredOnce(
  discord: Discord,
  logger: Logger,
  error: BooklogLoginRequiredError
) {
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''
  logger.info(`Booklog login required (${error.message}${cause})`)
  const state = readLoginState()
  if (state?.notified) {
    return
  }
  await discord.sendMessage({
    embeds: [
      {
        title: 'ブクログの手動ログインが必要です',
        description: 'VNC で Chromium を開き、ブクログへログインしてください。',
        color: 0xff_00_00,
        footer: {
          text: 'Powered by kindle-booklog',
        },
      },
    ],
  })
  try {
    writeLoginState({
      lastAttempt: state?.lastAttempt ?? Date.now(),
      notified: true,
    })
  } catch (writeError) {
    logger.warn('Failed to persist notified state', writeError as Error)
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
 * 失敗した起動 1 回分の診断レポートを作り、stderr をログファイルに保存する
 *
 * 診断の失敗で起動の結果を変えないよう、例外は投げず、info ログに記録して undefined を返す
 *
 * @param logger ロガー
 * @param capture 起動の観測結果
 * @param step レポート確定前に採取するサンプル。final は子プロセスの終了を待ってから採取する
 * @param context レポートの内容
 * @returns 診断レポート。作成に失敗した場合は undefined
 */
async function recordFailedAttempt(
  logger: Logger,
  capture: ChromiumLaunchCapture,
  step: 'retry-start' | 'final',
  context: ChromiumLaunchReportContext
): Promise<ChromiumLaunchAttemptReport | undefined> {
  try {
    if (step === 'final') {
      await capture.waitForExit(FINAL_EXIT_WAIT_MS)
    }
    capture.sample(step)
    const report = capture.buildReport(context)
    saveChromiumLaunchLog(logger, report, capture.stderr().text)
    return report
  } catch (error) {
    logger.info('Failed to record Chromium launch diagnostics', {
      error: error instanceof Error ? error.stack : String(error),
    })
    return undefined
  }
}

/**
 * 診断ログを出力しつつ Chromium を起動する。起動に失敗した場合、ロックファイルを削除した上で 1 回だけリトライする
 *
 * 失敗した場合は、各試行の診断レポートを持つ ChromiumLaunchError を投げる。
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
  const executablePath = options.executablePath ?? ''
  const captureOptions = {
    executablePath,
    // puppeteer の既定の起動 timeout
    timeoutMs: options.timeout ?? 30_000,
  }
  const reportBase = {
    userDataDir,
    headless: options.headless ?? true,
    args: options.args ?? [],
  }

  logger.info('Launching Chromium (attempt 1/2)')
  const firstEnvironment = collectChromiumLaunchEnvironment(userDataDir)
  logChromiumLaunchDiagnostics(logger, firstEnvironment)

  const first = await captureChromiumLaunch(captureOptions, () =>
    puppeteer.launch(options)
  )
  if (first.ok) {
    return first.value
  }
  // リトライで回復することが多く、node-utils は warn 以上を GlitchTip に送るため info で記録する（最終失敗は error のまま）
  logger.info('Failed to launch Chromium (attempt 1/2), retrying', {
    error:
      first.error instanceof Error ? first.error.stack : String(first.error),
  })
  // ロック削除前の状態を記録してから自衛的なクリーンアップを行う
  logChromiumLaunchDiagnostics(
    logger,
    collectChromiumLaunchEnvironment(userDataDir)
  )
  removeChromiumSingletonLocks(userDataDir)
  // バージョン取得は待機時間(3 秒)の中に収め、リトライを遅らせない
  const [, chromiumVersion] = await Promise.all([
    delay(3000),
    readChromiumVersion(executablePath, VERSION_TIMEOUT_MS),
  ])
  const firstReport = await recordFailedAttempt(
    logger,
    first.capture,
    'retry-start',
    {
      ...reportBase,
      attempt: 1,
      environment: firstEnvironment,
      chromiumVersion,
      error: first.error,
    }
  )

  logger.info('Launching Chromium (attempt 2/2)')
  const secondEnvironment = collectChromiumLaunchEnvironment(userDataDir)
  logChromiumLaunchDiagnostics(logger, secondEnvironment)

  const second = await captureChromiumLaunch(captureOptions, () =>
    puppeteer.launch(options)
  )
  if (second.ok) {
    return second.value
  }
  // 最終失敗は呼び出し元が error 報告するため、ここでは info にして二重報告を避ける
  logger.info('Failed to launch Chromium (attempt 2/2)', {
    firstAttemptError:
      first.error instanceof Error ? first.error.stack : String(first.error),
    secondAttemptError:
      second.error instanceof Error ? second.error.stack : String(second.error),
  })
  logChromiumLaunchDiagnostics(
    logger,
    collectChromiumLaunchEnvironment(userDataDir)
  )
  const secondReport = await recordFailedAttempt(
    logger,
    second.capture,
    'final',
    {
      ...reportBase,
      attempt: 2,
      environment: secondEnvironment,
      chromiumVersion,
      error: second.error,
    }
  )
  // cause は Error のままにする（Sentry が原因を連鎖して記録する）
  throw new ChromiumLaunchError('Failed to launch Chromium after retry', {
    cause: second.error,
    attempts: [firstReport, secondReport].filter(
      (report) => report !== undefined
    ),
  })
}

/**
 * Chromium の最終起動失敗を GlitchTip へ報告する際の extra・tags を作る
 *
 * @param error 起動失敗のエラー
 * @returns ChromiumLaunchError の場合は診断レポートを持つ SentryMeta、それ以外は undefined
 */
function createLaunchFailureMeta(error: unknown): SentryMeta | undefined {
  if (!(error instanceof ChromiumLaunchError)) {
    return undefined
  }
  const lastAttempt = error.attempts.at(-1)
  return {
    extra: { chromiumLaunch: error.attempts },
    ...(lastAttempt && {
      tags: { 'chromium.failure_kind': lastAttempt.failureKind },
    }),
  }
}

/**
 * メイン処理
 */
async function main() {
  const logger = Logger.configure('main')
  pruneDebugDirectory(logger)

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
    // 起動・CDP 通信のタイムアウトを延長（既定は 30 秒 / 180 秒。config.puppeteer で上書き可能）
    timeout: 60_000,
    protocolTimeout: 300_000,
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
    logger.error(
      'Failed to launch Chromium',
      error as Error,
      createLaunchFailureMeta(error)
    )
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
            color: 0xff_00_00,
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
    if (err instanceof BooklogLoginRequiredError) {
      await notifyLoginRequiredOnce(discord, logger, err)
      return
    }
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
          color: 0xff_00_00,
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
