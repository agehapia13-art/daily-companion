# Companion Cockpit / Daily Companion v2 (PWA × Cloudflare Workers/D1 × GAS × Gemini × Notion)

サウンドディレクター専属の生活伴走コックピットシステムです。  
**「状況の鏡 × 行動の触媒（Home）」**・**「傾聴・整理・相談（Chat）」**・**「一覧・即実行（Lists）」** の 3タブ構成 PWA と、**Cloudflare Workers + D1（リアルタイム API・DB 正本）**・Google Apps Script (GAS：深夜03:00 Notionバッチ＆フォールバック)・Gemini（`gemini-3.5-flash-lite` / `gemini-3.8-flash`）・Googleスプレッドシート（確認用非同期ミラー）・Googleカレンダー・Google Drive/Docs・Notion API・Open-Meteo を統合しています。

> 🧭 **最高憲章**: 設計・実装原則はリポジトリ内の [GRAND_DESIGN.md](GRAND_DESIGN.md)・[SPEC.md](SPEC.md)・[AGENTS.md](AGENTS.md)・[.agent/rules/prompt-architecture.md](.agent/rules/prompt-architecture.md) に準拠します。

---

## 📚 ドキュメント・設計資産
- [GRAND_DESIGN.md](GRAND_DESIGN.md) — 最上位憲章（思想定義）
- [SPEC.md](SPEC.md) — Daily Companion v2 設計仕様書（二層State・コード/AI境界・03:00/05:00/17:00バッチ・7 API・Chat 1段構成・PWA UI/UX）
- [AGENTS.md](AGENTS.md) — AIエージェント行動憲章 ＆ 思考原則
- [.agent/rules/prompt-architecture.md](.agent/rules/prompt-architecture.md) — プロンプト設計・分離原則・Prefix Cache ルール
- [.agent/skills/companion-prompt-optimizer/SKILL.md](.agent/skills/companion-prompt-optimizer/SKILL.md) — プロンプト監査・最適化スキル
- [.agent/skills/mobile-ui-mock/SKILL.md](.agent/skills/mobile-ui-mock/SKILL.md) — スマホ実機確認用 UI モック生成スキル
- [.agent/skills/companion-diagnostics/SKILL.md](.agent/skills/companion-diagnostics/SKILL.md) — 実状況把握・診断スキル（スプレッドシートのログ・プロンプト・高速ステート、Notion の日報・月報確認手順）

---

## 🌟 v2 アーキテクチャと主要機能

### 1. 3タブ PWA UI/UX（Sheer Frosted Glass × Fluid Mist）
`docs/index.html`（`scripts/build-dashboard.js` が `web/` から生成）は **GitHub Pages + Service Worker (`sw.js`) + iOS Safe Area (`viewport-fit=cover` / `black-translucent`)** 対応のスタンドアロン PWA として動作します。

- **Home（状況の鏡 × 行動の触媒）**:
  - **ヘッダ**: OS 時計と重複する現在時刻表示を省き、天気・気圧サマリー（`weatherLine`）と次の予定／就寝境界カウントダウン（`HH:MM:SS`）、前回完了行動からの経過時間 $\Delta t$（`deltaText`）を表示。
  - **朝のブリーフィングカード**: 03:00 境界生成・05:00 天気最新化。`×` または行動開始時に自動クローズ。
  - **3枚行動デッキ（双方向ページネーション＆末尾生成カード）**: コード側で生成を保証する生活・勤務アンカー（朝の身支度ステップ、平日勤務ブロック `10:00〜19:00`、平日・休日共通の `11:30〜` 昼食、17時以降の夕食・入浴、日跨ぎ保護付き `就寝` カード）と、AI（`DeckEngine.js`）の提案を統合表示。引き算カード最優先・時間帯到来済みの未完了アンカーを上位保証した上で AI 提案を配置し、左スワイプで「今日は提案しない」（`apiDismissCardToday`）、カード・チャット経由を問わず完了済みタスク／インプットに紐づくカード（`linkedId`）は自動除外。有効カードの末尾に「別の候補を生成する」カードを1枚結合して3枚ずつページ表示し、ページャーで前後のページを自由に行き来できる。
  - **サブアクション**:
    - `自分で始める`: タイトル入力 ＋ **非線形スライダー（`5分 / 10分 / 15分 / 30分 / 45分 / 1時間 / 1時間30分 / 2時間 / 2時間30分 / 3時間 / 4時間 / 6時間`、初期値 `30分`）**。
    - `少しだるい / 通常に戻す`: AI が時間帯・状況に合わせて事前生成済みの低負荷候補 `aiDeck.lowCards`（3〜5件）へ待ち時間 0ms で切替。
  - **進行中 Focus ＆ Reflection**: クリスタルダイヤル（`startedAtMs` 実時刻ベース・`60分` 経過時ソフト通知）、かけ忘れ・止め忘れ補正用のオンデマンド時刻直接入力（開始時刻調整／完了後の開始・終了時刻調整と実績時間 `usedMins` サーバー同期、キャンセル/適用付き）、完了後の任意気分チップ・JPEG圧縮写真添付・感想入力（オートフォーカスなし）。
  - **引き算カード（`isTriage`）**: 過密・低気圧・疲労サイン時に先頭配置し、1タップで重タスクを翌日へ一括リスケ。
  - **設定・診断モーダル**: 接続先 URL・認証キー・外観テーマ設定（`オート` / `ライト` / `ダーク` の3状態切替・OS追従）に加え、診断ログコピー・未同期アウトボックス破棄・スプレッドシートから D1 への手動取り込み（`apiImportFromSheets`、仮テーブル方式で安全置換）に対応。
- **Chat（傾聴・整理・DB操作・Web検索相談）**:
  - 論理日当日（03:00〜翌02:59）のログを復元。写真送信（JPEG圧縮 → Drive保存）、インライン変数ピル挿入（Lists タブ連携）、Google Docs/Drive リンクカード、エラー時の再試行・入力復元を完備。Workers API URL 設定時は `POST /chat/stream` による SSE ストリーミング受信（ステータス表示・リアルタイム描画）に対応。
  - **スタンプ反応 vs テキスト返信（役割分離）**: DB操作・所要時間変更・相談・調べ物時は `reply_mode: "reply"`＋実行バッジ（`.quiet-badge`）、日常のつぶやき・振り返りはユーザー吹き出し下へ絵文字スタンプ反応（`.reaction-chip`）を中心に控えめに応答。
- **Lists（一覧・即実行・変数挿入）**:
  - `Tasks`（7大生活プリフィックス絞込・期限表示・見込み時間調整・`docUrl` 資料ボタン・`memo` 吹き出し確認）・`Shopping`（カテゴリ表示）・`Stock`（見込み時間表示/調整・`memo` 吹き出し確認）・`Habits`（`cycle_stamps` 経過日数順・見込み時間表示/調整）。スナップショット契約は `workers/src/types.ts`（`dueDate`, `estimatedMins`, `label`, `category`）に統一。
  - カードタップで下部共有入力欄へ変数ピル挿入、`▶` ボタンで Home タイマー即開始、`Shopping` のみ `✓` で即時購入済切替。

### 2. 二層高速ステート ＆ 役割分離（Code vs AI）
- **二層ステート（`FastState.js`）**:
  - Layer 1（`PropertiesService` キー `V2_FAST_STATE`）とブラウザ `localStorage` (`cc_v2_snapshot`) により 0ms 起動・高速同期。スプレッドシート `memory.V2_FAST_STATE` へミラー保存し復旧性を担保。
  - **論理日境界（03:00 JST）**: `03:00〜翌02:59` を1日とし、日跨ぎの `isSleepCard` 進行中セッションは 03:00 リセット時も消去せず保護。
- **定時トリガー（3本：`03:00` / `05:00` / `17:00`）**:
  1. `03:00` **`dailyMidnightBatch`**: 前日 `03:00〜02:59` の Notion 日報投稿、中長期メモリー代謝、ルーティンタスク自動投入、毎月1日の月報作成、Drive プロジェクト台帳同期、30日ローリング整理、**v2 論理日リセット・朝ブリーフィング・初期 `aiDeck` 生成（`gemini-3.8-flash`）**。
  2. `05:00` **`morningWeatherBatch`（Workers Cron）**: Open-Meteo 天気・気圧急降下取得＆ブリーフィング天気表示最新化（失敗ミラー `mirror_queue` の再送ドレイン・D1 容量 400MB アラート含む）。
  3. `17:00` **`eveningDeckBatch`（Workers Cron）**: 退勤〜夜間帯へ向けた `aiDeck` 先読み再編成（`03:00` GAS バッチの結果は `/internal/sync-memory` 経由で D1 へ自動同期、失敗ミラー `mirror_queue` の再送ドレイン含む）。
- **動的更新**:
  - 天気は最終取得から **3時間以上経過後の初回起動時**（および取得エラー・出社日の渋谷欠損時）に再取得。
  - `aiDeck` は行動開始時（業務ブロック・就寝を除く）、末尾「別の候補を生成する」カードタップ時、Chat での DB/低負荷状態変化時に再編成・追記。

---

## 📁 ディレクトリ構成

```
.
├── .agent/
│   ├── rules/
│   │   └── prompt-architecture.md                  # プロンプト設計・分離原則・Prefix Cache ルール
│   └── skills/
│       └── companion-prompt-optimizer/SKILL.md     # プロンプト監査・最適化スキル
├── .clasp.json               # clasp設定 (rootDir: "src", Git管理対象外)
├── .gitignore                # 秘匿ファイル保護 (.env / .clasp.json / service-account.json 等)
├── AGENTS.md                 # AIエージェント行動憲章・作業手順ルール
├── GRAND_DESIGN.md           # 最上位憲章（思想定義）
├── SPEC.md                   # Daily Companion v2 設計仕様書
├── appsscript.json           # ルート参照用マニフェスト（clasp push 対象は src/appsscript.json）
├── package.json              # npm run check / build:dashboard / push
├── package-lock.json
├── service-account.json      # Google Cloud サービスアカウント秘密鍵 (Git管理対象外)
├── web/                      # PWA フロントエンドソース (build-dashboard.js の入力元)
│   ├── index.html            # HTML シェル・モーダル・ブート設定アンカー
│   ├── styles.css            # Fluid Mist & Glassmorphism スタイル定義
│   └── js/                   # state-api / mist-theme / home-view / chat-lists-view
├── docs/                     # GitHub Pages PWA 出力先 (build-dashboard.js が自動生成)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── icon.svg
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── .nojekyll
├── src/                      # GAS ソースコード (clasp push 対象)
│   ├── appsscript.json       # Asia/Tokyo / V8 / Web App 実行権限設定
│   ├── Config.js             # 環境変数検証・認証キー・テストDB切替・定数
│   ├── Prompts.js            # v2 デフォルト4プロンプト (Core/Schedule/Db/Deck) ＆ CHAT_RESPONSE_SCHEMA
│   ├── Api.js                # doGet / doPost ＆ 7つのPWA APIエンドポイント
│   ├── FastState.js          # 二層ステート・03:00境界・アンカーカード・デッキ合成
│   ├── DeckEngine.js         # aiDeck (cards + lowCards) 構造化生成・天気ブリーフィング更新
│   ├── Media.js              # Base64 JPEGデコード・Google Drive 画像保存
│   ├── GeminiClient.js       # Gemini REST 通信・リトライ・モデル解決・JSON救済パース
│   ├── CompanionChat.js      # Chat 1段構成＋オンデマンド Web検索/広域カレンダー・Prefix Cache最適化
│   ├── ReportGenerator.js    # 深夜バッチ向け Notion 日報・月報生成 ＆ 中長期記憶代謝
│   ├── Spreadsheet.js        # logs / tasks / routines / shopping / input_stock 操作・日次ウィンドウ集計
│   ├── MemoryStore.js        # memory シート CRUD・安全更新ガード・AIコンテキスト整形
│   ├── Calendar.js           # 勤務モード判定 (commute/remote/holiday)・境界ターゲット算出・カレンダー操作
│   ├── Weather.js            # Open-Meteo 天気・気圧急降下検知・Home 1行整形
│   ├── DriveProject.js       # Google Drive 7大領域プロジェクトフォルダ・Google Docs 連携
│   ├── Notion.js             # Notion 日報・月報 DB 投稿
│   ├── Batch.js              # dailyMidnightBatch (03:00) / morningWeatherBatch (05:00) / eveningDeckBatch (17:00)
│   ├── Dashboard.js          # GAS HTML Service レンダラ (DashboardHtml.html を配信)
│   ├── DashboardHtml.html    # build-dashboard.js が web/ から生成する GAS 配信用バンドルHTML
│   ├── Setup.js              # 初期設定・3トリガー登録・プロンプト同期・月報再作成
│   └── Tests.js              # 手動実行テスト・ドライランシナリオ・モデル疎通確認スイート
├── workers/                  # Cloudflare Workers + D1 高速バックエンド (TypeScript)
│   ├── schema.sql            # D1 (SQLite) スキーマ定義
│   ├── wrangler.toml         # Workers / D1 / KV バインディング設定
│   └── src/                  # index / api-core / chat (SSE) / db / calendar / weather / media / deck-engine / sheets-mirror / sheets-import
├── scripts/
│   ├── build-dashboard.js       # web/ → src/DashboardHtml.html & docs/ ビルド ＆ 構文検証
│   ├── migrate-task-prefixes.js # 未完了タスク7大プリフィックス移行ツール
│   ├── sheet-cli.js             # スプレッドシート CLI 読み書きツール (--test 対応)
│   ├── sync-prompts-to-sheet.js # src/Prompts.js のプロンプトを memory へ同期
│   ├── verify-prompts-live.js   # v2 プロンプト実機応答 ＆ --dry-run 検証ランナー
│   └── mock-server.js           # ローカルPWA/APIモックサーバー ＆ E2E自動検証 (--mock-gemini / 実Gemini対応)
└── README.md
```

---

## 🌐 v2 PWA API エンドポイント（`src/Api.js`）

`doPost`（CORS `Content-Type: text/plain;charset=utf-8` JSON `{ apiAction, args }`）および GAS `google.script.run` の両方から同一インタフェースで呼び出されます。

1. `apiGetHomeBootstrap(authKey)` — 起動時同期（03:00境界、天気3h鮮度更新、状態/デッキ/境界/天気行/$\Delta t$/リスト/論理日Chatログ）
2. `apiStartAction(authKey, cardPayload)` — 行動開始・`activeSession` 保存・終了見込み時刻に基づく次手先読み
3. `apiCompleteAction(authKey, completePayload)` — 完了/進行記録（`keepOpen: true` でタスク・ストックを未完のまま `【進行】` 記録可）・写真Drive保存・周期スタンプ・一括引き算リスケ・睡眠ログ反映
4. `apiDismissCardToday(authKey, cardId)` — 左スワイプでの当日提案除外
5. `apiSendChat(authKey, messagePayload)` — マルチモーダルChat送信（Cloudflare Workers 接続時は `POST /chat/stream` による SSE リアルタイムストリーミング＋2段目Web検索/広域カレンダー＋裏側シートミラー、GAS 接続時は一括 JSON 応答）
6. `apiMutateListItem(authKey, mutation)` — Lists タブの Shopping 購入済トグル
7. `apiRefreshDeck(authKey, excludeIds, options)` — 末尾「別の候補を生成する」カードからの既存保持追記（`mode: 'append'`）および再編成時の新規手札補充

---

## ⚙️ Script Properties（GAS スクリプトプロパティ）

| キー | 必須 | 説明 / 備考 |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | ○ | Google AI Studio API キー |
| `SPREADSHEET_ID` | ○ | 本番 Google スプレッドシート ID |
| `DRIVE_FOLDER_ID` | ○ | アップロード画像保存用 Google Drive フォルダ ID |
| `NOTION_API_KEY` | ○ | Notion Internal Integration Secret |
| `NOTION_DAILY_DB_ID` | ○ | Notion 日報データベース ID |
| `NOTION_MONTHLY_DB_ID` | ○ | Notion 月報データベース ID |
| `DASHBOARD_ACCESS_KEY` | - | PWA オーナー認証キー（未設定時はスクリプトID/ソルトから自動生成） |
| `TEST_SPREADSHEET_ID` | - | 検証用コピーシート ID（`USE_TEST_SPREADSHEET=TRUE` 時に切替） |
| `USE_TEST_SPREADSHEET` | - | `'TRUE'` 設定時のみ `TEST_SPREADSHEET_ID` を参照 |
| `HOME_LATITUDE` / `HOME_LONGITUDE` | - | 自宅座標（既定: 横浜・磯子 `35.3970, 139.6179`） |
| `WORK_LATITUDE` / `WORK_LONGITUDE` | - | 職場座標（既定: 渋谷 `35.6580, 139.7016`） |
| `FAMILY_CALENDAR_ID` / `HOUSEHOLD_CALENDAR_ID` | - | 家族共用 Google カレンダー ID（読み取り専用） |
| `OWNER_USER_ID` | - | 既存の認証キー互換維持用（任意） |

---

## 📊 スプレッドシート構造（全6タブ）

1. **`logs`**（会話ログ・16列・直近30日保持）: `[時刻, 発言者, メッセージ, 画像URL, AI返答, Lite入力, Lite出力, Liteキャッシュ, Flash入力, Flash出力, Flashキャッシュ, 新総トークン, 判定タグ/フェーズ, 旧AI返答（比較用）, 旧Flash総トークン, トークン削減差分]`
2. **`tasks`**（タスク・**全10列**）: `[タスクID, タスク名, 期限, ステータス(未完了/完了/破棄), 登録日, 完了日, メモ, リマインド目安, 関連URL, 見込み所要時間(分)]`
3. **`routines`**（繰り返し定義・7列）: `[ルール名, タイプ, 設定値, 最終生成日, メモ, ステータス(有効/完了/期間満了), 完了日]`
4. **`shopping`**（買い物リスト・4列）: `[品名, カテゴリ, ステータス(未買/購入済/破棄), 登録日]`
5. **`input_stock`**（インプットストック・**全6列**）: `[種別, タイトル, メモ, ステータス(未/完/破棄), 消化日, 見込み所要時間(分)]`
6. **`memory`**（設定・記憶・プロンプト・2列 `[キー, 値]`）:
   - 記憶・コンテキスト: `profile`, `ideal_self`, `dictionary`, `rolling_memory`, `weekly_summary`, `lifestyle_habits`, `skill_options`, `cycle_stamps`, `project_folders`, `project_root_ids`, `weather_info`, `pressure_alert`, `monthly_report_ready`, `V2_FAST_STATE`
   - モデル制御: `backend_model`, `thinking_level`
   - プロンプトモジュール: `prompt_core`, `prompt_schedule`, `prompt_db`, **`prompt_deck`**, `custom_system_prompt`

---

## 🛠️ 開発・検証・デプロイコマンド

```bash
# 1. src/*.js ＆ web/js/*.js 構文チェック ＋ DashboardHtml/sw.js 検証
npm run check

# 2. web/ → docs/ PWA 一式ビルド
npm run build:dashboard

# 3. ローカルモックサーバー ＆ E2E検証（インメモリDB ＋ .env 読み込み時実Gemini連携）
npm run test:mock
npm run mock:server

# 4. プロンプト同期（検証シートへは --test オプション付与）
node scripts/sync-prompts-to-sheet.js --test
node scripts/sync-prompts-to-sheet.js

# 5. GAS（深夜 03:00 バッチ専用）へ反映（確認・承認済みブランチの最終反映時）
npm run push
```

※ `memory` シート／D1 テーブルの入力規則・バリデーション手順は `.agent/skills/memory-validator/SKILL.md` を参照してください。
