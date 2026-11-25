---
name: memory-validator
description: memory シートおよび D1 memory テーブルの全キーの型・許容値・フォーマットを検証し、プロンプト行ズレや不正値混入を検知・防止するスキル。シート更新前後やエラー診断時に使用する。
---

# Memory Sheet / D1 Table Validator

`memory` シート（Google Sheets）および D1 `memory` テーブルの値を検証し、不正値（特に複数行プロンプトの貼り付けズレによる設定値破壊）を検知・防止するためのリファレンスおよび検証手順。

## 1. キー別入力規則（Schema & Validation Rules）

### 制御・設定系キー（厳格バリデーション対象）
| キー | 型 / 許容値 | 備考・異常検知の目安 |
|---|---|---|
| `thinking_level` | `minimal` \| `low` \| `medium` \| `high` | 400エラー直結。これ以外の文字列・改行・記号を含む場合は即NG |
| `backend_model` | `3.5-lite` \| `3.8-flash` \| `gemini-3.5-flash-lite` \| `gemini-3.8-flash` \| `gemini-4-hydrogen` | モデルIDまたは短縮名のみ。文章やプロンプト断片が入っていたらNG |
| `system_mode` | `NEW` \| `OLD` | 3文字の英大文字のみ |
| `D1_INITIALIZED` | `TRUE` \| `FALSE` | 真偽値文字列のみ |
| `monthly_report_ready` | `TRUE` \| `FALSE` | 真偽値文字列のみ |
| `pressure_alert` | `TRUE` \| `FALSE` | 真偽値文字列のみ |
| `briefing_delivered_date` | `YYYY-MM-DD` | 10文字の日付形式（正規表現 `^\d{4}-\d{2}-\d{2}$`） |

### JSON 構造系キー
| キー | 検証ルール |
|---|---|
| `V2_FAST_STATE` | `JSON.parse()` が成功し、`dayKey`・`revision` を持つオブジェクトであること |
| `project_root_ids` | `JSON.parse()` が成功するオブジェクトであること |

### プロンプト・コンテキスト系キー（行ズレ検知）
- `prompt_core`, `prompt_db`, `prompt_deck`, `prompt_lite`, `prompt_schedule`, `prompt_relief`, `prompt_phase_a` 〜 `prompt_phase_d`, `custom_system_prompt`
- `profile`, `ideal_self`, `lifestyle_habits`, `dictionary`, `rolling_memory`, `weekly_summary`, `skill_options`, `cycle_stamps`, `project_folders`, `weather_info`
- **検証ポイント**:
  - 先頭が箇条書きの途中（例: `- \`shopping_actions\`: ...` や `- \`task_actions\`: ...`）だけで終わっていないか（複数行コピー時の行ズレ兆候）。
  - 設定系キー（`thinking_level`, `backend_model` 等）にこれらのプロンプト断片が紛れ込んでいないか。

## 2. 検証手順（D1 リモート確認）

```bash
workers/node_modules/.bin/wrangler d1 execute companion-db --remote \
  --command "SELECT key, length(value) as len, substr(value, 1, 60) as preview, updated_at FROM memory ORDER BY key;" \
  --config workers/wrangler.toml
```

## 3. 異常検知時の修復方針
1. D1 側で該当キーを正しい値へ `UPDATE` する。
2. **必ずスプレッドシート側の `memory` シートも同時に確認・修正する**（深夜バッチや手動同期で D1 が再び古いシート値で上書きされるのを防ぐため）。
