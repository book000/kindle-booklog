import { Browser, Page } from 'puppeteer-core'
import fs from 'fs'
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
type BookStatus = '読みたい' | 'いま読んでる' | '読み終わった' | '積読'
interface Book {
  serviceId: number
  itemId: string // ASINの場合あり
  isbn: string | null
  category: string | null
  rate: number | null
  status: BookStatus
  review: string | null
  tags: string[]
  memo: string | null
  createdAt: string
  readAt: string
  title: string
  author: string
  publisher: string
  publishedAt: string
  genre: string
  pageCount: number | null
}

export default class Booklog {
  private page?: Page
  // eslint-disable-next-line no-useless-constructor
  constructor(
    public options: BooklogOptions,
    public proxyOptions?: ProxyOptions,
  ) {}

  public async login(): Promise<void> {
    console.log('Booklog.login()')
    this.page = await this.options.browser.newPage()

    if (this.proxyOptions) {
      await authProxy(this.page, this.proxyOptions)
    }

    const cookiePath = this.options.cookiePath ?? 'cookie-booklog.json'
    if (!this.options.isIgnoreCookie && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'))
      for (const cookie of cookies) {
        await this.page.setCookie(cookie)
      }
    }
    await this.page?.goto('https://booklog.jp/login', {
      waitUntil: 'networkidle2',
    })

    if (
      !this.options.isIgnoreCookie &&
      this.page.url() !== 'https://booklog.jp/login'
    ) {
      // already login?
      return
    }

    await this.page
      ?.waitForSelector('input#account', {
        visible: true,
      })
      .then((element) => element?.type(this.options.username))

    await this.page
      ?.waitForSelector('input#password', {
        visible: true,
      })
      .then((element) => element?.type(this.options.password))

    fs.writeFileSync('/data/booklog-login.html', await this.page.content())

    // ログインボタンを押して画面が遷移するのを待つ
    await Promise.all([
      await this.page
        ?.waitForSelector('button[type="submit"]', {
          visible: true,
        })
        .then((element) => element?.click()),
      await this.page?.waitForNavigation({
        waitUntil: 'networkidle2',
      }),
    ])
    const cookies = await this.page.cookies()
    fs.writeFileSync(cookiePath, JSON.stringify(cookies))
  }

  public async getBookshelfBooks(): Promise<Book[]> {
    console.log('Booklog.getBookshelfBooks()')
    if (!this.page) {
      throw new Error('not login')
    }
    await this.page.goto('https://booklog.jp/export', {
      waitUntil: 'networkidle2',
    })
    await this.page.waitForSelector('a#execExport', {
      visible: true,
    })

    const url = await this.page.$eval('a#execExport', (elem) =>
      elem.getAttribute('href'),
    )
    if (!url) {
      throw new Error('export url not found')
    }
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    })
    const data = decode(Buffer.from(response.data), 'windows-31j')
    const csv = parse(data)
    return csv.map((row: string[]) => {
      const book: Book = {
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
    if (!this.page) {
      throw new Error('not login')
    }
    await this.page.goto(`https://booklog.jp/edit/1/${itemId}`, {
      waitUntil: 'networkidle2',
    })
    await this.page
      ?.waitForSelector('button#item-add-button', {
        visible: true,
        timeout: 3000,
      })
      .then((element) => element?.click())
      .catch(() => null)
    await this.page.waitForNavigation()
  }

  public async destroy(): Promise<void> {
    console.log('Booklog.destroy()')
    if (this.page && !this.page.isClosed()) {
      await this.page.close()
      this.page = undefined
    }
  }
}
