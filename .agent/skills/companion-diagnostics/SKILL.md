---
name: companion-diagnostics
description: エラー報告・不具合・改善要望への対応時に、現在の実状況（スプレッドシートのログ・プロンプト・高速ステート、Notionの日報・月報）を正確に把握するために使用する診断スキル。
---

# Companion Diagnostics（実状況把握・診断スキル）

エラーや不具合の報告、改善要望、動作確認を受けた際は、推測でコードを読んだり手当たり次第にファイルを検索したりせず、**最初に本スキルに従って正本データから実状況を把握**する。

---

## 1. 正本データの所在とアクセス手段

### A. Cloudflare D1 データベース ＆ Workers ログ（現在のリアルタイム正本）
現在のリアルタイム API・データ正本は **Cloudflare Workers + D1 (`workers/`)** です。不具合調査時はまず `workers/src/` と D1 の実データ・Workers ログを確認してください。

```bash
# 1. D1 の主要テーブル件数・状態を確認
cd workers && npx wrangler d1 execute companion-db --remote --command="SELECT (SELECT COUNT(*) FROM tasks) as tasks, (SELECT COUNT(*) FROM shopping) as shopping, (SELECT COUNT(*) FROM logs) as logs, (SELECT COUNT(*) FROM mirror_queue) as mirror_err;"

# 2. D1 の fast_state や直近ログ・タスクを確認
cd workers && npx wrangler d1 execute companion-db --remote --command="SELECT day_key, revision, updated_at FROM fast_state WHERE id=1;"

# 3. Workers のリアルタイム実行ログ・エラーを監視
cd workers && npx wrangler tail
```

### B. 会話ログ・プロンプト・高速ステート・タスク（Google スプレッドシート：確認用ミラー ＆ 03:00バッチ用）
スプレッドシート（`logs`, `memory`, `tasks` 等）は D1 からの非同期ミラー先および深夜 `03:00` バッチ（`src/Batch.js`）の参照元です。
**必ず `scripts/sheet-cli.js` を経由して読み取る**こと（`gsheets` で Drive 全体を検索したり、`.env` / `service-account.json` 等の機密ファイルを直接読み込んだりしない — `AGENTS.md` 第9条）。

```bash
# 1. 直近の会話ログ・AI応答・実行フェーズ・トークン消費を確認
node scripts/sheet-cli.js get-logs 10
node scripts/sheet-cli.js get-logs 20 "キーワード"

# 2. 高速ステート（completedToday, dismissedToday, activeSession, aiDeck 等）を確認
node scripts/sheet-cli.js get-memory V2_FAST_STATE

# 3. スプレッドシート上の実プロンプト設定値を確認（コードデフォルトとの乖離・破損検知）
node scripts/sheet-cli.js get-prompt
node scripts/sheet-cli.js get-prompt prompt_deck

# 4. タスク一覧を確認
node scripts/sheet-cli.js get-tasks
```

### C. 日報・月報・長期記憶（Notion）
正本は Notion データベース（日報 DB / 月報 DB）。
日報・月報の生成結果（`summary`、トーン、出来事の記録状況等）や長期記憶を確認する場合は、**Notion MCP ツール（`notion_notion` または `notion-mcp-server`）** を使用して検索・取得する。

- まず `notion-search`（または `API-post-search`）で対象の日付・タイトル（例: `2026-11-23` や月報タイトル）を検索する。
- 該当ページを `notion-fetch`（または `API-retrieve-a-page` / `API-get-block-children`）で取得し、プロパティと本文を確認する。

---

## 2. 診断フロー（Root-Cause First）

1. **一次データの取得**:
   - 上記 A（D1）・B（スプレッドシート）および必要に応じて C（Notion）から、事象発生前後の生データを取得する。
2. **コード・プロンプトとの照合**:
   - 取得した生データ（`V2_FAST_STATE` の状態、ログのフェーズ、D1/スプレッドシート上の実データ・プロンプト）と、リポジトリ内の実装（`workers/`・`web/`・`src/`）を照合する。
3. **3点診断の整理とプラン提示**:
   - `.agent/rules/root-cause-first.md` に従い、**構造的根本原因・横展開テスト・逆方向遷移/副作用の検証**を整理した上で、ユーザーへ修正プランを提示して承認を得る。
