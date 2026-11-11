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
5. ASIN コードを元に既に登録されているかを確認・フィルタリングし、新しく購入された Kindle 本をピックアップします。
6. 「登録情報の編集・削除」ページより本棚に登録します。
7. ブクログでステータスが未設定の本のうち、Kindle の読書進捗を取得できて 99% 以上のものを「読み終わった」に更新します。`UPDATE_ALL_BOOKS=true` の場合は、これに加えて、Kindle の読書進捗を取得できた登録済みの本すべてについて、タグを更新し、進捗が 99% 以上なら「読み終わった」にも更新します。
8. 新規登録・読了更新・全件更新の完了と、エラー発生時に Discord に通知します。

## Setup

`data/config.json` を作成します（`data/` は Git の管理対象外です）。パスは環境変数 `CONFIG_PATH` で変更できます。

```json
{
  "amazon": {
    "username": "Amazon のユーザー名",
    "password": "Amazon のパスワード",
    "otpSecret": "OTP のシークレット（2 段階認証を使う場合のみ）"
  },
  "discord": {},
  "proxy": { "server": "http://proxy:8080", "username": "user", "password": "pass" },
  "puppeteer": {}
}
```

- `discord`: [`@book000/node-utils`](https://github.com/book000/node-utils) の `DiscordOptions` を指定します。
- `proxy`、`puppeteer`: 省略できます。`proxy` の `username` と `password` は、両方指定した場合のみ認証に使われます。`puppeteer` は Puppeteer の起動オプションを上書きします。

```bash
docker compose up -d    # 常駐実行（コンテナ内で 10 分間隔で再実行します）
docker compose -f compose-all-update.yaml up -d    # UPDATE_ALL_BOOKS=true で全件更新する場合
```

## Development

```bash
pnpm install
pnpm start    # 実行
pnpm test     # テスト
pnpm lint     # Prettier + ESLint + tsc
```

## Booklog authentication

ブクログのログインフォームは reCAPTCHA による検証があるため、本アプリケーションから ID・パスワードを自動送信しません。Docker では Chromium のユーザーデータを `/data/userdata` に保存し、認証済みセッションをコンテナ再作成後も再利用します。

初回起動またはセッション切れ時にはログに `Booklog manual login required` と表示されます。その場合は VNC で Chromium を開き、ブクログへ手動ログインしてください。既定では 5 分間ログイン完了を待ちます。待機時間は `BOOKLOG_MANUAL_LOGIN_TIMEOUT_MS` で変更できます。待機がタイムアウトした後の 1 時間は待機せずに即時失敗し（状態は `BOOKLOG_LOGIN_STATE`、既定 `data/booklog-login-pending.json`）、Discord への通知は停止ごとに 1 回だけ行います。ログイン後のブクログ Cookie は `COOKIE_BOOKLOG`（既定 `data/cookie-booklog.json`）に保存し、プロファイルのセッションが切れた場合に復元します。

VNC ポートは認証なしで動作するため、Docker Compose では localhost のみに公開します。別マシンから操作する場合は SSH ポートフォワーディングなどを利用してください。

## License

このプロジェクトのライセンスは [MIT License](LICENSE) です。
