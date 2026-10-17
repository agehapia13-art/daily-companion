# 生活伴走システム（LINE Bot × GAS × Gemini 3.8 Flash）

サウンドディレクター専属の生活管理秘書兼伴走者として、LINE・Google Apps Script (GAS)・Gemini 3.8 Flash・Googleスプレッドシート・Googleカレンダー・Notion API・Open-Meteoを完全統合したパーソナル自動化システムです。

---

## 🌟 システムの特徴と主要アーキテクチャ

1. **完全コストゼロ運用（LINE Reply API限定）**
   - Push APIは一切使用せず、全対話・通知を無料の **Reply API** のみで完結。
   - 深夜バッチも通知なしの完全サイレント処理。
2. **睡眠ファースト ＆ 起床連動（ファースト・ハロー方式）**
   - 起床時間（朝4時〜正午まで）の初回の発言（「作業する」「おはよ」等）の返信末尾に、**天気・気圧急降下アラート・本日の予定・重要タスク**をまとめたデイリーブリーフィングを自動合流（正午以降や2回目以降の発言では誤発動しないガード付き）。
   - **プログラム制御による二重配信防止**: AIの出力に任せず、`PropertiesService` とスプレッドシート `memory` の両面ガード（`isBriefingDeliveredToday` / `markBriefingDeliveredToday`）で1日1回だけ確実に配信。
3. **超低遅延レスポンス ＆ トークン極小化**
   - **思考トークン無効化（`thinkingBudget: 0`）**: Gemini Flashの内部思考プロセスによる課金・遅延を完全排除し、LINE Reply APIを最速実行。
   - **空キー省略ルール**: 通常の雑談時は `{"reply_text": "..."}` のみ出力させ、不要なJSONキー（`task_actions: []` 等）を出力させないことで出力トークンを最小化。
   - スプレッドシート更新等の重いI/Oは返信完了後に安全に非同期ライクに実行。
4. **安心の単一ユーザーセキュリティ（あなた専用）**
   - あなたのLINE User ID（`OWNER_USER_ID`）のみを受け付けるホワイトリスト認証。
   - 他者からのメッセージや偽造リクエストを即座に遮断し、予定・体調・タスクのプライバシーを保護。
5. **記憶の3層管理 ＆ 用語辞書（前提知識の厳格遵守）**
   - **短期記憶**: 当日の会話ログ（極小高密度フォーマット `HH:mm User: ... / AI: ...` で全ターン保持）。
   - **中期記憶**: `rolling_memory`（最近の関心・ログ：直近7〜10日分の活動・関心バッファ）。
   - **長期記憶**: `profile`（住居・家族・勤務形態などの恒久的事実。深夜バッチで厳格に代謝）。
   - **用語辞書**: 『ぽこあポケモン』『残響フラクタル』『ぱずぎり』などの独自用語・作品定義をAIが世間一般の作品と混同しないよう、コンテキストに常時注入。
6. **Web検索（Google Search Grounding）とタスク誤爆防止**
   - 「〇〇のイベントいつまで？」「〇〇のチケット発売日いつ？」等の質問時は、Web検索で正確な期日・事実を調査。
   - 調べた時点では勝手にタスク追加せず、「タスクに追加しておきましょうか？」と確認を添え、次のターンで「追加して」と言われた際に初めて期限付きタスクとして登録。
7. **Googleカレンダー双方向連携 ＆ 家族共用カレンダー安全参照**
   - **メインカレンダー**: 読み取りおよび追加・削除に対応。毎週の曜日繰り返し予定（`recurrence_days: ["MON", "THU", "FRI"]`）にも対応し、重複単発予定を自動クリーンアップ。
   - **家族共用カレンダー（`FAMILY_CALENDAR_ID`）**: 【完全読み取り専用】。ユーザー担当の「♪」付き予定のみを抽出してデイリーブリーフィングやスケジュール把握に活用。
8. **タスク管理 ＆ 締切時刻ルール**
   - **文脈プレフィックス付与**: タスク名は「対象/プロジェクト：具体的なタスク内容」形式で自己完結（例: `生活伴走システム：デイリーブリーフィング重複表示防止機能実装`）。
   - **締切時刻ルール**: 時間まで決まっているタスクはタスク名の末尾に `（〜12:00まで）` `（18:00締切）` のように明記。
   - **DB操作通知の一本化**: `✅ タスク完了: ...` や `📝 タスク追加: ...` はAIの出力に任せず、プログラム側（`Webhook.js`）が末尾に1行だけ確実に自動付加して重複を防止。
   - 登録後7日以上経過した未完了タスクには `[⚠️登録後7日以上経過]` を自動検出し、落ち着いたタイミングで1件だけ棚卸しを確認。
9. **深夜03:00統合バッチ (Notion日報・月報連携)**
   - 当日の会話ログと完了タスクを集約し、GeminiでMarkdown日報を生成してNotion日報DBへ投稿。
   - **Notionリッチテキスト完全対応**: 太字（`**...**`）のインラインアノテーション、区切り線（`divider` ブロック）にネイティブ対応。
   - **思い出の写真自動埋め込み**: LINEで送信された画像（Google Drive保存）の中から、料理・風景・記念スクショなど日記として価値のある特筆すべき写真を厳選し、Notion日報および月報に自動埋め込み。
   - **振り返りの質向上**: AIへの指摘・指示をユーザー自身の気づきにすり替える美談化を禁止、エピソードの具体性を維持、翌日使われない「明日への引き継ぎメモ」を廃止。
   - **Notion投稿成功を確認してから**ログをクリアするデータ保護設計。
   - ルーティンタスクの重複生成防止ガード（同名タスクが未完了の場合はスキップ）。
   - 毎月1日には前月日報を自動集約し、月間ハイライト・思い出ジャーナルをNotion月報DBへ投稿。
10. **生活伴走Webダッシュボード（GitHub Pages × LIFF × LINEリッチメニュー）**
    - **スプレッドシートの`logs`以外（全5タブ）をスマホで直感操作できる専用SPA**:
      - 🌿 **タスク**: 未完了タスクを全件一覧表示。プレフィックス（プロジェクト）ごとに自動グループ化し、各グループ内は**直近の締め切り順**で優先表示。「📂 グループ別」と「📅 締切順一覧」のワンタップ切り替えや、長期タスクの「🌱 登録から○日」バッジ表示、完了時の「元に戻す」トースト通知。
      - 🛒 **買い物**: カテゴリ別未買リスト、ワンタップ購入済チェック、クイック追加。
      - 💡 **ストック**: 映画・音楽・本・ゲーム等の未消化作品一覧、消化チェック、新規追加。
      - 🔄 **周期・記憶**: 美容院や弦交換などの「あれから○日経過」と「✨ 今日やった」ワンタップ更新、定期ルーティン一覧、およびAIの『用語辞書』『プロフィール』『最近の関心・ログ』『体調・睡眠サマリー』の閲覧と直接編集。
    - **GitHub Pages × LIFF 連携によるネイティブアプリ体験**:
      - **公開URL**: `https://agehapia13-art.github.io/daily-companion/`
      - **GitHubリポジトリ**: `https://github.com/agehapia13-art/daily-companion`
      - フロントエンド（`docs/index.html`）を **GitHub Pages** 上でホストし、裏側のデータ読み書きのみGASのJSON APIと通信する構成。
      - GAS特有の「このアプリケーションはGoogle Apps Scriptのユーザーによって…」という上部警告バーや二重iframe隔離制限を完全解消。
      - **LINEトーク画面への自動発言**: ダッシュボード上でタスク完了・買い物購入・インプット消化・周期メンテナンスを実施すると、LIFF（`liff.sendMessages`）を通じて**LINEトーク画面にあなた自身の緑の吹き出しで自動発言**され、AIの返信とともに当日ログ（`logs`シート）へ自然に記録。
      - **自動パラメータ引き渡し＆フォールバック**: リッチメニューから開くと `tab`, `key`, `liffId`, `api` が自動引き渡しされ `localStorage` に記憶。万が一のGASコールドスタートや通信不調時も、15秒タイムアウト判定とエラー境界により永久スピナー停止を防止。

---

## 📁 ディレクトリ構成

```
.
├── .clasp.json           # clasp設定 (rootDir: "src", Git管理対象外)
├── appsscript.json       # タイムゾーン (Asia/Tokyo) およびV8ランタイム設定
├── docs/
│   ├── index.html        # GitHub Pages配信用ダッシュボードSPA (scripts/bundle.jsで自動生成)
│   └── .nojekyll         # GitHub Pages高速配信用設定
├── bundle/
│   ├── Code.js           # GAS Webエディタにコピペ一発で貼れる完全統合コード (全機能・省略ゼロ)
│   └── appsscript.json   # bundle配下のマニフェストコピー
├── src/
│   ├── appsscript.json   # GASデプロイ用マニフェスト
│   ├── Config.js         # 設定・Script Properties検証・定数・家族カレンダー設定
│   ├── Spreadsheet.js    # 全6タブ操作・マルチターン履歴・タスクID・用語辞書フィルタ・真偽値正規化
│   ├── Calendar.js       # 動的カレンダーウィンドウ・家族共用カレンダー(♪抽出)・繰り返し予定対応
│   ├── Weather.js        # Open-Meteo 天気 & 6時間以内5hPa気圧急降下検知
│   ├── Notion.js         # Notion API連携（日報・月報投稿・リッチテキスト/太字/区切り線/画像ブロック）
│   ├── Gemini.js         # Gemini 3.8 Flash 低遅延マルチモーダル・Web検索・日報/月報プロンプト
│   ├── Line.js           # LINE Reply API & 画像Drive保存（共有権限付与・Notion直接URL化）
│   ├── Batch.js          # dailyMidnightBatch (深夜03:00バッチ / 重複ガード / ログ保護)
│   ├── Dashboard.js      # WebダッシュボードAPI・HTMLテンプレート ＆ LINEリッチメニュー自動登録
│   ├── Webhook.js        # doPost (LINE Webhook & ダッシュボードJSON API) & doGet
│   └── Setup.js          # 手動実行・設定・テスト専用（シート初期化・タイマー登録・リッチメニュー登録・各テスト）
├── scripts/
│   └── bundle.js         # src/*.js から bundle/Code.js と docs/index.html を同時自動生成するスクリプト
└── README.md
```

---

## ⚙️ 環境変数（Script Properties: 全12項目）

Google Apps Script プロジェクトの「プロジェクトの設定」>「スクリプト プロパティ」に以下を設定してください。

| キー | 必須 | 説明 | 設定例 / 備考 |
| :--- | :---: | :--- | :--- |
| `OWNER_USER_ID` | ○ | **あなたのLINE User ID** | LINE公式アカウントと会話した際の `event.source.userId`（`U...` 33桁） |
| `LINE_CHANNEL_ACCESS_TOKEN` | ○ | LINE Messaging API チャネルアクセストークン（長期） | LINE Developers コンソール |
| `GEMINI_API_KEY` | ○ | Google AI Studio APIキー | Google AI Studio |
| `SPREADSHEET_ID` | ○ | 連携するGoogleスプレッドシートのID | スプレッドシートURLの `/d/{ID}/edit` 部分 |
| `DRIVE_FOLDER_ID` | ○ | 受信画像を保存するGoogle DriveフォルダID | DriveフォルダURLの `/folders/{ID}` 部分 |
| `NOTION_API_KEY` | ○ | Notion Internal Integration Secret | Notion Developers（`secret_...`） |
| `NOTION_DAILY_DB_ID` | ○ | Notion日報データベースID | Notion日報DBのURL内の32桁英数字 |
| `NOTION_MONTHLY_DB_ID` | ○ | Notion月報データベースID | Notion月報DBのURL内の32桁英数字 |
| `HOME_LATITUDE` | ○ | 自宅（横浜市磯子区）の緯度 | `35.3970` |
| `HOME_LONGITUDE` | ○ | 自宅（横浜市磯子区）の経度 | `139.6179` |
| `WORK_LATITUDE` | - | 職場（渋谷区）の緯度（任意） | `35.6580` |
| `WORK_LONGITUDE` | - | 職場（渋谷区）の経度（任意） | `139.7016` |
| `FAMILY_CALENDAR_ID` | - | 家族共用GoogleカレンダーのID（任意） | カレンダー設定の「カレンダーID」（「♪」付き予定を安全に読み取り参照） |
| `WEBAPP_URL` | - | デプロイしたGASウェブアプリのURL | `https://script.google.com/macros/s/.../exec`（GitHub PagesからのAPI接続やリッチメニュー登録に使用） |
| `LIFF_ID` | - | LINE Front-end Framework の LIFF ID | `200...-xxxx`（ユーザー名義でのトーク自動発言・リッチメニュー連携に使用） |

---

## 📊 スプレッドシート構造（全6タブ）

1. **`logs`**（当日会話ログ）: `[時刻, 発言者, メッセージ, 画像URL, AI返答]`（※機械用一時バッファ。深夜バッチでNotion投稿後にクリア）
2. **`tasks`**（単発タスク）: `[タスクID, タスク名, 期限, ステータス(未完了/完了/破棄), 登録日, 完了日, メモ]`
3. **`routines`**（繰り返し定義）: `[ルール名, タイプ(day_of_week/day_of_month/interval_days), 設定値, 最終生成日, メモ]`
4. **`shopping`**（買い物リスト）: `[品名, カテゴリ, ステータス(未買/購入済), 登録日]`
5. **`input_stock`**（映画・音楽・本のストック）: `[種別, タイトル, メモ, ステータス(未/完), 消化日]`
6. **`memory`**（中長期記憶・システム制御）: `[キー, 値]`
   - `profile`: ユーザー属性・生活前提条件
   - `dictionary`: 用語辞書（客観的前提知識）
   - `rolling_memory`: 最近の関心・ログ（直近7〜10日分の活動・関心バッファ）
   - `weekly_summary`: 直近数日間の疲労・睡眠サマリー
   - `cycle_stamps`: 周期メンテナンス記録（美容院、弦交換、シーツ洗濯等）
   - `weather_info`: 今日の天気・最高気温・降水確率
   - `pressure_alert`: 6時間以内5hPa気圧急降下アラート（TRUE/FALSE）
   - `briefing_delivered_date`: 本日ブリーフィング配信済み日付（YYYY-MM-DD）
   - `monthly_report_ready`: 月報作成完了フラグ（TRUE/FALSE）
   - `custom_system_prompt`: スプレッドシート側から注入可能な追加カスタムプロンプト

---

## 🛠️ 開発・デプロイ運用ルール

### 1. コードの同期とGASへの反映（Antigravity連携）

プロジェクトは `src/` 配下の複数ファイル（`Setup.gs`, `Dashboard.gs` など）でGASと1対1で完全同期されます。

```bash
# 1. 変更をバンドルファイル(bundle/Code.js)およびGitHub Pages(docs/index.html)へビルドし構文チェック
node scripts/bundle.js && node -c bundle/Code.js

# 2. clasp でGASプロジェクトへコードを直接プッシュ
npx clasp push --force

# 3. GitHub Pagesへ最新のフロントエンドをプッシュ
git add . && git commit -m "update dashboard frontend" && git push origin main
```

### 2. GASエディタ側でのデプロイ更新

GAS側へコードが反映されたら、Webアプリのバージョンを更新します：
1. GASエディタ右上の **「デプロイ」＞「デプロイを管理」** を開く。
2. 鉛筆マーク（編集）を押し、バージョンを **「新バージョン」**、アクセスできるユーザーを **「全員」** にして「デプロイ」を押す。

### 3. LINE Developers (LIFF) 設定

1. LINE Developers コンソールの **LINEログインチャネル** ＞ **「LIFF」タブ** を開く。
2. **エンドポイントURL**:
   `https://agehapia13-art.github.io/daily-companion/`
3. **Scopes**:
   `chat_message.write`, `profile`（または `openid`）にチェック。
4. **モジュールモード**:
   オフのままで正常動作します。

### 4. 初期設定・手動操作（`Setup.gs`）

手動で実行したい設定やテストは、すべて **`Setup.gs`** を開けば一番上に揃っています：

- `setupSpreadsheet`: スプレッドシートの全6タブとヘッダーを自動初期化
- `setupTriggers`: 毎日午前3時の深夜バッチタイマートリガーを自動登録
- `setupLineRichMenuFromSetup`: LINEトーク画面下部に4分割リッチメニューを自動登録・有効化（GitHub PagesおよびLIFF URLを自動構成）
- `testWebhookSimulation`: LINE受信テスト
- `testWebSearchSimulation`: Web検索テスト
- `testMidnightBatchSimulation`: 深夜バッチ手動実行テスト
- `testMemoryLifecycleSimulation`: 記憶代謝テスト

