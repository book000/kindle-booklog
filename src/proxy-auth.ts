import { Page } from 'puppeteer-core'

export interface ProxyOptions {
  server: string
  username?: string
  password?: string
}

export async function authProxy(page: Page, config: ProxyOptions) {
  if (config && config.username && config.password) {
    console.log('Login proxy')
    await page.authenticate({
      username: config.username,
      password: config.password,
    })
    console.log('Login proxy... done')
  }
}
