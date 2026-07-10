# CLAUDE.md

Amazon.co.jp で購入した Kindle 作品を取得し、[ブクログ](https://booklog.jp) に自動登録する Node.js / TypeScript アプリケーション。Puppeteer で Amazon（OTP 2 段階認証対応）とブクログにログインし、登録済みアイテムをフィルタして新規購入分のみを登録、Discord に通知する。Docker Compose で常駐実行する。

## 開発コマンド

```bash
pnpm install           # 依存関係のインストール（pnpm 以外は preinstall で拒否）
pnpm dev               # ホットリロード実行（tsx watch）
pnpm start             # 実行（tsx ./src/main.ts）
pnpm compile           # ビルド（tsc -p .）
pnpm compile:test      # 型チェックのみ（tsc --noEmit）
pnpm lint              # prettier + eslint + tsc
pnpm lint:prettier     # Prettier チェック
pnpm lint:eslint       # ESLint チェック
pnpm lint:tsc          # 型チェック
pnpm fix               # prettier + eslint 自動修正
pnpm clean             # dist / output を削除

docker compose up -d   # 常駐実行
docker compose logs -f # ログ表示
docker compose down    # 停止
```

## アーキテクチャと主要ファイル

処理フロー（`src/main.ts` がエントリーポイント）:

1. Amazon.co.jp にログイン（Cookie があれば再利用、OTP 対応）
2. `read.amazon.co.jp` から Kindle 作品の ASIN コードを取得
3. ブクログにログイン（Cookie があれば再利用）
4. [エクスポートページ](https://booklog.jp/export) から蔵書 CSV を取得
5. ブクログの蔵書 CSV に含まれる itemId（= ASIN）と照合して登録済みを除外
6. 新規購入分をブクログの本棚に登録
7. Discord に通知

- `src/main.ts` — 全体の処理フロー
- `src/amazon.ts` — Amazon ログイン、ASIN 取得、Cookie 保存
- `src/booklog.ts` — ブクログログイン、CSV 取得、本の登録
- `src/booklog-update-book.ts` — ブクログの本の更新（タグ等）
- `src/proxy-auth.ts` — Puppeteer のプロキシ認証
- `src/models/` — Kindle レスポンス / メタデータの型定義
- `entrypoint.sh` — コンテナ起動スクリプト（Xvfb/x11vnc 起動、10 分間隔で再実行）

主要ライブラリ: `puppeteer-core`（ブラウザ自動化・HTTP は page 経由）, `csv-parse`（CSV 解析）, `otplib`（OTP）, `iconv-lite`（CSV 文字コード変換）, `tar-stream`（Kindle レスポンスの tar 展開）, `@book000/node-utils`（Logger / Discord）。

## コーディング規約

- **会話・コメント・JSDoc**: 日本語。**エラーメッセージ**: 英語。日本語と英数字の間には半角スペースを入れる。
- **フォーマット**: Prettier（`singleQuote: true`, `semi: false`, `tabWidth: 2`, `printWidth: 80`）。
- **Lint**: ESLint（`@book000/eslint-config`）。
- **TypeScript**: strict モード。`skipLibCheck` での型エラー回避は禁止。関数・インターフェースには日本語 JSDoc を記載する。
- **命名**: クラス PascalCase、関数・変数 camelCase、定数 UPPER_SNAKE_CASE。
- 推奨: セレクタ・URL は定数化する / 待機は `page.waitForSelector()` 等を使い `sleep` を避ける / 非同期処理にはエラーハンドリングとログを入れる。

## テスト

- テストフレームワークは未導入。動作確認は Docker Compose で実際に実行して行う。
- 変更時は最低限 `pnpm lint`（Prettier / ESLint / 型チェック）を通す。
- Amazon / ブクログのセレクタは変更され得るため、ログイン・取得・登録・Discord 通知は手動で動作確認する。

## セキュリティ / 運用上の注意

- 認証情報（Amazon・ブクログのユーザー名/パスワード、Discord Webhook URL、OTP シークレット）は `data/config.json` で管理し、Git にコミットしない（`data/` は `.gitignore` 済み）。ログに認証情報や個人情報を出力しない。
- `puppeteer-core` を使うため、実行環境に Chrome / Chromium が必要。
- ブクログのエクスポートは時間がかかるためタイムアウトに注意する。
- `compose.yaml` が通常実行、`compose-all-update.yaml` が全件更新用（`UPDATE_ALL_BOOKS=true`）。
- Renovate が作成した PR には追加コミットや更新を行わない。

## Git / コミット規約

- コミットは [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)。形式 `<type>(<scope>): <description>`、`<description>` は日本語。例: `feat: Discord 通知機能を追加`。
- ブランチは [Conventional Branch](https://conventional-branch.github.io) 短縮形（`feat`, `fix` 等）。例: `feat/add-discord-notification`。

## ドキュメント更新ルール

- **README.md**: プロジェクト概要・処理フロー変更時。
- **Dockerfile / compose.yaml**: Docker 構成変更時。
- **CLAUDE.md**: アーキテクチャ・コマンド・規約の変更時（コマンドやファイルパスが実態と乖離しないよう更新する）。
- **.github/copilot-instructions.md**: 技術スタック・レビュー観点の変更時。

## CI/CD

- `.github/workflows/nodejs-ci-pnpm.yml` — Lint / 型チェック
- `.github/workflows/hadolint-ci.yml` — Dockerfile Lint
- `.github/workflows/docker.yml` — Docker イメージビルド
- `.github/workflows/add-reviewer.yml` — PR 作成時にレビュアー追加
