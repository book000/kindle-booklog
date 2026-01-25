# AI エージェント作業方針

## 目的

このドキュメントは、AI エージェントがこのプロジェクトで作業する際の基本方針とルールを定義します。

## 基本方針

- **会話言語**: 日本語
- **コード内コメント**: 日本語
- **エラーメッセージ**: 英語
- **日本語と英数字の間**: 半角スペースを挿入する
- **コミット規約**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載する
  - 例: `feat: Discord 通知機能を追加`

## 判断記録のルール

すべての判断は、以下の形式で記録すること：

1. **判断内容の要約**: 何を決定したか
2. **検討した代替案**: どのような選択肢があったか
3. **採用しなかった案とその理由**: なぜその選択肢を選ばなかったか
4. **前提条件・仮定・不確実性**: 判断の基盤となる前提、仮定、不確実な要素

前提・仮定・不確実性を明示し、仮定を事実のように扱わないこと。

## 開発手順（概要）

1. **プロジェクトの理解**:
   - README.md を読んで、プロジェクトの目的と機能を理解する
   - package.json を読んで、技術スタックと開発コマンドを理解する

2. **依存関係のインストール**:

   ```bash
   pnpm install
   ```

3. **変更の実装**:
   - 既存のコーディング規約に従う
   - TypeScript の型チェックを通す
   - 関数・インターフェースに JSDoc を日本語で記載する

4. **テストと Lint / Format**:

   ```bash
   pnpm lint        # Lint チェック
   pnpm fix         # Format 自動修正
   ```

5. **コミット**:
   - Conventional Commits に従う
   - センシティブな情報を含まないことを確認する

## セキュリティ / 機密情報

- API キーや認証情報（Amazon のユーザー名・パスワード、ブクログのユーザー名・パスワード、Discord Webhook URL など）は設定ファイルで管理し、Git にコミットしない。
- ログに個人情報や認証情報を出力しない。
- OTP シークレットは環境変数または設定ファイルで管理し、Git にコミットしない。

## リポジトリ固有

### プロジェクト概要

- **目的**: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに自動登録する
- **主な機能**:
  - Amazon にログインして ASIN コードを取得
  - OTP による 2 段階認証に対応
  - ブクログへの自動登録
  - 登録済みアイテムのフィルタリング
  - Discord への通知

### 技術スタック

- **言語**: TypeScript
- **ランタイム**: Node.js
- **パッケージマネージャー**: pnpm
- **主要ライブラリ**: puppeteer-core, axios, csv-parse, otplib, @book000/node-utils

### 開発コマンド

```bash
# 依存関係のインストール
pnpm install

# 開発（ホットリロード）
pnpm dev

# 実行
pnpm start

# ビルド
pnpm compile

# Lint
pnpm lint              # prettier + eslint + tsc

# Format
pnpm fix               # prettier + eslint 自動修正
```

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

### 注意事項

- Puppeteer は `puppeteer-core` を使用しているため、実行環境に Chrome / Chromium がインストールされている必要がある。
- 設定ファイル（`data/config.json`）と Cookie ファイルは Git にコミットしない（`.gitignore` に追加済み）。
- Amazon / ブクログのログイン処理は、セレクタが変更される可能性があるため、定期的に動作確認を行う。
- ブクログのエクスポートは時間がかかる場合があるため、タイムアウトに注意する。
