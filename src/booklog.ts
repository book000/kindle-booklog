import { setTimeout as delay } from 'node:timers/promises'
import { Browser, Page } from 'puppeteer-core'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import { authProxy, ProxyOptions } from './proxy-auth'
import BooklogBookUpdater from './booklog-update-book'

const BOOKLOG_LOGIN_URL = 'https://booklog.jp/login'
const BOOKLOG_EXPORT_URL = 'https://booklog.jp/export'
const DEFAULT_MANUAL_LOGIN_TIMEOUT_MS = 300_000
const BOOKLOG_NAVIGATION_MAX_ATTEMPTS = 3
const BOOKLOG_NAVIGATION_RETRY_DELAY_MS = 500

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
   * Booklog のページへ遷移する。外部リソースの通信完了は待たず、
   * 一時的な遷移失敗は再試行する。
   *
   * @param page ページ
   * @param url 遷移先URL
   */
  private async navigate(page: Page, url: string): Promise<void> {
    for (
      let attempt = 1;
      attempt <= BOOKLOG_NAVIGATION_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
        })
        return
      } catch (error) {
        if (attempt === BOOKLOG_NAVIGATION_MAX_ATTEMPTS) {
          throw error
        }
        await delay(BOOKLOG_NAVIGATION_RETRY_DELAY_MS * attempt)
      }
    }
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
    if (!page.url().startsWith(BOOKLOG_LOGIN_URL)) {
      await page.close()
      return
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
        throw new Error('Booklog manual login required')
      }
      await delay(Math.min(1000, remainingMs))
    }

    await this.navigate(page, BOOKLOG_EXPORT_URL)
    if (page.url().startsWith(BOOKLOG_LOGIN_URL)) {
      throw new Error('Booklog manual login required')
    }

    await page.close()
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
      throw new Error('Booklog authentication required')
    }
    await page.waitForSelector('a#execExport', {
      visible: true,
    })

    const url = await page.$eval('a#execExport', (element) =>
      element.getAttribute('href')
    )
    if (!url) {
      throw new Error('export url not found')
    }
    await page.close()
    const response = await fetch(url)
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
