import fs from 'fs'
import { authenticator } from 'otplib'
import { scrollPageToBottom } from 'puppeteer-autoscroll-down'
import puppeteer, { Page } from 'puppeteer-core'

interface AmazonOptions {
  browser: puppeteer.Browser
  username: string
  password: string
  otpSecret?: string
  cookiePath?: string
  isIgnoreCookie?: boolean
}

export default class Amazon {
  private page?: Page
  constructor(public options: AmazonOptions) {
    this.options.isIgnoreCookie = this.options.isIgnoreCookie ?? false
  }

  public async login(): Promise<void> {
    console.log('Amazon.login()')
    this.page = await this.options.browser.newPage()
    const cookiePath = this.options.cookiePath ?? 'cookie-amazon.json'
    if (!this.options.isIgnoreCookie && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'))
      for (const cookie of cookies) {
        await this.page?.setCookie(cookie)
      }
    }
    await this.page
      ?.goto('https://read.amazon.co.jp/kindle-library?sortType=recency', {
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
      !this.page?.url().startsWith('https://www.amazon.co.jp/ap/signin')
    ) {
      // already login?
      return
    }

    await this.page
      ?.waitForSelector('input#ap_email', {
        visible: true,
      })
      .then(async (element) => {
        await element?.click({ clickCount: 3 })
        await element?.type(this.options.username)
      })
    await this.page
      ?.waitForSelector('input#ap_password', {
        visible: true,
      })
      .then(async (element) => {
        await element?.click({ clickCount: 3 })
        await element?.type(this.options.password)
      })
    await this.page.evaluate(() => {
      const rememberMe = document.querySelector(
        'input[name="rememberMe"]'
      ) as HTMLInputElement
      if (rememberMe) {
        rememberMe.checked = true
      }
    })
    await Promise.all([await this.page?.click('input#signInSubmit')])
    await this.page.waitForTimeout(3000)

    if (
      this.options.otpSecret &&
      this.page.url().startsWith('https://www.amazon.co.jp/ap/mfa')
    ) {
      const otpCode = authenticator.generate(
        this.options.otpSecret.replace(/ /g, '')
      )
      await this.page
        ?.waitForSelector('input#auth-mfa-otpcode', {
          visible: true,
        })
        .then((element) => element?.type(otpCode))
      await this.page.evaluate(() => {
        const rememberMe = document.querySelector(
          'input#auth-mfa-remember-device'
        ) as HTMLInputElement
        if (rememberMe) {
          rememberMe.checked = true
        }
      })

      await Promise.all([
        await this.page
          ?.waitForSelector('input#auth-signin-button', {
            visible: true,
          })
          .then((element) => element?.click()),
        await this.page?.waitForNavigation(),
      ])
    }

    const cookies = await this.page?.cookies()
    fs.writeFileSync(cookiePath, JSON.stringify(cookies))
  }

  public async getBooks(): Promise<string[]> {
    console.log('Amazon.getBooks()')
    if (!this.page) {
      throw new Error('not login')
    }
    await this.page
      ?.goto('https://read.amazon.co.jp/kindle-library?sortType=recency', {
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
      ?.evaluate(() => {
        const books = document.querySelectorAll(
          'ul#cover > li > div[data-asin]'
        )
        return Array.from(books)
          .map((elem) => elem.getAttribute('data-asin') || '')
          .filter((elem) => elem)
      })
      .catch(() => [])
    return books ?? []
  }

  public async destroy(): Promise<void> {
    console.log('Amazon.destroy()')
    if (this.page && !this.page.isClosed()) {
      await this.page.close()
      this.page = undefined
    }
  }
}
