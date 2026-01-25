# GitHub Copilot Instructions

## プロジェクト概要

- **目的**: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに登録する
- **主な機能**:
  - Amazon にログインして ASIN コードを取得
  - OTP による 2 段階認証に対応
  - ブクログへの自動登録
  - Discord への通知
- **対象ユーザー**: 開発者
- **実行環境**: Docker / Docker Compose

## 共通ルール

- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。形式: `<type>(<scope>): <description>`。`<description>` は日本語で記載する。
- 日本語と英数字の間には半角スペースを入れる。
- コード内のコメントは日本語で記載する。
- エラーメッセージは英語で記載する。

## 技術スタック

- **言語**: TypeScript
- **ランタイム**: Node.js
- **パッケージマネージャー**: pnpm
- **主要ライブラリ**:
  - `puppeteer-core`: ブラウザ自動化（Amazon / ブクログログイン、データ取得）
  - `axios`: HTTP クライアント
  - `csv-parse`: CSV パース（ブクログのエクスポートデータ）
  - `otplib`: OTP 生成（2 段階認証）
  - `@book000/node-utils`: ユーティリティ（Logger, Discord）

## コーディング規約

- **フォーマット**: Prettier
  - `singleQuote: true`
  - `semi: false`
  - `tabWidth: 2`
- **Lint**: ESLint (`@book000/eslint-config`)
- **TypeScript**:
  - Strict モード有効
  - `noImplicitAny`, `strictNullChecks` 有効
  - `skipLibCheck` での回避は禁止
- **命名規則**:
  - クラス: PascalCase
  - 関数・変数: camelCase
  - 定数: UPPER_SNAKE_CASE
- **ドキュメント**: 関数・インターフェースに JSDoc を日本語で記載する

## 開発コマンド

```bash
# 依存関係のインストール
pnpm install

# 開発（ホットリロード）
pnpm dev

# 実行
pnpm start

# ビルド
pnpm compile

# TypeScript 型チェック（ビルドなし）
pnpm compile:test

# クリーン
pnpm clean

# Lint
pnpm lint              # prettier + eslint + tsc
pnpm lint:prettier     # Prettier チェック
pnpm lint:eslint       # ESLint チェック
pnpm lint:tsc          # TypeScript 型チェック

# Format
pnpm fix               # prettier + eslint 自動修正
pnpm fix:prettier      # Prettier 自動修正
pnpm fix:eslint        # ESLint 自動修正
```

## テスト方針

- テストフレームワークは現在未導入。
- 動作確認は Docker Compose で実際に実行して行う。

## セキュリティ / 機密情報

- API キーや認証情報（Amazon のユーザー名・パスワード、ブクログのユーザー名・パスワード、Discord Webhook URL など）は設定ファイルで管理し、Git にコミットしない。
- ログに個人情報や認証情報を出力しない。
- OTP シークレットは環境変数または設定ファイルで管理し、Git にコミットしない。

## ドキュメント更新

以下のファイルを変更した場合は、関連ドキュメントを更新する：

- **README.md**: プロジェクト概要、使用方法、処理フローの変更時
- **Dockerfile / compose.yaml**: Docker 構成の変更時
- **.github/copilot-instructions.md**: 技術スタック、開発コマンドの変更時

## リポジトリ固有

### 処理フロー

1. Amazon.co.jp にログイン（Cookie ファイルがあればそれを使用）
2. `read.amazon.co.jp` から Kindle 作品の ASIN コードを取得
3. ブクログにログイン（Cookie ファイルがあればそれを使用）
4. ブクログのエクスポートページから蔵書データを CSV としてエクスポート
5. ASIN コードを元に既に登録されているかを確認・フィルタリング
6. 新しく購入された Kindle 本をブクログに登録
7. Discord に通知

### 主要ファイル

- `src/main.ts`: エントリーポイント（全体の処理フロー）
- `src/amazon.ts`: Amazon ログイン、ASIN コード取得
- `src/booklog.ts`: ブクログログイン、蔵書データ取得、本の登録
- `src/booklog-update-book.ts`: ブクログの本の更新（タグ追加など）
- `src/proxy-auth.ts`: プロキシ認証処理
- `src/models/`: データモデル定義

### 設定ファイル

- `data/config.json`: 実行時の設定（Amazon / ブクログのユーザー名・パスワード、Discord Webhook URL など）
- `data/cookies-amazon.json`: Amazon の Cookie
- `data/cookies-booklog.json`: ブクログの Cookie
- `data/added-asins.json`: 登録済みの ASIN コード一覧

### Docker

- Docker Compose で実行する。
- `compose.yaml`: 通常実行用
- `compose-all-update.yaml`: 全件更新用（`UPDATE_ALL=true`）
- `entrypoint.sh`: コンテナ起動時のエントリーポイント

### CI/CD

- `.github/workflows/nodejs-ci-pnpm.yml`: Node.js CI（Lint / 型チェック）
- `.github/workflows/hadolint-ci.yml`: Dockerfile Lint
- `.github/workflows/docker.yml`: Docker イメージビルド
- `.github/workflows/add-reviewer.yml`: PR 作成時にレビュアーを追加

### 注意事項

- Puppeteer は `puppeteer-core` を使用しているため、実行環境に Chrome / Chromium がインストールされている必要がある。
- 設定ファイル（`data/config.json`）と Cookie ファイルは Git にコミットしない（`.gitignore` に追加済み）。
- Amazon / ブクログのログイン処理は、セレクタが変更される可能性があるため、定期的に動作確認を行う。
- ブクログのエクスポートは時間がかかる場合があるため、タイムアウトに注意する。
