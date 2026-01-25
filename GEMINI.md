# GEMINI.md

## 目的

Gemini CLI 向けのコンテキストと作業方針を定義する。

## 出力スタイル

- 言語: 日本語で応答する
- トーン: プロフェッショナルかつ明確
- 形式: 簡潔で構造化された応答

## 共通ルール

- 会話言語: 日本語
- コミット規約: Conventional Commits に従う
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載
  - 例: `feat: Booklog 登録機能を追加`
- 日本語と英数字の間には半角スペースを挿入

## プロジェクト概要

- 目的: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに登録する
- 主な機能:
  - Amazon.co.jp へのログインと ASIN コード取得
  - OTP による 2 段階認証対応
  - Booklog への個別登録
  - Cookie によるセッション保持
  - CSV からの既存蔵書確認

## コーディング規約

- フォーマット: Prettier（`.prettierrc.yml` 参照）
  - printWidth: 80
  - tabWidth: 2
  - semi: false
  - singleQuote: true
- 命名規則: キャメルケース（TypeScript 標準）
- コメント言語: 日本語
- エラーメッセージ言語: 英語

## 開発コマンド

```bash
# 依存関係のインストール
pnpm install

# 開発（ウォッチモード）
pnpm dev

# 実行
pnpm start

# ビルド
pnpm compile

# Lint チェック
pnpm lint

# Lint 自動修正
pnpm fix

# TypeScript 型チェック
pnpm lint:tsc
```

## 注意事項

### 認証情報

- API キーや認証情報を Git にコミットしない
- ログに個人情報や認証情報を出力しない
- Cookie ファイルは `.gitignore` で除外する

### 既存ルールの優先

- プロジェクト固有のルールがある場合はそれを優先する
- ESLint / Prettier の設定を尊重する

### 既知の制約

- テストフレームワークが未導入
- Docker / Docker Compose での動作を前提とする
- Puppeteer による外部サイトへのアクセスを含む

## リポジトリ固有

### 技術スタック

- 言語: TypeScript
- ランタイム: Node.js v24.13.0
- パッケージマネージャー: pnpm v10.28.1
- 主要ライブラリ:
  - puppeteer-core: ブラウザ自動操作
  - axios: HTTP クライアント
  - csv-parse: CSV パース
  - otplib: OTP 生成

### アーキテクチャ

- `src/main.ts`: エントリーポイント
- `src/amazon.ts`: Amazon.co.jp 処理
- `src/booklog.ts`: Booklog ログイン処理
- `src/booklog-update-book.ts`: Booklog 登録処理
- `src/proxy-auth.ts`: プロキシ認証処理
- `src/models/`: データモデル定義

### 特記事項

- 一括登録を行わない設計（Twitter などへの自動投稿を可能にするため）
- OTP による 2 段階認証に対応
- 登録履歴を JSON ファイルで管理
- Renovate の既存 PR には追加コミットしない
