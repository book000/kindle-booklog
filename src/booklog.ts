import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Browser, CookieData, Page } from 'puppeteer-core'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import { authProxy, ProxyOptions } from './proxy-auth'
import BooklogBookUpdater from './booklog-update-book'
import { restoreCookies } from './cookie-utils'

const BOOKLOG_LOGIN_URL = 'https://booklog.jp/login'
const BOOKLOG_EXPORT_URL = 'https://booklog.jp/export'
const DEFAULT_MANUAL_LOGIN_TIMEOUT_MS = 300_000
const BOOKLOG_RETRY_MAX_ATTEMPTS = 3
const BOOKLOG_RETRY_DELAY_MS = 500
/** 手動ログイン待ちに失敗した後、再び待機を開始するまでの間隔 */
const MANUAL_LOGIN_BACKOFF_MS = 60 * 60 * 1000
/** セッション Cookie を永続化する際の有効期間 */
const SESSION_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * ブクログの認証が必要（手動ログイン待ち）であることを示すエラー
 */
export class BooklogLoginRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BooklogLoginRequiredError'
  }
}

/** 手動ログイン待ちの状態 */
export interface BooklogLoginState {
  /** 最後に手動ログイン待ちに失敗した時刻（ミリ秒） */
  lastAttempt: number
  /** Discord へ通知済みか */
  notified: boolean
}

/**
 * 手動ログイン状態ファイルのパスを取得する
 *
 * @returns 状態ファイルのパス
 */
function getLoginStatePath(): string {
  return process.env.BOOKLOG_LOGIN_STATE ?? 'data/booklog-login-pending.json'
}

/**
 * ブクログの Cookie ファイルのパスを取得する
 *
 * @returns Cookie ファイルのパス
 */
function getCookiePath(): string {
  return process.env.COOKIE_BOOKLOG ?? 'data/cookie-booklog.json'
}

/**
 * 手動ログイン状態を読み込む
 *
 * @returns 状態。ファイルが無い・不正な場合は null
 */
export function readLoginState(): BooklogLoginState | null {
  try {
    const state = JSON.parse(
      fs.readFileSync(getLoginStatePath(), 'utf8')
    ) as Partial<BooklogLoginState> | null
    return typeof state?.lastAttempt === 'number'
      ? { lastAttempt: state.lastAttempt, notified: state.notified === true }
      : null
  } catch {
    return null
  }
}

/**
 * 手動ログイン状態を書き込む
 *
 * @param state 保存する状態
 */
export function writeLoginState(state: BooklogLoginState): void {
  const statePath = getLoginStatePath()
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state))
}

/**
 * 手動ログイン状態を削除する
 */
function clearLoginState(): void {
  fs.rmSync(getLoginStatePath(), { force: true })
}

/**
 * 認証が必要になった時刻を記録する（通知済みフラグは維持する）
 */
function markLoginRequired(): void {
  writeLoginState({
    lastAttempt: Date.now(),
    notified: readLoginState()?.notified ?? false,
  })
}

interface BooklogOptions {
  browser: Browser
}

// サービスID, アイテムID, 13桁ISBN, カテゴリ, 評価, 読書状況, レビュー, タグ, 読書メモ(非公開), 登録日時, 読了日, タイトル, 作者名, 出版社名, 発行年, ジャンル, ページ数
export type BookStatus =
  '読みたい' | 'いま読んでる' | '読み終わった' | '積読' | '' // 未設定は空文字列
export interface BooklogBook {
  /** サービスID */
  serviceId: number
  /** アイテムID（ASINの場合あり） */
  itemId: string
  /** 13桁ISBN */
  isbn: string | null
  /** カテゴリ */
  category: string | null
  /** 評価 */
  rate: number | null
  /** 読書状況 (空白は未設定) */
  status: BookStatus
  /** レビュー (感想) */
  review: string | null
  /** タグ */
  tags: string[]
  /** 読書メモ(非公開) */
  memo: string | null
  /** 登録日時 */
  createdAt: string
  /** 読了日 (yyyy-MM-dd形式) */
  readAt: string | null
  /** タイトル */
  title: string
  /** 作者名 */
  author: string
  /** 出版社名 */
  publisher: string
  /** 発行年 */
  publishedAt: string
  /** ジャンル */
  genre: string
  /** ページ数 */
  pageCount: number | null
}

export type BooklogBookOptions = Partial<
  Omit<
    BooklogBook,
    | 'serviceId'
    | 'itemId'
    | 'isbn'
    | 'title'
    | 'author'
    | 'publisher'
    | 'publishedAt'
    | 'genre'
    | 'pageCount'
  > & {
    /** 非公開で登録するか */
    isPrivate: boolean
    /** レビューをネタバレとするか */
    isReviewSpoiler: boolean
  }
>

export default class Booklog {
  constructor(
    public options: BooklogOptions,
    public proxyOptions?: ProxyOptions
  ) {}

  /**
   * 一時的に失敗しうる処理を再試行する。
   *
   * @param operation 再試行対象の処理
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= BOOKLOG_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        return await operation()
      } catch (error) {
        if (attempt === BOOKLOG_RETRY_MAX_ATTEMPTS) {
          throw error
        }
        await delay(BOOKLOG_RETRY_DELAY_MS * attempt)
      }
    }
    // ループは必ず return か throw で終了するため到達しない
    throw new Error('unreachable')
  }

  /**
   * Booklog のページへ遷移する。外部リソースの通信完了は待たず、
   * 一時的な遷移失敗は再試行する。
   *
   * @param page ページ
   * @param url 遷移先URL
   */
  private async navigate(page: Page, url: string): Promise<void> {
    await this.withRetry(() =>
      page.goto(url, {
        waitUntil: 'domcontentloaded',
      })
    )
  }

  /**
   * Booklogにログインする
   */
  public async login(): Promise<void> {
    console.log('Booklog.login()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await this.navigate(page, BOOKLOG_EXPORT_URL)
    let isLoginPage = page.url().startsWith(BOOKLOG_LOGIN_URL)
    if (isLoginPage && (await this.restoreSavedCookies())) {
      // プロファイルのセッションが切れていた場合のみ、保存済み Cookie で復元を試みる
      await this.navigate(page, BOOKLOG_EXPORT_URL)
      isLoginPage = page.url().startsWith(BOOKLOG_LOGIN_URL)
    }
    if (!isLoginPage) {
      await this.onLoggedIn()
      await page.close()
      return
    }

    // 直近に待機に失敗している間は、待たずに即座に失敗させる
    const state = readLoginState()
    if (state && Date.now() - state.lastAttempt < MANUAL_LOGIN_BACKOFF_MS) {
      await page.close()
      throw new BooklogLoginRequiredError('Booklog manual login required')
    }

    const configuredTimeout = Number.parseInt(
      process.env.BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS ?? '',
      10
    )
    const manualLoginTimeoutMs = Number.isFinite(configuredTimeout)
      ? configuredTimeout
      : DEFAULT_MANUAL_LOGIN_TIMEOUT_MS

    console.log('Booklog manual login required. Complete login via VNC.')
    const manualLoginDeadline = Date.now() + manualLoginTimeoutMs
    while (page.url().startsWith(BOOKLOG_LOGIN_URL)) {
      const remainingMs = manualLoginDeadline - Date.now()
      if (remainingMs <= 0) {
        markLoginRequired()
        throw new BooklogLoginRequiredError('Booklog manual login required')
      }
      await delay(Math.min(1000, remainingMs))
    }

    await this.navigate(page, BOOKLOG_EXPORT_URL)
    if (page.url().startsWith(BOOKLOG_LOGIN_URL)) {
      markLoginRequired()
      throw new BooklogLoginRequiredError('Booklog manual login required')
    }

    await this.onLoggedIn()
    await page.close()
  }

  /**
   * ログイン成功時の後処理（手動ログイン状態の削除と Cookie の保存）
   */
  private async onLoggedIn(): Promise<void> {
    clearLoginState()
    try {
      // Chromium 再起動でセッション Cookie が失われるため、有効期限を付けて保存する
      const now = Date.now()
      const allCookies = await this.options.browser.cookies()
      const cookies = allCookies
        .filter((cookie) => cookie.domain.endsWith('booklog.jp'))
        .map((cookie) =>
          cookie.session || cookie.expires <= 0
            ? {
                ...cookie,
                session: false,
                expires: (now + SESSION_COOKIE_TTL_MS) / 1000,
              }
            : cookie
        )
      const cookiePath = getCookiePath()
      fs.mkdirSync(path.dirname(cookiePath), { recursive: true })
      fs.writeFileSync(cookiePath, JSON.stringify(cookies), { mode: 0o600 })
    } catch (error) {
      console.warn('Failed to save Booklog cookies:', error)
    }
  }

  /**
   * 保存済みの Cookie（期限切れを除く）をブラウザに復元する
   *
   * @returns 復元を試みた場合は true
   */
  private async restoreSavedCookies(): Promise<boolean> {
    const cookiePath = getCookiePath()
    if (!fs.existsSync(cookiePath)) {
      return false
    }
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
      if (!Array.isArray(saved)) {
        return false
      }
      // 期限切れ Cookie の復元はプロファイル側の Cookie を削除し得るため除外する
      const now = Date.now() / 1000
      const valid = saved.filter(
        (cookie: Partial<CookieData>) =>
          typeof cookie.expires !== 'number' ||
          cookie.expires <= 0 ||
          cookie.expires > now
      )
      await restoreCookies(this.options.browser, valid)
      return valid.length > 0
    } catch (error) {
      console.warn('Failed to restore Booklog cookies:', error)
      return false
    }
  }

  /**
   * 登録されている本の一覧を取得する
   *
   * @returns 登録されている本の一覧
   */
  public async getBookshelfBooks(): Promise<BooklogBook[]> {
    console.log('Booklog.getBookshelfBooks()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await this.navigate(page, BOOKLOG_EXPORT_URL)
    if (page.url().startsWith(BOOKLOG_LOGIN_URL)) {
      markLoginRequired()
      throw new BooklogLoginRequiredError('Booklog authentication required')
    }
    try {
      await page.waitForSelector('a#execExport', {
        visible: true,
        timeout: 15_000,
      })
    } catch (error) {
      // エクスポートボタンが無い場合は認証切れとみなし、同じバックオフ経路に乗せる
      markLoginRequired()
      throw new BooklogLoginRequiredError('Booklog authentication required', {
        cause: error,
      })
    }

    const url = await page.$eval('a#execExport', (element) =>
      element.getAttribute('href')
    )
    if (!url) {
      throw new Error('export url not found')
    }
    await page.close()
    const response = await this.withRetry(() => fetch(url))
    if (!response.ok) {
      throw new Error(
        `Failed to fetch bookshelf export: ${response.status} ${response.statusText}`
      )
    }
    const data = iconv.decode(
      Buffer.from(await response.arrayBuffer()),
      'windows-31j'
    )
    const csv: string[][] = parse(data)
    return csv.map((row: string[]) => {
      const book: BooklogBook = {
        serviceId: Number(row[0]),
        itemId: row[1],
        isbn: row[2],
        category: row[3],
        rate: row[4] ? Number(row[4]) : null,
        status: row[5] as BookStatus,
        review: row[6],
        tags: row[7] ? row[7].split(' ') : [],
        memo: row[8],
        createdAt: row[9],
        readAt: row[10],
        title: row[11],
        author: row[12],
        publisher: row[13],
        publishedAt: row[14],
        genre: row[15],
        pageCount: row[16] ? Number(row[16]) : null,
      }
      return book
    })
  }

  /**
   * 本を登録する
   *
   * @param itemId アイテムID
   */
  public async addBookshelfBook(itemId: string): Promise<void> {
    console.log('Booklog.addBookshelfBook()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await this.navigate(page, `https://booklog.jp/edit/1/${itemId}`)
    await Promise.all([
      page
        .waitForSelector('button#item-add-button', {
          visible: true,
          timeout: 3000,
        })
        .then((element) => element?.click())
        .catch(() => null),
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
      }),
    ])

    await page.close()
  }

  /**
   * 本の情報を更新する
   *
   * @param itemId アイテムID
   * @param options 更新する情報
   */
  public async updateBookshelfBook(
    itemId: string,
    options: BooklogBookOptions
  ): Promise<void> {
    console.log('Booklog.updateBookshelfBook()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await this.navigate(page, `https://booklog.jp/edit/1/${itemId}`)

    const bookUpdater = new BooklogBookUpdater(page, itemId, options)
    await bookUpdater.update()
  }
}
