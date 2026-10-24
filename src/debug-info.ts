import fs from 'node:fs'
import path from 'node:path'
import type { Browser } from 'puppeteer-core'
import type { Logger } from '@book000/node-utils'

const DIAGNOSTICS_TIMEOUT_MS = 5000

/** saveDebugInfo が出力するファイル名のパターン（pruneDebugDirectory の削除対象） */
const DEBUG_FILE_PATTERN = /^error-.*\.(png|html)$/

/** デバッグ情報の保持期間（ミリ秒） */
const DEBUG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * デバッグ情報の保存先ディレクトリを取得する
 *
 * @returns 保存先ディレクトリのパス
 */
function getDebugDirectory(): string {
  return process.env.DEBUG_DIRECTORY ?? 'debug'
}

/**
 * Promise に短いタイムアウトを設定する
 *
 * @param promise 対象の Promise
 * @param label タイムアウト時のエラーメッセージに含めるラベル
 * @returns 元の Promise の結果
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${DIAGNOSTICS_TIMEOUT_MS}ms`))
    }, DIAGNOSTICS_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * デバッグディレクトリ内の保持期間を過ぎた古いファイルを削除する
 *
 * saveDebugInfo が出力したファイル（error-*.png / error-*.html）のみ対象とする
 *
 * ファイル単位で失敗を隔離し、失敗は debug ログのみ記録する。
 *
 * @param logger ロガー
 * @param now 現在時刻（ミリ秒）
 */
export function pruneDebugDirectory(logger: Logger, now = Date.now()) {
  const debugDirectory = getDebugDirectory()
  let names: string[]
  try {
    names = fs.readdirSync(debugDirectory)
  } catch (error) {
    // ディレクトリが無い場合は何もしない
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.debug(`Failed to read debug directory: ${String(error)}`)
    }
    return
  }
  for (const name of names) {
    if (!DEBUG_FILE_PATTERN.test(name)) continue
    const filePath = path.join(debugDirectory, name)
    try {
      const stat = fs.statSync(filePath)
      if (stat.isFile() && now - stat.mtimeMs > DEBUG_RETENTION_MS) {
        fs.unlinkSync(filePath)
      }
    } catch (error) {
      logger.debug(
        `Failed to prune debug file ${name}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

/**
 * エラー発生時の診断情報（スクリーンショット・HTML）を各 page ごとに保存する
 *
 * 閉じた page と about:blank は対象外。screenshot/content の取得失敗は
 * page・処理ごとに隔離し、一次例外を上書きしない。ページ単位の失敗は
 * ノイズ（Sentry への送信）を避けるため debug ログとしてのみ記録する。
 *
 * @param browser Puppeteer ブラウザインスタンス
 * @param logger ロガー
 */
export async function saveDebugInfo(browser: Browser, logger: Logger) {
  const debugDirectory = getDebugDirectory()
  try {
    if (!fs.existsSync(debugDirectory)) {
      fs.mkdirSync(debugDirectory)
    }

    const pages = await browser.pages()
    for (const [index, page] of pages.entries()) {
      if (page.isClosed() || page.url() === 'about:blank') {
        continue
      }
      const timestamp = new Date().toISOString().replaceAll(':', '-')

      try {
        await withTimeout(
          page.screenshot({
            path: `${debugDirectory}/error-${timestamp}-${index}.png`,
          }),
          `page[${index}] screenshot`
        )
      } catch (error) {
        logger.debug(
          `Failed to save debug screenshot for page[${index}]: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      try {
        const content = await withTimeout(
          page.content(),
          `page[${index}] content`
        )
        fs.writeFileSync(
          `${debugDirectory}/error-${timestamp}-${index}.html`,
          content
        )
      } catch (error) {
        logger.debug(
          `Failed to save debug HTML for page[${index}]: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } catch (error) {
    logger.warn('Failed to save debug info', error as Error)
  }
}
