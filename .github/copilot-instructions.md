# GitHub Copilot Instructions

## プロジェクト概要
- 目的: Amazon.co.jp で購入した Kindle 作品を取得して、[ブクログ](https://booklog.jp) に登録します。
- 主な機能: 購入メールからの情報取得をせずに、Amazon にログインして ASIN コードを取得します。（購入メールには ASIN コードが載らなくなりました） / Amazon ログイン時の OTP による2段階認証に対応しています。 / 一括登録を行わないため、Twitter などに自動投稿できます。

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
- PR タイトルとコミット本文の言語: PR タイトルは Conventional Commits 形式（英語推奨）。PR 本文は日本語。コミットは Conventional Commits 形式（description は日本語）。
- 日本語と英数字の間には半角スペースを入れる。
- 既存のプロジェクトルールがある場合はそれを優先する。

## 技術スタック
- 言語: JavaScript
- パッケージマネージャー: pnpm 優先（ロックファイルに従う）。

## コーディング規約
- フォーマット: 既存設定（ESLint / Prettier / formatter）に従う。
- 命名規則: 既存のコード規約に従う。
- Lint / Format: 既存の Lint / Format 設定に従う。
- コメント言語: 日本語
- エラーメッセージ: 英語
- TypeScript 使用時は strict 前提とし、`skipLibCheck` で回避しない。
- 関数やインターフェースには docstring（JSDoc など）を記載する。

## 開発コマンド
```bash
# 依存関係のインストール
pnpm install

# 開発 / テスト / Lint は README を確認してください
```

## テスト方針
- 新機能や修正には適切なテストを追加する。

## セキュリティ / 機密情報
- 認証情報やトークンはコミットしない。
- ログに機密情報を出力しない。

## ドキュメント更新

## リポジトリ固有