# Prompt Architecture Rules (v2 Cockpit)

`companion-cockpit` および実装リポジトリ（`resilient-noether`）における AI プロンプトの設計・保守ルール。

---

## 1. システム原則とユーザー固有情報の厳格な分離（Principles vs User Data）
- **システム側（コードデフォルト値 / `prompt_core` / `prompt_schedule` / `prompt_db` / `prompt_deck`）**:
  - 普遍的な人間心理・生活動態、JSON 出力スキーマ、4プール / 7プレフィックス体系、引き算・時間境界の保護といった**再現可能な構造原則**のみを記述する。
  - **禁止事項**: 特定のユーザー習慣（「お湯張りと入浴を分ける」「土日祝17時お風呂」「洗濯は母親担当」「特定のソフト名・作品名・ゲーム名」等）をシステムプロンプトやコード内の例文・レポートひな形に直書きしてはならない。
- **ユーザー側（スプレッドシート `memory` シート）**:
  - `profile`, `lifestyle_habits`, `ideal_self`, `skill_options`, `dictionary`, `custom_system_prompt` にユーザー固有の嗜好・生活パターン・固有名詞・口調設定を保持する。
  - 運用中の生活変化はコード修正ではなく、スプレッドシートの `memory` 更新で吸収できる設計を保つ。

## 2. 「文脈を読める」AIの強みを信頼する（Trust Context Comprehension）
- AI（`gemini-3.5-flash-lite` / `gemini-3.8-flash`）が `profile` / `lifestyle_habits` / `calendar` / `todayLogs` / `tasks` を照合すれば自然に判断できる事柄まで、細かい `if-then` 手順書や過剰なエッジケース例を書かない。
- 例を増やすほど特定パターンへの過学習（他ケースでの視野狭窄）とトークン肥大を招く。短く本質的な「目的」と「判断軸」だけを渡す。

## 3. 応用のできない限定的なプロンプトを書かない（Generalizability First）
- 単一の会話不具合やカード提案ミスを塞ぐための対症療法（「〇〇と言われたら必ず△△するな」等）を禁止する。
- 新しいルールを足す前に、既存の原則の曖昧さやデータ（`memory` / コンテキスト）の欠損が原因でないか疑う。
- ルールは**「同じ文言で別の状況にも横展開できるか」**をテストしてから採用する。

## 4. 直交モジュール構成（v2 Modular Design）
v1 のチャット2段分類（`prompt_lite` / `prompt_phase_a..d` / `prompt_relief`）を廃止し、職能が直交する **4モジュール ＋ ユーザー上書き** に統一する：
- **`prompt_core`**: 伴走者としての憲章・トーン・安全弁（低負荷/睡眠配慮）・応答モード（スタンプ / 短文返信 / 相談回答）・オンデマンド情報取得要求（`need_web_search_query`, `need_calendar_range`）の原則。
- **`prompt_schedule`**: 今後の過ごし方や予定調整を求められた際の計画・引き算原則。
- **`prompt_db`**: 4プール（タスク/買物/インプット/ルーチン）・7プレフィックス・見込み時間差分更新・Google Docs プロジェクト連携・カレンダー操作のデータ契約。
- **`prompt_deck`**: Home 画面の `aiDeck`（`cards` / `lowCards`）および朝のブリーフィング生成における行動選定・引き算・重複回避原則。
- **`custom_system_prompt`**（任意）: ユーザー固有の振る舞い・対話スタイル上書き。

## 5. チャット 1段構成とオンデマンド 2段目（Single-Pass Default）
- `apiSendChat` は原則 **`gemini-3.5-flash-lite` の1回呼び出し**で意図理解・DB操作・返答/スタンプ・必要時の `aiDeck` 再編判断まで完結させる（`memory.backend_model` 指定時は追従）。
- Structured Output（JSON Schema）と `googleSearch` グラウンディングは API 仕様上分離し、AI が `need_web_search_query` または 2週間外の `need_calendar_range` を出力した場合のみ、外部情報を取得してオンデマンドで2段目を実行する。

## 6. プレフィックス・キャッシュ最適化（Prefix Cache Optimization）
システム命令および静的コンテキストを先頭から決定論的順序で配置し、可変コンテキストは必ず末尾に置く：
1. `[システムプロンプト]`: `prompt_core` (+ `prompt_schedule` + `prompt_db` または `prompt_deck`) + `custom_system_prompt`
2. `[準静的メモリー]`: `profile`, `lifestyle_habits`, `skill_options`, `ideal_self`, `project_folders`, `dictionary`
3. `[動的コンテキスト（末尾）]`: 天候・周期スタンプ・カレンダー・各種リスト・現在時刻・経過時間・境界情報・直近ログ・検索結果・ユーザー発話/画像
