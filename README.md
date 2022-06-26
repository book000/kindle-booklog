# kindle-booklog

Amazon.co.jp で購入した Kindle 作品を取得して、[ブクログ](https://booklog.jp) に登録します。

## Features

- 購入メールからの情報取得をせずに、Amazon にログインして ASIN コードを取得します。（購入メールには ASIN コードが載らなくなりました）
- Amazon ログイン時の OTP による2段階認証に対応しています。
- 一括登録を行わないため、Twitter などに自動投稿できます。
- Docker (Docker Compose) で動作します。

## Processing Flow

1. Amazon.co.jp にログインします。Cookie ファイルがあればその Cookie を使用した上で、ログインの必要があればログイン処理を行います。
2. `read.amazon.co.jp` から Kindle 作品の ASIN コードを取得します。
3. ブクログにログインします。Cookie ファイルがあればその Cookie を使用した上で、ログインの必要があればログイン処理を行います。
4. [エクスポートページ](https://booklog.jp/export) から本棚の蔵書データを CSV ファイルとしてエクスポートし、登録済みのアイテムを取得します。
5. ASIN コードを元に既に登録されているかを確認・フィルタリングし、新しく購入された Kindle 本をピックアップします。さらに、本アプリケーションで一度でも登録したものを除外します。
6. 「登録情報の編集・削除」ページより本棚に登録します。

## License

このプロジェクトのライセンスは [MIT License](LICENSE) です。