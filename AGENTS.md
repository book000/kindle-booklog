# AGENTS.md

## 目的

一般的な AI エージェント向けの基本方針を定義する。

## 基本方針

- 会話言語: 日本語
- コメント言語: 日本語
- エラーメッセージ言語: 英語
- コミット規約: Conventional Commits に従う
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載
  - 例: `feat: Amazon ログイン機能を追加`
- 日本語と英数字の間には半角スペースを挿入

## 判断記録のルール

判断を行う際は、以下を明示すること:

1. 判断内容の要約
2. 検討した代替案
3. 採用理由と採用しなかった案の理由
4. 前提条件・仮定・不確実性

仮定を事実のように扱わず、不確実性を明示すること。

## 開発手順（概要）

### 1. プロジェクト理解

- README.md とソースコードを確認
- プロジェクトの目的と主要機能を把握
- アーキテクチャとディレクトリ構造を理解

### 2. 依存関係インストール

```bash
pnpm install
```

### 3. 変更実装

- TypeScript strict モードに従う
- `skipLibCheck` での回避は禁止
- 関数・インターフェースに docstring（JSDoc）を日本語で記載
- 既存のコーディングスタイルに従う

### 4. テストと Lint/Format 実行

```bash
# Lint チェック
pnpm lint

# Lint 自動修正
pnpm fix

# TypeScript 型チェック
pnpm lint:tsc
```

### 5. コミットと PR

- Conventional Commits に従ったコミットメッセージ
- PR 本文は日本語で記載
- センシティブな情報が含まれていないことを確認

## セキュリティ / 機密情報

- API キーや認証情報を Git にコミットしない
- ログに個人情報や認証情報を出力しない
- Cookie ファイルなどの機密情報は `.gitignore` で除外する
- 環境変数を使用して設定を管理する

## リポジトリ固有

### プロジェクト概要

- 目的: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに登録する
- 技術スタック: TypeScript, Node.js v24.13.0, pnpm v10.28.1
- 実行環境: Docker / Docker Compose

### 主要機能

1. Amazon.co.jp へのログインと ASIN コード取得
2. OTP による 2 段階認証対応
3. Booklog へのログインと個別登録
4. Cookie によるセッション保持
5. CSV からの既存蔵書確認

### 注意事項

- 一括登録を行わない（Twitter などへの自動投稿を可能にするため）
- Puppeteer を使用したブラウザ自動操作を実装している
- 登録履歴は JSON ファイルで管理する
- 既存の Renovate PR には追加コミットしない
