import fs from 'node:fs'
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib'
import { Browser } from 'puppeteer-core'
import type {
  Page,
  ElementHandle,
  WaitForSelectorOptions,
} from 'puppeteer-core'
import { authProxy, ProxyOptions } from './proxy-auth'
import {
  KindleBook,
  KindleSearchResponse,
} from './models/kindle-search-response'
import tar from 'tar-stream'
import { KindleRenderMetadata } from './models/kindle-render-metadata'

// Amazon ログインフローで待機・操作するセレクタ。ログ文言とコードの対応を明確にするため集約する
const LOGIN_SELECTORS = {
  topSignInButton: 'button#top-sign-in-btn',
  authPortalCenterSection: 'div#authportal-center-section',
  emailInput: 'input#ap_email',
  continueButton: 'input#continue',
  passwordInput: 'input#ap_password',
  signInSubmit: 'input#signInSubmit',
  mfaOtpCode: 'input#auth-mfa-otpcode',
  mfaSignInButton: 'input#auth-signin-button',
} as const

interface AmazonOptions {
  browser: Browser
  username: string
  password: string
  otpSecret?: string
  cookiePath?: string
  isIgnoreCookie?: boolean
}

export default class Amazon {
  private proxyOptions?: ProxyOptions

  constructor(
    public options: AmazonOptions,
    proxyOptions?: ProxyOptions
  ) {
    this.options.isIgnoreCookie ??= false
    this.proxyOptions = proxyOptions
  }

  /**
   * 診断情報付きで waitForSelector を実行する。
   *
   * タイムアウトなどで失敗した場合、どのログインステップで・どの URL で・
   * どのページタイトルで失敗したかを error ログに出力し、同じ情報を含めて
   * エラーメッセージを補強した上で再スローする。これにより main.ts の
   * catch による Discord 通知でも失敗ステップを判別できる。
   *
   * @param page 対象の Page
   * @param selector 待機するセレクタ
   * @param stepName ログインフロー上のステップ名（人間可読）
   * @param options waitForSelector のオプション
   * @returns 見つかった ElementHandle（見つからない場合は null）
   */
  private async waitForSelectorWithDiagnostics(
    page: Page,
    selector: string,
    stepName: string,
    options?: WaitForSelectorOptions
  ): Promise<ElementHandle | null> {
    try {
      return await page.waitForSelector(selector, options)
    } catch (error) {
      const currentUrl = page.url()
      // 認証フロー URL のクエリ文字列に個人情報が乗る可能性に備え、origin + pathname のみを記録する
      const sanitizedUrl = (() => {
        try {
          const url = new URL(currentUrl)
          return url.origin + url.pathname
        } catch {
          return '(invalid url)'
        }
      })()
      const title = await page.title().catch(() => '(unavailable)')
      // セレクタ文字列はログに含めない。CodeQL がセレクタ定数名（passwordInput 等）
      // を機密ソースと誤検知するのを避けつつ、stepName で失敗箇所は特定できる
      const detail = `Amazon login step "${stepName}" failed: target element not found. url=${sanitizedUrl}, title=${title}`
      console.error(detail)
      if (error instanceof Error) {
        error.message = `${detail} (original: ${error.message})`
      }
      throw error
    }
  }

  public async login(): Promise<void> {
    console.log('Amazon.login()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    const cookiePath = this.options.cookiePath ?? 'cookie-amazon.json'
    if (!this.options.isIgnoreCookie && fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
      for (const cookie of cookies) {
        await this.options.browser.setCookie(cookie)
      }
    }
    await page
      .goto(
        'https://read.amazon.co.jp/kindle-library?sortType=acquisition_asc',
        {
          waitUntil: 'networkidle2',
        }
      )
      .catch(async () => {
        await page.screenshot({
          path: '/data/amazon-login0.png',
          fullPage: true,
        })
      })

    if (
      !this.options.isIgnoreCookie &&
      page.url().startsWith('https://read.amazon.co.jp/kindle-library')
    ) {
      // already login?
      return
    }
    // need login
    await this.waitForSelectorWithDiagnostics(
      page,
      LOGIN_SELECTORS.topSignInButton,
      'wait top sign-in button',
      { visible: true }
    ).then(async (element) => {
      await element?.click()
    })

    console.log("Waiting for 'div#authportal-center-section'")
    await this.waitForSelectorWithDiagnostics(
      page,
      LOGIN_SELECTORS.authPortalCenterSection,
      'wait auth portal (email page)',
      { visible: true }
    ).then(async () => {
      console.log(
        "Found 'div#authportal-center-section'. Setting margin-top to 100px"
      )
      await page.evaluate((selector) => {
        const centerSection = document.querySelector<HTMLDivElement>(selector)
        if (centerSection) {
          centerSection.style.marginTop = '100px'
        }
      }, LOGIN_SELECTORS.authPortalCenterSection)
    })

    console.log("Waiting for 'input#ap_email'")
    await this.waitForSelectorWithDiagnostics(
      page,
      LOGIN_SELECTORS.emailInput,
      'wait email input',
      { visible: true }
    ).then(async (element) => {
      console.log(
        "Found 'input#ap_email'. Clicking 3 times and typing username"
      )
      await element?.click({ count: 3 })
      await element?.type(this.options.username)
    })

    await new Promise((resolve) => setTimeout(resolve, 3000))

    console.log("Waiting for 'input#continue'")
    await page
      .waitForSelector(LOGIN_SELECTORS.continueButton, {
        visible: true,
        timeout: 3000,
      })
      .then(async (element) => {
        console.log("Found 'input#continue'. Clicking")
        await element?.click()
      })
      .catch(() => null)

    console.log("Waiting for 'div#authportal-center-section'")
    await this.waitForSelectorWithDiagnostics(
      page,
      LOGIN_SELECTORS.authPortalCenterSection,
      'wait auth portal (password page)',
      { visible: true }
    ).then(async () => {
      console.log(
        "Found 'div#authportal-center-section'. Setting margin-top to 100px"
      )
      await page.evaluate((selector) => {
        const centerSection = document.querySelector<HTMLDivElement>(selector)
        if (centerSection) {
          centerSection.style.marginTop = '100px'
        }
      }, LOGIN_SELECTORS.authPortalCenterSection)
    })

    await new Promise((resolve) => setTimeout(resolve, 3000))

    console.log("Waiting for 'input#ap_password'")
    await this.waitForSelectorWithDiagnostics(
      page,
      LOGIN_SELECTORS.passwordInput,
      'wait password input',
      { visible: true }
    ).then(async (element) => {
      console.log(
        "Found 'input#ap_password'. Clicking 3 times and typing password"
      )

      await element?.click({ count: 3 })
      await element?.type(this.options.password)
    })

    await new Promise((resolve) => setTimeout(resolve, 3000))

    console.log("Waiting for 'input#signInSubmit'")
    await page.evaluate(() => {
      const rememberMe = document.querySelector<HTMLInputElement>(
        'input[name="rememberMe"]'
      )
      if (rememberMe) {
        rememberMe.checked = true
      }
    })
    await page.click(LOGIN_SELECTORS.signInSubmit)
    await new Promise((resolve) => setTimeout(resolve, 3000))

    if (
      this.options.otpSecret &&
      page.url().startsWith('https://www.amazon.co.jp/ap/mfa')
    ) {
      // otplib v13 では TOTP の生成に crypto / base32 プラグインの明示指定が必須
      const totp = new TOTP({
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      })
      const otpCode = await totp.generate({
        secret: this.options.otpSecret.replaceAll(' ', ''),
      })
      await this.waitForSelectorWithDiagnostics(
        page,
        LOGIN_SELECTORS.mfaOtpCode,
        'wait MFA OTP input',
        { visible: true }
      ).then((element) => element?.type(otpCode))
      await page.evaluate(() => {
        const rememberMe = document.querySelector<HTMLInputElement>(
          'input#auth-mfa-remember-device'
        )
        if (rememberMe) {
          rememberMe.checked = true
        }
      })

      await Promise.all([
        this.waitForSelectorWithDiagnostics(
          page,
          LOGIN_SELECTORS.mfaSignInButton,
          'wait MFA sign-in button',
          { visible: true }
        ).then((element) => element?.click()),
        page.waitForNavigation(),
      ])
    }

    const cookies = await this.options.browser.cookies()
    fs.writeFileSync(cookiePath, JSON.stringify(cookies))

    await page.close()
  }

  public async getBooks(nextPagenationToken = '0'): Promise<KindleBook[]> {
    console.log(`Amazon.getBooks(nextPagenationToken=${nextPagenationToken})`)
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    const url = `https://read.amazon.co.jp/kindle-library/search?query=&libraryType=BOOKS&paginationToken=${nextPagenationToken}&sortType=acquisition_asc&querySize=50`
    await page.goto(url, {
      waitUntil: 'networkidle2',
    })
    const json = await page.$eval('pre', (element) => element.textContent)
    if (!json) {
      throw new Error('json is empty')
    }
    await page.close()
    const data: KindleSearchResponse = JSON.parse(json)

    if (data.paginationToken) {
      const nextBooks = await this.getBooks(data.paginationToken)
      return [...data.itemsList, ...nextBooks]
    }

    return data.itemsList
  }

  public async getBookPercentageRead(book: KindleBook): Promise<number> {
    console.log('Amazon.getBookPercentageRead()')
    const page = await this.options.browser.newPage()
    if (this.proxyOptions) {
      await authProxy(page, this.proxyOptions)
    }

    const url = book.webReaderUrl
    const promise = page.waitForResponse((response) => {
      return response
        .url()
        .startsWith('https://read.amazon.co.jp/renderer/render')
    })
    await page.goto(url, {
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

    await page.close()

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
}
