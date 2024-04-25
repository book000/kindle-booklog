import { Browser } from 'puppeteer-core'
import fs from 'node:fs'
import axios from 'axios'
import { parse } from 'csv-parse/sync'
import { decode } from 'iconv-lite'
import { authProxy, ProxyOptions } from './proxy-auth'

interface BooklogOptions {
  browser: Browser
  username: string
  password: string
  cookiePath?: string
  isIgnoreCookie?: boolean
}

// サービスID, アイテムID, 13桁ISBN, カテゴリ, 評価, 読書状況, レビュー, タグ, 読書メモ(非公開), 登録日時, 読了日, タイトル, 作者名, 出版社名, 発行年, ジャンル, ページ数
type BookStatus = '読みたい' | 'いま読んでる' | '読み終わった' | '積読' | '' // 未設定は空文字列
interface BooklogBook {
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
  /** レビュー */
  review: string | null
  /** タグ */
  tags: string[]
  /** 読書メモ(非公開) */
  memo: string | null
  /** 登録日時 */
  createdAt: string
  /** 読了日 */
  readAt: string
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

export default class Booklog {
  constructor(
    public options: BooklogOptions,
    public proxyOptions?: ProxyOptions
  ) {}

  public async login(): Promise<void> {
    console.log('Booklog.login()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    const cookiePath = this.options.cookiePath ?? 'cookie-booklog.json'
    if (!this.options.isIgnoreCookie && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
      for (const cookie of cookies) {
        await page.setCookie(cookie)
      }
    }
    await page.goto('https://booklog.jp/login', {
      waitUntil: 'networkidle2',
    })

    if (
      !this.options.isIgnoreCookie &&
      page.url() !== 'https://booklog.jp/login'
    ) {
      // already login?
      return
    }

    await page
      .waitForSelector('input#account', {
        visible: true,
      })
      .then((element) => element?.type(this.options.username))

    await page
      .waitForSelector('input#password', {
        visible: true,
      })
      .then((element) => element?.type(this.options.password))

    fs.writeFileSync('/data/booklog-login.html', await page.content())

    // ログインボタンを押して画面が遷移するのを待つ
    await Promise.all([
      page
        .waitForSelector('button[type="submit"]', {
          visible: true,
        })
        .then((element) => element?.click()),
      page.waitForNavigation({
        waitUntil: 'networkidle2',
      }),
    ])
    const cookies = await page.cookies()
    fs.writeFileSync(cookiePath, JSON.stringify(cookies))

    await page.close()
  }

  public async getBookshelfBooks(): Promise<BooklogBook[]> {
    console.log('Booklog.getBookshelfBooks()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await page.goto('https://booklog.jp/export', {
      waitUntil: 'networkidle2',
    })
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
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    })
    const data = decode(Buffer.from(response.data), 'windows-31j')
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

  public async addBookshelfBook(itemId: string): Promise<void> {
    console.log('Booklog.addBookshelfBook()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await page.goto(`https://booklog.jp/edit/1/${itemId}`, {
      waitUntil: 'networkidle2',
    })
    await Promise.all([
      page
        .waitForSelector('button#item-add-button', {
          visible: true,
          timeout: 3000,
        })
        .then((element) => element?.click())
        .catch(() => null),
      page.waitForNavigation(),
    ])
    await page.close()
  }

  public async updateBookshelfBook(
    itemId: string,
    status: BookStatus
  ): Promise<void> {
    console.log('Booklog.updateBookshelfBook()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    await page.goto(`https://booklog.jp/edit/1/${itemId}`, {
      waitUntil: 'networkidle2',
    })
    // td#status p.edit-status > label
    await page.waitForSelector('td#status p.edit-status', {
      visible: true,
    })

    const statusValue = this.getStatusValue(status)
    const statusId = `status${statusValue}_1_${itemId}`
    console.log(statusId)

    // 読書状況を変更する
    await page
      .waitForSelector(`td#status p.edit-status > label[for="${statusId}"]`, {
        visible: true,
      })
      .then((element) => element?.scrollIntoView())
    await page
      .waitForSelector(`td#status p.edit-status > label[for="${statusId}"]`, {
        visible: true,
      })
      .then((element) => element?.click())

    // 保存ボタンを押して画面が遷移するのを待つ
    await Promise.all([
      page
        .waitForSelector('div#edit_panels p.buttons button[type="submit"]', {
          visible: true,
        })
        .then((element) => element?.click()),
      page.waitForNavigation({
        waitUntil: 'networkidle2',
      }),
    ])
    await page.close()
  }

  private getStatusValue(status: BookStatus): number {
    return status === ''
      ? 0
      : status === '読みたい'
        ? 1
        : status === 'いま読んでる'
          ? 2
          : status === '読み終わった'
            ? 3
            : 4
  }
}
