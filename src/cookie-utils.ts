import { Browser, CookieParam } from 'puppeteer-core'

/**
 * 保存された Cookie の partitionKey を、
 * 現在の puppeteer-core が要求する `sourceOrigin` 形式に正規化する。
 *
 * puppeteer 系ライブラリはバージョンによって `Cookie.partitionKey` の
 * フィールド名が `topLevelSite` / `sourceOrigin` の間で変わることがある。
 * 異なるバージョンで保存された Cookie ファイルをそのまま復元すると、
 * CDP の `Storage.setCookies` が必須フィールド不足で失敗する。
 *
 * @param cookie 保存された Cookie
 * @returns partitionKey を正規化した Cookie
 */
export function normalizeCookiePartitionKey(cookie: CookieParam): CookieParam {
  const partitionKey = cookie.partitionKey
  if (
    !partitionKey ||
    typeof partitionKey !== 'object' ||
    'sourceOrigin' in partitionKey ||
    typeof (partitionKey as { topLevelSite?: unknown }).topLevelSite !==
      'string'
  ) {
    return cookie
  }

  const legacyPartitionKey = partitionKey as {
    topLevelSite: string
    hasCrossSiteAncestor?: boolean
  }
  return {
    ...cookie,
    partitionKey: {
      sourceOrigin: legacyPartitionKey.topLevelSite,
      hasCrossSiteAncestor: legacyPartitionKey.hasCrossSiteAncestor,
    },
  }
}

/**
 * JSON から読み込んだ値が、Cookie として復元できる形（`name` を持つ
 * オブジェクト）かどうかを判定する。
 *
 * @param value 判定対象の値
 * @returns Cookie として扱える場合は true
 */
function isRestorableCookie(
  value: unknown
): value is CookieParam & { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

/**
 * 保存された Cookie 群をブラウザに復元する。
 *
 * 形式が不正な Cookie や復元に失敗した Cookie は警告ログを出して読み
 * 飛ばし、他の Cookie の復元やログインフロー全体を継続させる。ただし
 * 全件の復元に失敗した場合は、Cookie によるセッション復元が実質的に
 * 機能していないことを示すため、別途エラーログを残す。
 *
 * @param browser 復元先の Browser
 * @param cookies 保存された Cookie の配列（JSON ファイルから読み込んだ
 * 未検証の値を想定する）
 */
export async function restoreCookies(
  browser: Browser,
  cookies: unknown
): Promise<void> {
  if (!Array.isArray(cookies)) {
    console.warn('Cookie file does not contain an array, skipping restore')
    return
  }

  let failedCount = 0
  for (const cookie of cookies) {
    if (!isRestorableCookie(cookie)) {
      console.warn('Skipping malformed cookie entry (missing "name")')
      failedCount++
      continue
    }
    try {
      await browser.setCookie(normalizeCookiePartitionKey(cookie))
    } catch (error) {
      failedCount++
      console.warn(
        `Failed to restore cookie "${cookie.name}", skipping:`,
        error
      )
    }
  }

  if (cookies.length > 0 && failedCount === cookies.length) {
    console.error(
      `Failed to restore all ${cookies.length} cookie(s); a full login will be attempted`
    )
  }
}
