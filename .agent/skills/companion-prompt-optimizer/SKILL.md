---
name: companion-prompt-optimizer
description: Audits and refactors v2 companion prompts (prompt_core, prompt_schedule, prompt_db, prompt_deck) against prompt-architecture rules, GRAND_DESIGN, and prefix cache structure.
---

# Companion Prompt Optimizer (v2)

AI 伴走コックピット（`companion-cockpit` / `resilient-noether`）のプロンプト（`prompt_core`, `prompt_schedule`, `prompt_db`, `prompt_deck` およびレポート系プロンプト）を設計・編集・監査する際の標準スキル。

## いつ使うか
- プロンプトの文言を追加・削減・整理したいとき
- 特定の行動提案やチャット応答のズレを根本原則から是正したいとき
- システム原則とユーザー固有情報（スプレッドシート `memory`）の境界を点検したいとき

## 3レイヤー自己監査チェックリスト（必須）

プロンプトを編集・提案する前後に、必ず以下の全項目を確認する：

### Layer 1: グランドデザイン ＆ 責務分離監査
- [ ] **時間境界・引き算の保護**: 無茶な詰め込みや就寝・境界時刻侵害を防ぐ原則になっているか。
- [ ] **固有情報の排除**: コード内デフォルト値や 4つの基本プロンプト（`prompt_core`, `prompt_schedule`, `prompt_db`, `prompt_deck`）に、特定ユーザーだけの習慣名・ソフト名・固有名詞・時間帯決め打ち（例: お湯張り工程、土日祝17時風呂、特定作品名）が混入していないか。
- [ ] **文脈信頼**: `lifestyle_habits` や `profile` や `calendar` を読めばAIが推論できることを、冗長な禁止・強制文で二重縛りしていないか。

### Layer 2: 対症療法排除 ＆ 直交性監査
- [ ] **単発パッチの不在**: 特定の発話・場面だけを狙い撃ちした限定ルールがないか。
- [ ] **モジュール直交性**:
  - `prompt_core` に DB スキーマ詳細やデッキ枚数ルールが漏れていないか。
  - `prompt_db` にトーンや雑談反応ルールが重複していないか。
  - `prompt_deck` にシステム側アンカー（「すでに渡されたシステム管理済みカード」リスト等）と重複する静的列挙が書かれていないか。
- [ ] **文字数・密度の健全性**: 不要な言い換えや重複禁止事項が削られ、必要十分な密度に保たれているか。

### Layer 3: 技術・キャッシュ構造監査
- [ ] **Prefix Cache 順序**: `CompanionChat.js` / `DeckEngine.js` のペイロード組み立てで、静的プロンプト＆準静的 `memory` が先頭、動的データ（時刻・天気・タスク・ログ・検索結果・ユーザー発話）が末尾に配置されているか。
- [ ] **旧仕様の残骸ゼロ**: `prompt_lite` / `prompt_phase_a..d` / `prompt_relief` / `callGeminiLite` / `determineActionPhase` への参照が残っていないか。
- [ ] **スプレッドシート同期の明示**: デフォルトプロンプト変更後、必要なら `scripts/sync-prompts-to-sheet.js`（検証環境 `--test` 等）や `SPEC.md` / `README.md` との同期状態を確認しているか。

## 作業手順
1. `.agent/rules/prompt-architecture.md` と `GRAND_DESIGN.md` に照らして、問題が「システム原則の不足」か「`memory` データの不足」かを切り分ける。
2. `memory`（`lifestyle_habits` 等）で表現すべき事項ならプロンプトには追記せず、`memory` 側の記述を提案する。
3. システム原則を更新する場合は、既存ルールを削って統合できないか先に検討し、簡潔な原則として記述する。
4. 変更後、`npm run check` / `npm run build:dashboard` / ユニット検証を実行し、ドキュメント（`SPEC.md` / `README.md`）を同期する。
