# GitHub Copilot レビュー指示

このリポジトリのプルリクエストをレビューする際のガイドライン。

## プロジェクト概要

Amazon.co.jp で購入した Kindle 作品を取得し、ブクログへ自動登録する Node.js / TypeScript アプリ。`puppeteer-core` で Amazon（OTP 2 段階認証対応）とブクログにログインし、ASIN で登録済みを除外して新規分を登録、Discord に通知する。Docker Compose で常駐実行する。

## 技術スタック

- TypeScript / Node.js / pnpm
- `puppeteer-core`（ブラウザ自動化）、`axios`（HTTP）、`csv-parse`（ブクログの CSV）、`otplib`（OTP）、`@book000/node-utils`（Logger / Discord）

## 規約（レビューで確認する点）

以下は Prettier / ESLint / tsc で自動強制されるため、指摘は原則ツールに委ね、レビューでは重複指摘しない:

- Prettier: `singleQuote: true`, `semi: false`, `tabWidth: 2`, `printWidth: 80`
- ESLint: `@book000/eslint-config`
- TypeScript strict。`skipLibCheck` による型エラー回避は禁止（見つけたら指摘する）

人によるレビューで確認すべき点:

- コメント・JSDoc は日本語、エラーメッセージは英語、日本語と英数字の間に半角スペース
- 命名: クラス PascalCase、関数・変数 camelCase、定数 UPPER_SNAKE_CASE
- 公開関数・インターフェースに日本語 JSDoc があるか

## 重点レビュー観点

- **機密情報**: Amazon / ブクログの認証情報、Discord Webhook URL、OTP シークレットがコード・ログ・テストに直書きされていないか。これらは `data/config.json`（`.gitignore` 済み）で管理する。ログへの個人情報・認証情報の出力がないか。
- **Puppeteer の堅牢性**: セレクタ・URL がハードコードされず定数化されているか。待機は `page.waitForSelector()` 等の明示的待機を使い、固定 `sleep` に依存していないか（Amazon / ブクログの UI は変わり得る）。
- **エラーハンドリング**: 非同期処理に try/catch とログがあり、握りつぶしていないか。
- **ASIN の除外ロジック**: `data/added-asins.json` と CSV による登録済み判定を壊し、重複登録・多重通知を招いていないか。

## 誤検知として指摘しないもの

- テストフレームワーク未導入のため、テストコードの不在は指摘不要。
- `puppeteer-core` の利用（実行環境に Chrome / Chromium がある前提）。フルパッケージ `puppeteer` への変更提案は不要。
- `entrypoint.sh` の無限ループ（10 分間隔での再実行）は常駐設計として意図的なもの。
