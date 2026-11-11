# AGENTS.md

AI コーディングエージェントとコントリビューター向けのガイド。`CLAUDE.md` はこのファイルを取り込み、`.github/copilot-instructions.md` はレビュー観点を補足する。

## Language

- 成果物はすべて**日本語**で書く。対象は、コミットメッセージの description、PR / Issue のタイトルと本文、レビューコメント、コードコメントと JSDoc、ドキュメント（`README.md`、`AGENTS.md` など）。
- 日本語と英数字の間には半角スペースを入れる。段落の途中で手動改行しない。
- 例外（そのまま維持する）: 引用、技術的な識別子、生成ファイル、外部由来の文章。`.github/copilot-instructions.md` は意図的に英語で書く。
- 実行時メッセージ（ログ、エラー）は英語。Discord 通知の文言は既存どおり日本語。
- 過去のコミットの言語を変えるために Git 履歴を書き換えない。
- `package.json` の文章は英語。

## 概要

Amazon.co.jp で購入した Kindle 作品の ASIN を取得し、[ブクログ](https://booklog.jp) の本棚に未登録のものを登録して Discord に通知する Node.js / TypeScript アプリケーション。Puppeteer（`puppeteer-core`）でブラウザを操作する。Docker Compose で常駐実行する。

## コマンド

```bash
pnpm install        # 依存関係のインストール（pnpm 以外は preinstall で拒否される）
pnpm start          # 実行（tsx ./src/main.ts）
pnpm dev            # ホットリロード実行（tsx watch）
pnpm test           # node:test（node --import tsx --test src/*.test.ts）
pnpm lint           # Prettier + ESLint + tsc
pnpm fix            # Prettier + ESLint の自動修正
pnpm compile        # ビルド（tsc -p .）
pnpm compile:test   # 型チェックのみ（tsc --noEmit）

docker compose up -d   # 常駐実行（compose-all-update.yaml は UPDATE_ALL_BOOKS=true の全件更新用）
```

Node.js のバージョンは `.node-version`、pnpm のバージョンは `package.json` の `packageManager` で固定している。

## 構成

`src/main.ts` がエントリーポイントで、Amazon ログイン → ASIN 取得 → ブクログ認証・蔵書 CSV 取得 → 未登録分の登録 → ステータス未設定の本の更新（`UPDATE_ALL_BOOKS=true` のときはさらに、Kindle の読書進捗を取得できた本のタグ更新と、進捗 99% 以上の本の読み終わり更新）→ Discord 通知の順に処理する。

- `src/amazon.ts`: Amazon ログイン（Cookie 再利用、OTP 対応）、ASIN 取得、読書進捗の取得
- `src/booklog.ts`: ブクログ認証状態の確認、手動ログイン待機、蔵書 CSV 取得、本の登録・更新
- `src/booklog-update-book.ts`: ブクログの編集ページの操作（読書状況、タグなど）
- `src/cookie-utils.ts`: Cookie の正規化と復元
- `src/chromium-launch-diagnostics.ts`, `src/debug-info.ts`: Chromium 起動失敗時の診断情報とデバッグ情報の保存
- `src/proxy-auth.ts`: Puppeteer のプロキシ認証
- `src/models/`: Kindle レスポンスの型定義
- `entrypoint.sh`: コンテナ起動スクリプト（Xvfb / x11vnc の起動と監視、10 分間隔でアプリを再実行）

認証情報（Amazon のユーザー名・パスワード・OTP シークレット、Discord、プロキシ）は `data/config.json`（Docker では `CONFIG_PATH`）で管理する。ブクログの ID・パスワードはアプリケーションでは扱わず、`/data/userdata` の認証済み Chromium プロファイルを使う。

## 規約

- フォーマットは Prettier（`singleQuote: true`、`semi: false`、`tabWidth: 2`、`printWidth: 80`）、Lint は ESLint（`@book000/eslint-config`）。
- TypeScript は strict モード。`skipLibCheck` で型エラーを回避しない。
- コメントは「なぜ」を書き、コードを読めば分かることは書かない。新規・変更する公開関数とインターフェースには JSDoc を付ける。
- セレクタと URL は定数化し、待機は `page.waitForSelector()` などの明示的な待機を使う。
- 非同期処理にはエラーハンドリングとログを入れる。
- ブクログのログインフォームは自動送信しない。未認証時は VNC での手動ログインを待つ。reCAPTCHA の回避や fingerprint の偽装は実装しない。
- 認証情報や個人情報をログに出力しない。シークレットをコミットしない（`data/` は `.gitignore` 済み）。
- コミットは [Conventional Commits](https://www.conventionalcommits.org/)、ブランチは [Conventional Branch](https://conventional-branch.github.io) の短縮形（`feat/...`、`fix/...`）。
- Renovate が作成した PR にはコミットしない。
- Amazon / ブクログの画面構成は変わり得るため、ログイン・取得・登録・Discord 通知に関わる変更は `pnpm test` と `pnpm lint` に加えて実環境（Docker Compose）で確認する。
- コマンドや構成を変えたら、このファイルと `README.md` を実態に合わせて更新する。
