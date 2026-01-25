# Claude Code 作業方針

## 目的

このドキュメントは、Claude Code がこのプロジェクトで作業する際の方針とプロジェクト固有のルールを定義します。

## 判断記録のルール

すべての判断は、以下の形式で記録すること：

1. **判断内容の要約**: 何を決定したか
2. **検討した代替案**: どのような選択肢があったか
3. **採用しなかった案とその理由**: なぜその選択肢を選ばなかったか
4. **前提条件・仮定・不確実性**: 判断の基盤となる前提、仮定、不確実な要素
5. **他エージェントによるレビュー可否**: 他のエージェント（Codex CLI、Gemini CLI）によるレビューが必要か

前提・仮定・不確実性を明示し、仮定を事実のように扱わないこと。

## プロジェクト概要

- **目的**: Amazon.co.jp で購入した Kindle 作品を取得して、ブクログに自動登録する
- **主な機能**:
  - Amazon にログインして ASIN コードを取得
  - OTP による 2 段階認証に対応
  - ブクログへの自動登録
  - 登録済みアイテムのフィルタリング
  - Discord への通知

## 重要ルール

- **会話言語**: 日本語
- **コミット規約**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う
  - 形式: `<type>(<scope>): <description>`
  - `<description>` は日本語で記載
  - 例: `feat: Discord 通知機能を追加`
- **コード内コメント**: 日本語
- **エラーメッセージ**: 英語

## 環境のルール

- **ブランチ命名**: [Conventional Branch](https://conventional-branch.github.io) に従う
  - 形式: `<type>/<description>`
  - `<type>` は短縮形（feat, fix）を使用
  - 例: `feat/add-discord-notification`
- **GitHub リポジトリ調査**: テンポラリディレクトリに git clone して調査する
- **実行環境**: Linux（Docker / Docker Compose）
- **Renovate PR**: Renovate が作成した既存の PR に対して追加コミットや更新を行わない

## コード改修時のルール

- **日本語と英数字の間**: 半角スペースを挿入する
- **既存のエラーメッセージ**: 先頭に絵文字がある場合は、全体で統一する
- **TypeScript**: `skipLibCheck` での回避は絶対にしない
- **ドキュメント**: 関数・インターフェースに JSDoc を日本語で記載・更新する

## 相談ルール

他エージェントに相談することができる。以下の観点で使い分ける：

### Codex CLI (ask-codex)

- 実装コードに対するソースコードレビュー
- 関数設計、モジュール内部の実装方針などの局所的な技術判断
- アーキテクチャ、モジュール間契約、パフォーマンス／セキュリティといった全体影響の判断
- 実装の正当性確認、機械的ミスの検出、既存コードとの整合性確認

### Gemini CLI (ask-gemini)

- Puppeteer の最新仕様や機能
- Amazon / ブクログの最新仕様変更
- Node.js / TypeScript の最新仕様
- 外部一次情報の確認、最新仕様の調査、外部前提条件の検証

### 指摘への対応

他エージェントが指摘・異議を提示した場合、以下のいずれかを行う。黙殺・無言での不採用は禁止する。

- 指摘を受け入れ、判断を修正する
- 指摘を退け、その理由を明示する

以下は必ず実施する：

- 他エージェントの提案を鵜呑みにせず、その根拠や理由を理解する
- 自身の分析結果と他エージェントの意見が異なる場合は、双方の視点を比較検討する
- 最終的な判断は、両者の意見を総合的に評価した上で、自身で下す

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

# Docker Compose
docker compose up -d          # バックグラウンド実行
docker compose logs -f        # ログ表示
docker compose down           # 停止
```

## アーキテクチャと主要ファイル

### アーキテクチャサマリー

このプロジェクトは、以下のコンポーネントで構成される：

1. **src/main.ts**: エントリーポイント
   - 設定ファイルの読み込み
   - Puppeteer ブラウザの起動
   - Amazon / ブクログのログイン処理
   - Kindle 作品の取得
   - ブクログへの登録
   - Discord 通知

2. **src/amazon.ts**: Amazon 関連処理
   - Amazon.co.jp へのログイン（OTP 対応）
   - `read.amazon.co.jp` から Kindle 作品の ASIN コード取得
   - Cookie の保存・読み込み

3. **src/booklog.ts**: ブクログ関連処理
   - ブクログへのログイン
   - エクスポートページから蔵書データの CSV ダウンロード
   - 本棚への登録

4. **src/booklog-update-book.ts**: ブクログの本の更新
   - タグの追加・更新
   - その他のメタデータ更新

5. **src/proxy-auth.ts**: プロキシ認証処理
   - Puppeteer のプロキシ認証設定

6. **src/models/**: データモデル
   - Kindle 作品のレスポンス型定義
   - ブクログの本の型定義

### 主要ディレクトリ

```
.
├── src/
│   ├── main.ts                         # エントリーポイント
│   ├── amazon.ts                       # Amazon ログイン・ASIN 取得
│   ├── booklog.ts                      # ブクログログイン・登録
│   ├── booklog-update-book.ts          # ブクログの本の更新
│   ├── proxy-auth.ts                   # プロキシ認証
│   └── models/                         # データモデル
│       ├── kindle-search-response.ts   # Kindle レスポンス型
│       └── kindle-render-metadata.ts   # Kindle メタデータ型
├── data/                               # 実行時データ（Git 管理外）
│   ├── config.json                     # 設定ファイル
│   ├── cookies-amazon.json             # Amazon Cookie
│   ├── cookies-booklog.json            # ブクログ Cookie
│   └── added-asins.json                # 登録済み ASIN 一覧
├── Dockerfile                          # Docker イメージ定義
├── compose.yaml                        # Docker Compose 設定
├── compose-all-update.yaml             # 全件更新用 Docker Compose 設定
├── entrypoint.sh                       # コンテナ起動スクリプト
├── tsconfig.json                       # TypeScript 設定
├── eslint.config.mjs                   # ESLint 設定
└── .prettierrc.yml                     # Prettier 設定
```

## 実装パターン

### 推奨パターン

#### Puppeteer を使用したログイン処理

```typescript
// ログインページに移動
await page.goto('https://example.com/login')

// フォームに入力
await page.type('#username', username)
await page.type('#password', password)

// ログインボタンをクリック
await page.click('#login-button')

// ログイン完了を待機
await page.waitForNavigation()
```

#### Cookie の保存・読み込み

```typescript
// Cookie の保存
const cookies = await page.cookies()
fs.writeFileSync('cookies.json', JSON.stringify(cookies))

// Cookie の読み込み
const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'))
await page.setCookie(...cookies)
```

#### OTP による 2 段階認証

```typescript
import { TOTP } from 'otplib'

// OTP コードを生成
const totp = new TOTP()
const otpCode = await totp.generate({
  secret: otpSecret.replaceAll(' ', ''),
})

// OTP フォームに入力
await page.type('#otp-code', otpCode)
```

#### エラーハンドリング

```typescript
try {
  await someAsyncOperation()
} catch (error) {
  logger.error('Failed to perform operation', error)
  throw error
}
```

### 非推奨パターン

- **ハードコーディング**: セレクタや URL は定数として定義する
- **sleep による待機**: `page.waitForSelector()` などの適切な待機メソッドを使用する
- **エラーハンドリングの省略**: すべての非同期処理にエラーハンドリングを追加する
- **ログの不足**: 重要な処理にはログを出力する

## テスト

### テスト方針

- テストフレームワークは現在未導入。
- 動作確認は Docker Compose で実際に実行して行う。
- Amazon / ブクログのセレクタが変更された場合は、手動で確認する。

### 追加テスト条件

変更を加えた場合、以下を確認する：

1. TypeScript の型チェックが通ること（`pnpm lint:tsc`）
2. ESLint エラーがないこと（`pnpm lint:eslint`）
3. Prettier フォーマットが適用されていること（`pnpm lint:prettier`）
4. Amazon へのログインが正常に動作すること
5. ブクログへのログインが正常に動作すること
6. Kindle 作品の ASIN コードが正しく取得されること
7. ブクログへの登録が正常に動作すること
8. Discord 通知が正常に送信されること

## ドキュメント更新ルール

### 更新対象

以下のファイルを変更した場合は、関連ドキュメントを更新する：

- **README.md**: プロジェクト概要、使用方法、処理フローの変更時
- **Dockerfile / compose.yaml**: Docker 構成の変更時
- **.github/copilot-instructions.md**: 技術スタック、開発コマンドの変更時
- **CLAUDE.md**: アーキテクチャ、実装パターンの変更時

### 更新タイミング

- 技術スタックの変更時
- 開発コマンドの変更時
- プロジェクト要件の変更時
- 品質チェックで問題検出時

## 作業チェックリスト

### 新規改修時

1. プロジェクトを理解する
2. 作業ブランチが適切であることを確認する
3. 最新のリモートブランチに基づいた新規ブランチであることを確認する
4. PR がクローズされた不要ブランチが削除済みであることを確認する
5. `pnpm install` で依存関係をインストールする

### コミット・プッシュ前

1. Conventional Commits に従っていることを確認する
2. センシティブな情報が含まれていないことを確認する
3. Lint / Format エラーがないことを確認する（`pnpm lint`）
4. 動作確認を行う

### PR 作成前

1. PR 作成の依頼があることを確認する
2. センシティブな情報が含まれていないことを確認する
3. コンフリクトの恐れがないことを確認する

### PR 作成後

1. コンフリクトがないことを確認する
2. PR 本文が最新状態のみを網羅していることを確認する
3. `gh pr checks <PR ID> --watch` で CI を確認する
4. Copilot レビューに対応し、コメントに返信する
5. Codex のコードレビューを実施し、信頼度スコアが 50 以上の指摘対応を行う
6. PR 本文の崩れがないことを確認する

## リポジトリ固有

### 処理フロー

1. Amazon.co.jp にログイン（Cookie ファイルがあればそれを使用）
2. `read.amazon.co.jp` から Kindle 作品の ASIN コードを取得
3. ブクログにログイン（Cookie ファイルがあればそれを使用）
4. ブクログのエクスポートページから蔵書データを CSV としてエクスポート
5. ASIN コードを元に既に登録されているかを確認・フィルタリング
6. 新しく購入された Kindle 本をブクログに登録
7. Discord に通知

### 設定ファイル

- `data/config.json`: 実行時の設定
  - `amazon`: Amazon のユーザー名、パスワード、OTP シークレット
  - `booklog`: ブクログのユーザー名、パスワード
  - `discord`: Discord Webhook URL
  - `proxy`: プロキシ設定（オプション）
  - `puppeteer`: Puppeteer 設定（オプション）

### Cookie ファイル

- `data/cookies-amazon.json`: Amazon の Cookie
- `data/cookies-booklog.json`: ブクログの Cookie

これらのファイルがあれば、ログインをスキップして Cookie を使用する。

### 登録済み ASIN ファイル

- `data/added-asins.json`: 本アプリケーションで一度でも登録した ASIN コードの一覧

このファイルを使用して、既に登録済みのアイテムを除外する。

### Docker

- Docker Compose で実行する。
- `compose.yaml`: 通常実行用
- `compose-all-update.yaml`: 全件更新用（`UPDATE_ALL_BOOKS=true`）
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
- OTP シークレットは環境変数または設定ファイルで管理し、Git にコミットしない。
- Discord Webhook URL は環境変数または設定ファイルで管理し、Git にコミットしない。
