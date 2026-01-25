# GitHub Copilot Instructions

## プロジェクト概要

- 目的: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに登録する
- 主な機能:
  - Amazon にログインして ASIN コードを取得
  - OTP による 2 段階認証に対応
  - ブクログへの自動登録（一括ではなく個別登録）
  - Twitter などへの自動投稿に対応
- 対象ユーザー: 開発者

## 共通ルール

- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載
  - 例: `feat: ユーザー認証機能を追加`
- 日本語と英数字の間には半角スペースを入れる。

## 技術スタック

- 言語: TypeScript
- ランタイム: Node.js v24.13.0
- パッケージマネージャー: pnpm v10.28.1
- ビルドツール: tsx
- 主要ライブラリ:
  - puppeteer-core: ブラウザ自動操作
  - axios: HTTP クライアント
  - csv-parse: CSV パース
  - otplib: OTP 生成

## コーディング規約

- ESLint: @book000/eslint-config を使用
- Prettier: `.prettierrc.yml` の設定に従う
  - printWidth: 80
  - tabWidth: 2
  - semi: false
  - singleQuote: true
- TypeScript:
  - strict モード有効
  - `skipLibCheck` での回避は禁止
- コメント: 日本語で記載
- エラーメッセージ: 英語で記載

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

## テスト方針

- テストフレームワーク: なし（テストコマンドが未定義）
- 新しいテストを追加する場合は、適切なテストフレームワークの導入を検討すること

## セキュリティ / 機密情報

- API キーや認証情報を Git にコミットしない。
- ログに個人情報や認証情報を出力しない。
- Cookie ファイルなどの機密情報は `.gitignore` で除外する。

## ドキュメント更新

以下のドキュメントを適宜更新すること:

- `README.md`: プロジェクトの概要、使用方法
- `CLAUDE.md`: Claude Code 向けの作業方針
- `AGENTS.md`: AI エージェント向けの基本方針
- `GEMINI.md`: Gemini CLI 向けのコンテキスト

## リポジトリ固有

- Docker / Docker Compose での動作を前提とする。
- Amazon と Booklog のログインには Puppeteer を使用する。
- Cookie ファイルによるセッション保持を実装している。
- エクスポートされた CSV ファイルから既存の蔵書を確認する。
- 登録履歴は JSON ファイルで管理する。
