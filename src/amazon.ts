import fs from 'node:fs'
import { authenticator } from 'otplib'
import { Browser, Page } from 'puppeteer-core'
import { authProxy, ProxyOptions } from './proxy-auth'
import {
  KindleBook,
  KindleSearchResponse,
} from './models/kindle-search-response'
import tar from 'tar-stream'
import { KindleRenderMetadata } from './models/kindle-render-metadata'

interface AmazonOptions {
  browser: Browser
  username: string
  password: string
  otpSecret?: string
  cookiePath?: string
  isIgnoreCookie?: boolean
}

export default class Amazon {
  private page?: Page
  private proxyOptions?: ProxyOptions

  constructor(
    public options: AmazonOptions,
    proxyOptions?: ProxyOptions
  ) {
    this.options.isIgnoreCookie = this.options.isIgnoreCookie ?? false
    this.proxyOptions = proxyOptions
  }

  public async login(): Promise<void> {
    console.log('Amazon.login()')
    this.page = await this.options.browser.newPage()

    if (this.proxyOptions) {
      await authProxy(this.page, this.proxyOptions)
    }

    const cookiePath = this.options.cookiePath ?? 'cookie-amazon.json'
    if (!this.options.isIgnoreCookie && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
      for (const cookie of cookies) {
        await this.page.setCookie(cookie)
      }
    }
    await this.page
      .goto('https://read.amazon.co.jp/kindle-library?sortType=recency', {
        waitUntil: 'networkidle2',
      })
      .catch(async () => {
        await this.page?.screenshot({
          path: '/data/amazon-login0.png',
          fullPage: true,
        })
      })

    if (
      !this.options.isIgnoreCookie &&
      this.page.url().startsWith('https://read.amazon.co.jp/kindle-library')
    ) {
      // already login?
      return
    } else {
      // need login
      await this.page
        .waitForSelector('button#top-sign-in-btn', {
          visible: true,
        })
        .then(async (element) => {
          await element?.click()
        })
    }

    await this.page
      .waitForSelector('input#ap_email', {
        visible: true,
      })
      .then(async (element) => {
        await element?.click({ clickCount: 3 })
        await element?.type(this.options.username)
      })
    await this.page
      .waitForSelector('input#ap_password', {
        visible: true,
      })
      .then(async (element) => {
        await element?.click({ clickCount: 3 })
        await element?.type(this.options.password)
      })
    await this.page.evaluate(() => {
      const rememberMe = document.querySelector<HTMLInputElement>(
        'input[name="rememberMe"]'
      )
      if (rememberMe) {
        rememberMe.checked = true
      }
    })
    await this.page.click('input#signInSubmit')
    await new Promise((resolve) => setTimeout(resolve, 3000))

    if (
      this.options.otpSecret &&
      this.page.url().startsWith('https://www.amazon.co.jp/ap/mfa')
    ) {
      const otpCode = authenticator.generate(
        this.options.otpSecret.replaceAll(' ', '')
      )
      await this.page
        .waitForSelector('input#auth-mfa-otpcode', {
          visible: true,
        })
        .then((element) => element?.type(otpCode))
      await this.page.evaluate(() => {
        const rememberMe = document.querySelector<HTMLInputElement>(
          'input#auth-mfa-remember-device'
        )
        if (rememberMe) {
          rememberMe.checked = true
        }
      })

      await Promise.all([
        this.page
          .waitForSelector('input#auth-signin-button', {
            visible: true,
          })
          .then((element) => element?.click()),
        this.page.waitForNavigation(),
      ])
    }

    const cookies = await this.page.cookies()
    fs.writeFileSync(cookiePath, JSON.stringify(cookies))
  }

  public async getBooks(nextPagenationToken = '0'): Promise<KindleBook[]> {
    console.log(`Amazon.getBooks(nextPagenationToken=${nextPagenationToken})`)
    if (!this.page) {
      throw new Error('not login')
    }

    const url = `https://read.amazon.co.jp/kindle-library/search?query=&libraryType=BOOKS&paginationToken=${nextPagenationToken}&sortType=recency&querySize=50`
    await this.page.goto(url, {
      waitUntil: 'networkidle2',
    })
    const json = await this.page.$eval('pre', (element) => element.textContent)
    if (!json) {
      throw new Error('json is empty')
    }
    const data: KindleSearchResponse = JSON.parse(json)

    if (data.paginationToken) {
      const nextBooks = await this.getBooks(data.paginationToken)
      return [...data.itemsList, ...nextBooks]
    }

    return data.itemsList
  }

  public async getBookPercentageRead(book: KindleBook): Promise<number> {
    console.log('Amazon.getBookPercentageRead()')
    if (!this.page) {
      throw new Error('not login')
    }

    const url = book.webReaderUrl
    const promise = this.page.waitForResponse((response) => {
      return response
        .url()
        .startsWith('https://read.amazon.co.jp/renderer/render')
    })
    await this.page.goto(url, {
      waitUntil: 'networkidle2',
    })
    const renderResponse = await promise

    const renderUrl = renderResponse.url()
    const renderUrlObject = new URL(renderUrl)
    const startingPosition = Number(
      renderUrlObject.searchParams.get('startingPosition')
    )
    if (Number.isNaN(startingPosition)) {
      throw new TypeError('startingPosition is NaN')
    }

    const tarball = await renderResponse.buffer()
    const metadata: KindleRenderMetadata = await new Promise(
      (resolve, reject) => {
        const extract = tar.extract()
        extract.on('entry', (header, stream, next) => {
          if (header.name === 'metadata.json') {
            let data = ''
            stream.on('data', (chunk: { toString: () => string }) => {
              data += chunk.toString()
            })
            stream.on('end', () => {
              resolve(JSON.parse(data))
            })
          } else {
            stream.resume()
          }
          stream.on('end', () => {
            next()
          })
          stream.resume()
        })
        extract.on('finish', () => {
          reject(new Error('data.json not found'))
        })
        extract.end(tarball)
      }
    )

    // ((firstPositionId ?? 0) + startingPosition) / lastPositionId で割合が出せる。ただし、Number(roughDecimal.toFixed(3)) * 100 した方がいいらしい
    // ref: https://github.com/Xetera/kindle-api/blob/dc34acf607783aa3a64a9c52ff72bfdbaefcd12b/src/book.ts#L94C28-L94C66
    const percentageRead =
      Number(
        (
          ((metadata.firstPositionId ?? 0) + startingPosition) /
          metadata.lastPositionId
        ).toFixed(3)
      ) * 100

    return percentageRead
  }

  public async destroy(): Promise<void> {
    console.log('Amazon.destroy()')
    if (this.page && !this.page.isClosed()) {
      await this.page.close()
      this.page = undefined
    }
  }
}
