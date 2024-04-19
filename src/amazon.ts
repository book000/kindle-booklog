import fs from 'node:fs'
import { authenticator } from 'otplib'
import { scrollPageToBottom } from 'puppeteer-autoscroll-down'
import { Browser, Page } from 'puppeteer-core'
import { authProxy, ProxyOptions } from './proxy-auth'

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
    proxyOptions?: ProxyOptions,
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
        'input[name="rememberMe"]',
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
        this.options.otpSecret.replaceAll(' ', ''),
      )
      await this.page
        .waitForSelector('input#auth-mfa-otpcode', {
          visible: true,
        })
        .then((element) => element?.type(otpCode))
      await this.page.evaluate(() => {
        const rememberMe = document.querySelector<HTMLInputElement>(
          'input#auth-mfa-remember-device',
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

  public async getBooks(): Promise<string[]> {
    console.log('Amazon.getBooks()')
    if (!this.page) {
      throw new Error('not login')
    }
    await this.page
      .goto('https://read.amazon.co.jp/kindle-library?sortType=recency', {
        waitUntil: 'networkidle2',
      })
      .catch(async () => {
        await this.page?.screenshot({
          path: '/data/amazon-getbook-1.png',
          fullPage: true,
        })
      })
    await scrollPageToBottom(this.page, {
      size: 400,
      delay: 250,
      stepsLimit: 50,
    })

    const books = await this.page
      .$$eval('ul#cover > li > div[data-asin]', (elements) => {
        return elements.map((element) => element.dataset.asin ?? '')
      })
      .catch(() => [])

    return books
  }

  public async destroy(): Promise<void> {
    console.log('Amazon.destroy()')
    if (this.page && !this.page.isClosed()) {
      await this.page.close()
      this.page = undefined
    }
  }
}
