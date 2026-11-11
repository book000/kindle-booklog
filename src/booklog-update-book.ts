import { Page } from 'puppeteer-core'
import { BookStatus, BooklogBookOptions } from './booklog'
import { Logger } from '@book000/node-utils'

export default class BooklogUpdateBook {
  private readonly logger = Logger.configure('BooklogUpdateBook')

  constructor(
    private readonly page: Page,
    private readonly itemId: string,
    private readonly options: BooklogBookOptions
  ) {}

  /**
   * 更新する
   */
  public async update() {
    this.validatePageUrl()

    if (this.options.status) {
      await this.setBookStatus(this.options.status)
    }
    if (this.options.readAt) {
      await this.setReadAt(this.options.readAt)
    }
    if (this.options.rate !== undefined) {
      await this.setRate(this.options.rate)
    }
    if (this.options.category) {
      this.setCategory()
    }
    if (this.options.review) {
      await this.setReview(this.options.review, this.options.isReviewSpoiler)
    }
    if (this.options.tags) {
      await this.setTags(this.options.tags)
    }
    if (this.options.createdAt) {
      this.setCreatedAt()
    }
    if (this.options.memo) {
      await this.setMemo(this.options.memo)
    }
    if (this.options.isPrivate) {
      await this.setPrivate(this.options.isPrivate)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))

    await this.save()
  }

  private validatePageUrl() {
    const url = this.page.url()
    if (!url.startsWith('https://booklog.jp/edit/1/')) {
      throw new Error(`Invalid page URL: ${url}`)
    }
  }

  /**
   * 保存する
   */
  private async save() {
    // 保存ボタンを押して画面が遷移するのを待つ
    await Promise.all([
      this.page
        .waitForSelector('div#edit_panels p.buttons button[type="submit"]', {
          visible: true,
        })
        .then((element) => element?.click()),
      this.page.waitForNavigation({
        waitUntil: 'domcontentloaded',
      }),
    ])
    await this.page.close()
  }

  /**
   * 読書状況を更新する
   *
   * @param status 読書状況
   */
  private async setBookStatus(status: BookStatus) {
    // 要素が存在することを確認
    await this.page.waitForSelector('td#status p.edit-status', {
      visible: true,
    })

    const statusValue = this.getStatusValue(status)
    const statusId = `status${statusValue}_1_${this.itemId}`

    // 読書状況を変更する
    await this.page
      .waitForSelector(`td#status p.edit-status > label[for="${statusId}"]`, {
        visible: true,
      })
      .then((element) => element?.scrollIntoView())
    await this.page
      .waitForSelector(`td#status p.edit-status > label[for="${statusId}"]`, {
        visible: true,
      })
      .then((element) => element?.click())
  }

  /**
   * 読了日を更新する
   *
   * @param readAt 読了日。nullまたは空文字列の場合は未設定として扱う
   */
  private async setReadAt(readAt: string | null) {
    // 要素が存在することを確認
    await this.page.waitForSelector('td#status div.edit-status-area', {
      visible: true,
    })

    // 未設定の場合は「読了日を指定しない」にチェックを入れる
    if (readAt === null || readAt === '') {
      const isReadAtNullChecked = await this.page
        .waitForSelector('td#status div#read_at input#read_at_null', {
          visible: true,
        })
        .then((element) => element?.evaluate((el) => el.checked))

      if (!isReadAtNullChecked) {
        await this.page
          .waitForSelector('td#status div#read_at label[for="read_at_null"]', {
            visible: true,
          })
          .then((element) => element?.click())
      }
      return
    }

    // 読了日がある場合は、日付を入力する
    // 読了日は yyyy-mm-dd の形式である必要がある
    const expectedDatePattern = /^\d{4}-\d{2}-\d{2}$/
    if (!expectedDatePattern.test(readAt)) {
      throw new Error(`Invalid date format: ${readAt}`)
    }

    // 読了日を入力する
    await this.page
      .waitForSelector('td#status div#read_at input#read-date', {
        visible: true,
      })
      .then((element) =>
        element?.evaluate((el, readAt) => (el.value = readAt), readAt)
      )
  }

  /**
   * 評価を更新する
   *
   * @param rate 評価（1～5）、nullの場合は未設定として扱う
   */
  private async setRate(rate: number | null): Promise<void> {
    if (rate !== null && (rate < 1 || rate > 5)) {
      throw new Error(`Invalid rate: ${rate}`)
    }

    await this.page.waitForSelector('div.edit-rating', {
      visible: true,
    })

    // 評価を設定する
    const rateValue = rate ?? 'x'
    await this.page
      .waitForSelector(`div.edit-rating img[alt="${rateValue}"]`, {
        visible: true,
      })
      .then((element) => element?.click())
  }

  /**
   * カテゴリを更新する
   */
  private setCategory() {
    // カテゴリはプルダウンの既存値の選択と新規作成の両方があり、操作が複雑なため未対応
    throw new Error('Not implemented')
  }

  /**
   * レビュー・感想を更新する
   *
   * @param review レビュー・感想
   */
  private async setReview(review: string, isSpoiler?: boolean) {
    await this.page.waitForSelector('div.edit-review-area', {
      visible: true,
    })

    // 読了日を入力する
    await this.page
      .waitForSelector('div.edit-review-area textarea#edit-review', {
        visible: true,
      })
      .then((element) =>
        element?.evaluate((el, review) => (el.value = review), review)
      )

    // 「ネタバレの内容を含む」のチェックボックスを更新する
    if (isSpoiler === undefined) {
      return
    }
    const netabareInputElement = await this.page.waitForSelector(
      'div.edit-review-area div.netabare input.edit-netabare',
      {
        visible: true,
      }
    )
    const isChecked = await netabareInputElement?.evaluate((el) => el.checked)
    if (isChecked !== isSpoiler) {
      await netabareInputElement?.click()
    }
  }

  /**
   * タグを更新する
   *
   * @param tags タグ
   */
  private async setTags(tags: string[]) {
    this.logger.info(`Setting tags: ${tags.join(' ')}`)
    await this.page.waitForSelector('textarea#tags', {
      visible: true,
    })

    // タグを設定する
    await this.page
      .waitForSelector('textarea#tags', {
        visible: true,
      })
      .then((element) =>
        element?.evaluate((el, tags) => (el.value = tags), tags.join(' '))
      )
  }

  /**
   * 登録日時を更新する
   */
  private setCreatedAt() {
    // 年・月・日・時・分・秒を別々の入力欄に入れる必要があり、操作が複雑なため未対応
    throw new Error('Not implemented')
  }

  /**
   * 読書メモ(非公開)を更新する
   *
   * @param memo 読書メモ
   */
  private async setMemo(memo: string) {
    // 要素が存在することを確認
    await this.page.waitForSelector('textarea#memo', {
      visible: true,
    })

    // 読書メモを入力する
    await this.page
      .waitForSelector('textarea#memo', {
        visible: true,
      })
      .then((element) =>
        element?.evaluate((el, memo) => (el.value = memo), memo)
      )
  }

  /**
   * 非公開登録のオプションを更新する
   */
  private async setPrivate(isPrivate: boolean) {
    // 要素が存在することを確認
    await this.page.waitForSelector('input#book_secret', {
      visible: true,
    })

    // 非公開登録のオプションを更新する
    const isPrivateCheckboxElement = await this.page.waitForSelector(
      'input#book_secret',
      {
        visible: true,
      }
    )
    const isChecked = await isPrivateCheckboxElement?.evaluate(
      (el) => el.checked
    )
    if (isChecked !== isPrivate) {
      await isPrivateCheckboxElement?.click()
    }
  }

  /**
   * 読書状況のIDで用いられる値を取得する
   *
   * @param status 読書状況
   * @returns 読書状況のIDで用いられる値
   */
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
