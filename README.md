# kindle-booklog

Amazon.co.jp で購入した Kindle 作品を取得して、[ブクログ](https://booklog.jp) に登録します。

## Features

- 購入メールからの情報取得をせずに、Amazon にログインして ASIN コードを取得します。（購入メールには ASIN コードが載らなくなりました）
- Amazon ログイン時の OTP による 2 段階認証に対応しています。
- ブクログのブラウザプロファイルを永続化し、初回・セッション切れ時のみ手動ログインできます。
- 登録済みアイテムのフィルタリングに対応しています。
- Discord への通知に対応しています。
- 一括登録を行わないため、Twitter などに自動投稿できます。
- Docker (Docker Compose) で動作します。

## Processing Flow

1. Amazon.co.jp にログインします。Cookie ファイルがあればその Cookie を使用した上で、ログインの必要があればログイン処理を行います。
2. `read.amazon.co.jp` から Kindle 作品の ASIN コードを取得します。
3. ブクログの認証済みブラウザプロファイルを再利用します。未認証の場合は VNC で手動ログインし、以後は `/data/userdata` のプロファイルを再利用します。
4. [エクスポートページ](https://booklog.jp/export) から本棚の蔵書データを CSV ファイルとしてエクスポートし、登録済みのアイテムを取得します。
5. ASIN コードを元に既に登録されているかを確認・フィルタリングし、新しく購入された Kindle 本をピックアップします。さらに、本アプリケーションで一度でも登録したものを除外します。
6. 「登録情報の編集・削除」ページより本棚に登録します。
7. Discord に通知します。

## Booklog authentication

ブクログのログインフォームは reCAPTCHA による検証があるため、本アプリケーションから ID・パスワードを自動送信しません。Docker では Chromium のユーザーデータを `/data/userdata` に保存し、認証済みセッションをコンテナ再作成後も再利用します。

初回起動またはセッション切れ時にはログに `Booklog manual login required` と表示されます。その場合は VNC で Chromium を開き、ブクログへ手動ログインしてください。既定では 5 分間ログイン完了を待ちます。待機時間は `BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS` で変更できます。

VNC ポートは認証なしで動作するため、Docker Compose では localhost のみに公開します。別マシンから操作する場合は SSH ポートフォワーディングなどを利用してください。

## License

このプロジェクトのライセンスは [MIT License](LICENSE) です。
