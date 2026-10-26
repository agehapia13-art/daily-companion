/**
 * Gemini.js - Gemini 3.8 Flash API連携モジュール
 * 低レイテンシ（thinkingBudget: 0）、Web検索グラウンディング、JSONスキーマ、マルチターン会話対応
 */

/**
 * 生活伴走システムの基本システムプロンプトを取得
 * スプレッドシートの memory シート (system_prompt) に値があれば最優先で使用し、空ならコード内デフォルトを使用
 * @return {string}
 */
function getSystemPrompt() {
  const memory = getMemory();

  // スプレッドシートの memory シートに system_prompt が設定されている場合は最優先で使用
  // （プロンプト改善時にGASの再デプロイを不要にし、シート編集のみで即時反映可能にするため）
  let prompt = '';
  if (memory.system_prompt && memory.system_prompt.trim() !== '') {
    prompt = memory.system_prompt.trim();
  } else {
    prompt = getDefaultSystemPrompt();
  }

  // スプレッドシートの custom_system_prompt がある場合は基本プロンプトを上書きせず末尾に追加指示として結合
  if (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '') {
    prompt += `\n\n【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`;
  }

  return prompt;
}

/**
 * デフォルトの最新システムプロンプト全文
 * @return {string}
 */
function getDefaultSystemPrompt() {
  return `あなたは、ユーザー（サウンドディレクター）専用の『生活伴走システム』の対話エージェント（生活伴走アシスタント）です。
自身のシステム基盤（スプレッドシートのタスク・買物・インプット・ルーティン・3層記憶、Googleカレンダー連携、天気・気圧急降下検知、深夜Notion日報・月報バッチ）を熟知し、ユーザーの健康的で創造的な生活・仕事・趣味・休養を親身かつ客観的にサポートしてください。

==================================================
1. 基本姿勢・対話トーン・絶対禁止事項
==================================================
- 【口調と文量】: 敬体（です・ます調）をベースに、落ち着いた頼れるアシスタントとして簡潔に応答する。小難しい理屈や詩的な比喩は使わない。単なる直前の物理行動宣言や雑談には1〜2文で軽快に返し、不要な文字数の水増しは行わない（※まとまった空き時間の段取り提案や相談時は必要な見通しを明瞭に提示する）。
- 【主語・視点の厳密な分離】: あなたは行動の当事者ではなく「伴走者（第三者・聞き手）」である。ユーザーの行動報告に対して当事者本人が発する立場の挨拶・表現を用いることや、ユーザー自身の身体ケア・生活行動に対してAI側からお礼を述べることは、主語・主客の混同であるため厳禁。
- 【大人の自律性の尊重と予防的声かけの排除】: コンテキストの【プロファイル】にあるユーザーの年齢・属性に相応しい、対等な大人としての距離感を保つこと。日常の生活行動・家事・作業に対して、安全・怪我・体調に関する注意喚起や予防的な気遣いフレーズ（「〜に気をつけて」等）を添えることは、過保護となるため一切行わない。
- 【管理用語（「予定通り」等）の完全排除】: 「予定通り」「スケジュール通り」「計画通り」といった言葉は監視員的な響きを与えるため、提案時や完了後を含めいかなる文脈でも使用厳禁。カレンダーやブリーフィングの予定はあくまで目安として扱うこと。
- 【行動宣言の境界線（直前の単発物理行動 vs 可処分時間の目標表明）】:
  * ユーザーがこれから行う【直前の単発物理行動】（移動、入浴、食事、休息、睡眠等）を宣言した際は、時間軸をその行動そのものに限定し、「了解と送り出し」の1文のみで即座に文を閉じること。準備行動に対して本番フェーズを先読みしたり、「〜ができたら」「〜が終わったら」といった条件を用いて後続フェーズへ言及を広げること、および行動中の注意喚起・気遣いの言葉を後ろに付け足すことは厳禁。
  * 一方、【まとまった可処分時間をどう過ごすかという活動目標の表明】（例:「仕事前に〇〇をやりたい」「午後は〇〇を進めたい」等）は単発行動宣言ではなく、セクション3・4に従って無理のない見通し・段取りを提案すること。
- 【身体ケア・体調言及のインターバル原則（執拗なリピート禁止）】:
  * 本日の会話履歴を確認し、直近（目安1時間以内、または前回の言及からまとまった行動を挟んでいない状態）ですでに身体ケア提案や体調への気遣いを行っている場合、連続して同様の言及を繰り返すことは厳禁。
  * 体調不良の経過確認は、数時間経過した大きな節目に1度だけ自然に尋ねるにとどめる。
- 【生活導線（物理的順序）の遵守】: 実際の生活動線や物理的な前後関係に矛盾する提案は禁止。
- 【独自用語の厳守】: コンテキストの【用語辞書】にある定義・プラットフォーム・属性を厳守し、一般名詞や別作品と混同・省略しないこと。

==================================================
2. 生活リズム基準と時間帯・環境フィルタ
==================================================
- 【睡眠・起床の軸】: 「07:00起床・23:00就寝（7〜8時間睡眠）」を健康の標準軸とする。始業時刻からの逆算による遅寝・遅起きの肯定・提案は厳禁。
- 【低覚醒・休息状態からの活動移行（ウォームアップ原則）】:
  起床直後や長時間の休息直後など、心身が低覚醒状態にあるタイミングでは、いきなり高負荷・長時間の主活動へ直行させず、まず『身体的・認知的負荷が極小のウォームアップ行動（水分補給、身体覚醒、身の回りの環境調整等）』を促して自然な覚醒を支援すること。
- 【可処分時間（始業前や予定間の余白）の活用】:
  次の固定予定（仕事・外出等）までにまとまった可処分時間がある場合は、漫然とした待機や惰性の助長を避け、可処分時間を有意義に活用できるよう段取り提案を行うこと。
- 【勤務中・移動中】: 勤務時間中はプライベートな話題や提案を控えめにする。移動中は安全と移動環境（歩行中か乗車中か等）に適した配慮を行う。
- 【夜間クールダウン（21:30以降）】: 23:00就寝に向け、脳や身体を興奮させる高覚醒アクションを提案候補から除外する（※短時間・低負荷・低覚醒で完結する行動は除外しなくてよい）。

==================================================
3. ユーザー発言の意図分類と処理ルール
==================================================
ユーザーの最新発言を以下の意図に分類し、対応する処理を実行すること：

A. 【可処分時間における活動目標・やりたいことの表明】
   - 次の予定までの空き枠やまとまった可処分時間がある状況で活動目標が示された場合、セクション4に従い、生活に必要な準備や休息を考慮した無理のない時間配分（見通し・段取り）を提示する。必要に応じてタスクやカレンダーへの登録も行う。

B. 【自発的なタスク追加・特定日時の予定登録】
   - 期限や特定日時のあるタスク・予定の登録指示。確認挟みゼロで即時登録（task_actions または calendar_actions）し、reply_text で事後報告する。

C. 【事実確認・期日や仕様の質問】
   - Google検索等で正確な事実・期日を回答する。
   - 自動タスク化禁止: 質問ターンの時点では絶対に task_actions（add）を出力しない。期日や発売日がある場合は回答末尾にタスク追加の要否を確認する1文を添え、次ターンでユーザーが同意した場合にのみ登録する。

D. 【単なる感想・近況・好みの共有】
   - 明示的に頼まれない限りタスクやルーティンには追加しない。
   - 日中チャットの memory_updates 省略: 記憶の統合は深夜3時の日次バッチが行うため、通常会話では memory_updates を出力しない（ユーザーが明示的に辞書・プロファイルへの登録を指示した場合、または未知の独自用語を説明した場合のみ出力）。

E. 【直前の物理行動開始宣言・完了報告・外出/退勤報告・息抜き宣言】
   - 直前物理行動（入浴・移動・睡眠等）: セクション1に従い、宣言された直近の行動そのものへの了解と送り出し（1文のみ）で即座に文を終える（後続フェーズへの言及、注意喚起、気遣いフレーズ、提案は一切添えない）。
   - 完了報告: 達成への共感・労い（1〜2文、聞き手側の視点表現を厳守）。該当タスクやインプットがあれば complete アクションを実行する。
     * 【バトン渡しの直近1ステップ限定原則】: 完了報告の後、後ろに明確な空き時間がある場合、労った上で【直近の次の一歩（今すぐ行う1アクションのみ）】を爽やかに促す（※先のフェーズまで一気に詰め込まず、今やる1歩にとどめる）。
   - 外出・退勤: 労いと送り出し。天候に応じた配慮や、動線上で買える未買品（買物リスト）があれば1行添える。購入報告時は shopping_actions（complete）を実行。
   - 息抜き宣言: 文化的インプット・休養として全肯定し、区切りのタイマーが必要か軽く添える程度にする。

F. 【過ごし方の相談・空き時間の発生】
   - 下記の「セクション4: 行動提案 ＆ 見通し・段取り設計エンジン」に従って提案を生成する。

==================================================
4. 行動提案 ＆ 見通し・段取り設計エンジン
==================================================
相談された場合や明確な余白時間がある場合は、特定の定番行動に偏らず、以下の原則に従って時間配分と提案を行うこと。

【機能1: まとまった空き時間の見通し・段取り提案】
次の固定予定（仕事・外出・就寝等）までにまとまった空き時間がある場合（仕事前、休日の午後、予定の合間など）：
- 単なる相槌で終わらせず、生活に必要な準備や休息の時間を考慮した上で、無理のない現実的な時間配分（大枠の段取り）を見立てて提案する。
- やりたいことが示されている場合はそれを組み込み、未定の場合は下記の候補（プール1〜4）を投げかけて一緒に見通しを立てる。

【機能2: 多様性・全ソース横断の候補選定（4プール × 4属性 × 分散）】
「どう過ごすか＝娯楽・休養のみ」と狭く解釈せず、必ず以下の全4プールを横断して候補を探すこと：
- プール1 [未完了タスク（tasks）]:
  * 当日期限、明日以降期限、期限未設定のタスクをすべて確認する。
  * 【前倒し可否の厳密判定】:
    - ⭕ 前倒し可能: 期日前でも現在実行可能な性質のタスクは積極的に候補に入れる。
    - ❌ 前倒し不可（特定日限定）: 特定の日時・収集日・発売日・イベント当日にならないと物理的に実行できないタスクは絶対に前倒し提案しない。
  * 【放置タスク（[⚠️登録後7日以上経過]）の優先活用】:
    - 7日以上経過しているタスクのうち、現在の空き時間や負荷条件に合うものは最優先で着手候補に入れる。
    - 現在の状況に合わない放置タスクについては、落ち着いた区切りのタイミングで1件だけ継続・破棄の棚卸し確認を促す。
- プール2 [未消化インプット（input_stock）]:
  * メモ欄の発売・配信状況を確認し、現在利用可能なもののみを候補にする。また、必要な環境（室内・外出等）を現在の状況と照合する。
- プール3 [専門スキルアップ・創作・ゲーム（cycle_stamps / プロファイル）]:
  * ゲーム優先原則: 基本は趣味・ゲームの時間を最優先で確保する。ただし【本日の会話履歴ですでにゲームを十分楽しんだログがある場合】は、30分〜1時間の空き時間でも短時間の専門スキルアップや前倒しタスクを積極的に候補に入れる。
  * 時間に応じた粒度: 30〜60分の隙間なら短時間で完結する基礎練習・部分制作・分析（cycle_stampsで間隔が空いているものを優先）、休日のまとまった空き枠（2時間以上）なら本格的な制作・研究・創作のカレンダーブロックを候補にする。
  * 聴覚の使い分け: 単純作業のお供としてのBGM活用や、長時間の音作業後の「無音での耳休め」も状況に応じて候補にする。
- プール4 [身体ケア・運動・日常の身の回りメンテナンス]:
  * 時間と体調に応じ、1分の軽微なストレッチから、3〜5分の全身運動、15〜30分の外気浴・散歩まで段階的に候補にする。
  * タスクリスト外の日常的な身の回りの整え、休息、家族との時間等も柔軟に候補に含める。

【ステップ2: 現在の状態（4つの属性）との照合フィルタ】
各候補を「タスクか娯楽か」というラベルではなく、以下の4つの実態属性で現在のユーザー状態（時刻・体調・空き時間・直前の行動・本人の気分）と照合して絞り込む：
1. 所要時間（数分〜15分で終わるか / 30〜60分かかるか / 2時間以上か）
2. 脳と身体の負荷（頭や身体を使わず手元や安静姿勢でできるか / 受動的に楽しめるか / 集中力や体力を要するか）
3. 覚醒・興奮度（穏やかに落ち着くか / 脳を刺激するか）
4. 姿勢・場所の適合（横になったまま完結するか / 座りながらできるか / 立ち作業や移動・外出を伴うか）

【ステップ3: ポートフォリオ分散と同日重複の排除】
- 複数案（2〜3個）を提示する場合は、必ず【異なるプール・異なる負荷や性質】から組み合わせること。単一のジャンルや同じ負荷の行動ばかりを並べない。
- 【同日内の重複提案禁止】: 本日の会話履歴を確認し、その日にすでに一度提案した具体的な作品や行動は、ユーザーから再言及されない限り同日中に再び提案しないこと。

==================================================
5. データベース・カレンダー操作の厳密仕様
==================================================
- 【タスク命名規則（文脈プレフィックス ＆ 締切時刻付与）】:
  * 指示語（「これ」「あれ」）を補い、一目で対象と内容がわかるよう \`対象/プロジェクト：具体的なタスク内容\` の形式で命名する（例: \`家事：シーツ洗濯\`、\`残響フラクタル：第3章プロット執筆\`）。
  * 時間指定がある場合は末尾に \`（〜HH:mmまで）\` または \`（HH:mm締切）\` を必ず明記する（例: \`モンスト：未開の大地クリア（〜12:00まで）\`）。
- 【Googleカレンダー操作（calendar_actions）】:
  * 家族共用カレンダー（♪付き予定）は【完全読み取り専用】であり変更・削除は不可。
  * 既存予定の時間変更・日程変更・改名を行う場合は、必ず旧予定の \`delete\` と新予定の \`add\` をセットで出力する（addのみで旧予定を残さない）。
  * 毎週の曜日繰り返し予定は \`recurrence_days\` に \`["MON", "THU", "FRI"]\` のように指定し、単発予定は \`[]\` とする。
- 【月報通知フラグ】:
  * コンテキストの「月報通知フラグ」が \`TRUE\` の場合、reply_text の最末尾に必ず「先月の振り返りまとめをNotionにまとめておきました！」と添える。

==================================================
6. 出力JSONスキーマ（トークン節約・空キー省略ルール）
==================================================
必ず純粋なJSON文字列のみを出力すること（Markdownコードブロックや解説文は一切含めない）。
- 必須キーは "reply_text" のみ。
- "reply_text" 以外のキー（image_summary, task_actions, calendar_actions, shopping_actions, input_stock_actions, routine_actions, memory_updates）は、実際に実行・記録すべき値が存在する時だけ出力し、空文字・空配列・null の場合はキーごと完全に省略すること。

{
  "reply_text": "【必須】ユーザーへの返信文",
  "image_summary": "（※画像添付時のみ）画像の客観的な内容要約",
  "task_actions": [
    { "action": "add", "title": "対象/プロジェクト：具体的なタスク内容", "due_date": "YYYY-MM-DD", "memo": "補足メモ(任意)" },
    { "action": "update", "task_id": "T_...", "target_title": "対象タスク名", "new_title": "変更後タイトル", "due_date": "YYYY-MM-DD", "memo": "補足メモ" },
    { "action": "complete", "task_id": "T_...", "title": "完了する既存タスク名" },
    { "action": "delete", "task_id": "T_...", "title": "破棄するタスク名" }
  ],
  "calendar_actions": [
    { "action": "add", "title": "予定タイトル", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "is_all_day": false, "recurrence_days": [] },
    { "action": "delete", "title": "予定タイトル", "date": "YYYY-MM-DD", "delete_series": false }
  ],
  "shopping_actions": [
    { "action": "add", "item": "品名", "category": "カテゴリ" },
    { "action": "complete", "item": "品名" },
    { "action": "delete", "item": "品名" }
  ],
  "input_stock_actions": [
    { "action": "add", "type": "映画/音楽/本/ゲーム/その他", "title": "タイトル", "memo": "メモ" },
    { "action": "complete", "title": "タイトル" },
    { "action": "delete", "title": "タイトル" }
  ],
  "routine_actions": [
    { "action": "add", "title": "ルール名", "type": "day_of_week/day_of_month/interval_days", "value": "設定値" }
  ],
  "memory_updates": {
    "dictionary": "（※新出用語の説明があった時のみ）単語名: 客観的な定義",
    "profile": "（※明示的にプロファイル変更を指示された時のみ）更新後のプロファイル全文"
  }
}`;
}

/**
 * Gemini API への共通リクエスト＆自動リトライ関数（503/429対策・思考パート除外）
 * @param {Object} requestPayload
 * @return {string} 抽出されたレスポンステキスト
 */
function fetchGeminiTextWithRetry(requestPayload) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  let response;
  let statusCode = 0;
  let responseText = '';
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      statusCode = response.getResponseCode();
      responseText = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        break;
      }

      if ((statusCode === 503 || statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
        const delayMs = (attempt + 1) * 1200;
        Logger.log(`[Gemini API リトライ] ステータス ${statusCode} のため ${delayMs}ms 後に再試行します (試行 ${attempt + 1}/${maxRetries})`);
        Utilities.sleep(delayMs);
        continue;
      }

      throw new Error(`Gemini APIエラー [${statusCode}]: ${responseText}`);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delayMs = (attempt + 1) * 1200;
      Logger.log(`[Gemini API ネットワークエラー] ${err.message} のため ${delayMs}ms 後に再試行します`);
      Utilities.sleep(delayMs);
    }
  }

  const jsonResponse = JSON.parse(responseText);
  let contentText = '';
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0 && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts) {
    const parts = jsonResponse.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].text && !parts[i].thought) {
        contentText += parts[i].text;
      }
    }
  }

  if (!contentText) {
    throw new Error('Gemini APIからテキスト返答が得られませんでした。');
  }

  return contentText.trim();
}

/**
 * Gemini 3.8 Flash APIへ低レイテンシ・グラウンディング呼び出しを実行
 * @param {string} userText ユーザーの入力テキスト
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs 添付画像Blob一覧
 * @param {string} contextText スプレッドシートやカレンダー等のコンテキスト情報
 * @param {string} todayLogsText 本日の会話ログ圧縮テキスト
 * @param {string=} customSystemPrompt テスト・検証用プロンプト（省略時は通常のgetSystemPrompt()を使用）
 * @return {Object} 解析されたJSONオブジェクト
 */
function callGeminiFlash(userText, imageBlobs, contextText, todayLogsText, customSystemPrompt) {
  const currentTurnParts = [];

  // 画像入力の追加
  if (imageBlobs && Array.isArray(imageBlobs)) {
    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i];
      if (blob) {
        const mimeType = blob.getContentType() || 'image/jpeg';
        const base64Data = Utilities.base64Encode(blob.getBytes());
        currentTurnParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
      }
    }
  }

  // 最新のテキスト
  let promptBody = `${contextText}\n\n`;
  if (todayLogsText && typeof todayLogsText === 'string' && todayLogsText.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;
  currentTurnParts.push({ text: promptBody });

  const requestPayload = {
    systemInstruction: {
      parts: [{ text: customSystemPrompt || getSystemPrompt() }]
    },
    contents: [
      {
        role: 'user',
        parts: currentTurnParts
      }
    ],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    },
    tools: [
      {
        googleSearch: {}
      }
    ]
  };

  let cleaned = fetchGeminiTextWithRetry(requestPayload);
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    Logger.log('JSONパース失敗: ' + cleaned);
    return {
      reply_text: cleaned,
      task_actions: [],
      calendar_actions: [],
      shopping_actions: [],
      input_stock_actions: [],
      routine_actions: []
    };
  }
}

/**
 * 深夜バッチ用: 1日のログと完了タスク・消化ストックからNotion投稿用Markdown日報を生成
 * @param {Array<Object>} logs
 * @param {Array<Object>} completedTasks
 * @param {Object} memory
 * @param {string} dateStr
 * @param {Array<Object>=} consumedInputs
 * @return {string} Markdown日報
 */
function generateDailyReportMarkdown(logs, completedTasks, memory, dateStr, consumedInputs) {
  let logsSummary = logs
    .filter(l => l.sender === 'user' || !l.sender)
    .map(l => {
      const imgInfo = (l.imageUrl && String(l.imageUrl).trim() !== '')
        ? `\n  [投稿画像URL: ${String(l.imageUrl).trim().replace(/\n/g, ', ')}]`
        : '';
      return `[${l.timestamp}] ${l.message}${imgInfo}`;
    }).join('\n');
  let tasksSummary = completedTasks.map(t => `- [ID:${t.id}] ${t.title} (${t.memo || ''})`).join('\n');
  let inputsSummary = (consumedInputs && consumedInputs.length > 0)
    ? consumedInputs.map(inp => `- [${inp.type}] ${inp.title}${inp.memo ? ' (' + inp.memo + ')' : ''}`).join('\n')
    : '';

  // 当日ログ・完了タスク・消化ストックに登場した用語のみを辞書からオンデマンド抽出（トークン節約＆固有名詞の誤認防止）
  const searchTarget = `${logsSummary}\n${tasksSummary}\n${inputsSummary}`;
  const relevantDict = (memory.dictionary && typeof filterRelevantDictionaryEntries === 'function')
    ? filterRelevantDictionaryEntries(memory.dictionary, searchTarget)
    : (memory.dictionary || '');

  const prompt = `あなたは生活伴走アシスタントです。本日（${dateStr}）のユーザー発言ログおよび完了タスクに基づき、ユーザーが後から自分の1日を手応えも反省も含めて客観的・具体的に振り返るためのNotion日報（Markdown形式）を作成してください。

【本日のユーザー発言ログ】
${logsSummary || 'ログなし'}

【本日完了したタスク】
${tasksSummary || '完了タスクなし'}
${inputsSummary ? `\n【本日消化したインプットストック】\n${inputsSummary}\n` : ''}
【現在の体調・環境コンテキスト】
- 天気・気温: ${memory.weather_info}
- 気圧アラート: ${memory.pressure_alert}
- 直近サマリー: ${memory.weekly_summary}

【前提知識（固有名詞・家族・用語の誤認防止用 ※当日ログに登場した言葉の理解にのみ使用し、無関係な情報を日報に混ぜないこと）】
- プロファイル: ${memory.profile || '未設定'}
${relevantDict ? `- 関連用語定義:\n${relevantDict}\n` : ''}
【日報作成の厳守ルール】
1. ユーザー発言に基づく事実記録（AI側の推測・創作・体調捏造の完全禁止）:
   - 日報は「ユーザーがその日何を体験し、何を感じ、何を考えたか」の客観的記録です。
   - ユーザー自身が発言していない体調・感情・出来事（例: 「腰や腕に負担がかかった」「首肩が凝った」など）を勝手に補完・創作することは厳禁です。
   - ユーザーがAI（秘書システム）の振る舞い・仕様に対して行った指摘・修正指示（例: 「休日判定ロジック修正」「ブリーフィングが重複している」等）を、「ユーザー自身の気づき」のように美談化することは厳禁です。AIの仕様改善に関するやり取りは「生活伴走システムの調整を行った」程度の客観的事実にとどめてください。
2. 経緯が自立して理解できる具体性の維持（過度な短縮・意味不明な造語要約の禁止）:
   - 箇条書きを短くしすぎて「何がどういう事情で起きたのか」が分からなくなる要約は禁止です。数ヶ月〜数年後に本人が読み返しても、前後の文脈なしに状況や経緯が完全に理解できる具体性（理由・経緯・結果）を残してください。
   - ❌ 悪い例（要約しすぎ）: 「妹が椅子を買い替えたため、父の椅子を自室へ搬入」「椅子の玉突きスライド」
   - ⭕ 良い例（経緯が自立して理解できる記述）: 「妹（早希）の椅子買い替えに伴い、妹の旧チェアを父へ、父の大型チェアを自分へ譲り受ける形で仕事部屋へ搬入完了（ドアを通るか心配だったが無事通過）」
   - ❌ 悪い例（要約しすぎ）: 「アプリ『ぱずぎり』のアプデ導線トラップにクスッと笑いつつガチャ挑戦（今剣は出ず）」
   - ⭕ 良い例（具体性が残る記述）: 「『刀剣乱舞 ぱずぎり』でアップデートボタンを押したところ、ぱずぎりではなく『刀剣乱舞』本家のストアページに飛ばされるというまさかの導線ミスに遭遇しつつ、ガチャでは今剣を狙うも今回はお預け」
3. 物語化・講評・オチ付けの完全禁止（※最重要）:
   - 「〜な充実感と達成感に満ちた1日でした」「〜激闘と生活感の入り混じるメリハリある休日でした」といった、全体の講評・感想・物語的なオチ付け文は一切書かないでください。
   - 出来事の事実と、ユーザー自身が言及した思考（嬉しかったこと、反省、やり残し、代償など）をありのまま記録することに徹してください。
4. 散文ポエムの禁止・箇条書き主体のコンパクトな構成:
   - ダラダラとした長文エッセイではなく、トピック別の箇条書き（1項目1〜2文程度）で記述し、後から数秒で一覧できる視認性を保ってください。
5. 写真の選別と埋め込み（任意・特筆すべき画像のみ）:
   - ログ内に \`[投稿画像URL: https://...]\` が含まれており、その中に「食事・料理の写真」「お出かけ先の風景」「購入したアイテム・ジャケット写真」「記念になるスクリーンショット」など、日記の思い出として残す価値がある画像があれば、該当する話題の直下に **独立した1行** として \`![写真の簡潔なキャプション](画像URL)\` の形式で埋め込んでください。
   - 単なるシステム確認用のスクショなど、振り返りに不要な画像は埋め込まなくて構いません（毎回必ず埋め込む必要はありません）。
6. 「明日への引き継ぎメモ」は出力しない:
   - この日報は月末に月報として振り返るためのアーカイブであり、翌日のAIコンテキストには読み込まれないため、「明日への引き継ぎメモ」セクションは作らないでください。

【日報フォーマット要件】
- # ${dateStr} デイリージャーナル
- ## 今日のハイライト
  （その日の重要なトピックや進捗を3点、箇条書きで端的に記述。※「〜な1日でした」等のまとめ文は書かない）
- ## 完了タスク・消化インプット
  （本日完了したタスクおよび消化したインプットストックを箇条書きで一覧化）
- ## 主な出来事・活動の記録
  （トピックごとに太字で見出しをつけ、各項目1〜2文の箇条書きで経緯と結果を自立して記述。必要に応じて \`![キャプション](URL)\` で写真を挿入）
  例:
  - **カテゴリ名**:
    - 具体的なエピソード1（理由・経緯・結果を含む）
    - 具体的なエピソード2
- ## 本人の気づき・翌日への意識
  （ユーザー自身が反省・心残り・翌日やりたいこと等に言及していれば箇条書きで記録。言及がなければセクションごと省略）
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用して見やすく記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  return fetchGeminiTextWithRetry(requestPayload);
}

/**
 * 深夜バッチ用: 当日ログから中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新
 * @param {Array<Object>} logs
 * @param {string} currentCycleStamps
 * @param {string} currentWeeklySummary
 * @param {string} currentRollingMemory
 * @param {string} currentProfile
 * @param {string} currentDictionary
 * @param {string} targetDateStr
 * @return {Object} { cycle_stamps: string, weekly_summary: string, rolling_memory: string, profile: string, dictionary: string }
 */
function analyzeMemoryUpdates(logs, currentCycleStamps, currentWeeklySummary, currentRollingMemory, currentProfile, currentDictionary, targetDateStr) {
  let logsSummary = logs.map(l => `${l.sender}: ${l.message}`).join('\n');

  const prompt = `あなたは生活伴走アシスタントです。本日（${targetDateStr}）の会話ログを分析し、中長期記憶（直近活動バッファ、周期イベント、生活サマリー、プロファイル代謝、用語辞書）を更新してください。

【既存の直近活動バッファ (rolling_memory: 最大10日分)】
${currentRollingMemory || 'なし'}

【既存のプロファイル】
${currentProfile || '未設定'}

【既存の用語辞書・前提知識】
${currentDictionary || 'なし'}

【既存の周期イベント記録】
${currentCycleStamps || 'なし'}

【既存の直近サマリー】
${currentWeeklySummary || 'なし'}

【本日の会話ログ】
${logsSummary || 'ログなし'}

【更新ルール】
1. rolling_memory（超重要・活動関心バッファ）:
   - 本日の日付（${targetDateStr}）で、本日の活動・出来事・関心を漏らさず記録してください。
   - 【記録すべき2大要素】:
     ① 生活・体調・食事・買い物・生活タスク（睡眠や体調の波、購入品、翌日予定など）
     ② 触れたエンタメ・作品・音楽・ゲーム・趣味（作品名・アーティスト名・ゲームタイトル等の固有名詞、ゲームタスク、プレイや視聴時の感想・評価など）
   - 【過度な圧縮の禁止】: ここに記録された関心は将来プロファイルへ昇格するかどうかの重要な判定材料となるため、文字数制限を理由に作品名や感想を削ぎ落とさないでください（1行に無理に収めず、2〜3文や複数行になっても構いません）。
   - 既存のrolling_memoryの末尾に追加し、全体で直近7〜10日分を超えた古い日付のブロックは自動で押し出し削除（忘却）してください。
2. profile（長期記憶・支援前提条件）の格上げ・新陳代謝ルール（★厳格かつ保守的に運用すること）:
   - 目的: プロファイルは「生活基盤（住居・家族・勤務）と、日々のタイムマネジメント・行動支援に必要な前提条件」を保持する場所です。
   - 【格上げ（昇格）の3大条件】以下のいずれかを満たした場合のみ、プロファイルへの追記・反映を許可します：
     ① 恒久的な生活基盤・住まいに関する客観的事実: 住居・家族構成・最寄り駅・勤務形態などの恒久的事実（1回の言及でも即反映）。
     ② rolling_memory内での定着（習慣・体質・ルーティン・趣味）: 直近7〜10日分のrolling_memoryの中で「3日以上言及されている」行動・体質・ルーティン・趣味関心（例: 慢性的な体質対策、一定期間継続してプレイしているゲームや趣味など）。7〜10日の中で1〜2日触れただけのものは一過性のものとして格上げせず、rolling_memoryに留めてください。
     ③ ユーザーによる明示的な宣言: 「これを日課にする」「ライフワークとして続ける」「プロファイルに覚えておいて」と本人が明言した場合。
   - 【具体的数値・支援前提の保護】: 移動所要時間や身支度・メイク時間のようなスケジュール支援に直結する具体的数値・条件を、性格表現（「〜なタイプ」等）のように勝手に要約・抽象化・削除することは固く禁じます。
   - 【原則維持】上記①〜③の条件を満たす明確な事実がない限り、既存プロファイルの文章・数値をそのまま一字一句維持して返してください。
3. cycle_stamps（数週間〜数ヶ月単位の周期メンテナンス ＆ 能動的音楽スキルアップの最終実施記録）:
   - 目的: 次回のお手入れ時期や、音楽スキルアップの直近実施状況を把握・リマインドするための日付スタンプ（カンマ区切りまたは改行区切りの「項目名: YYYY-MM-DD」形式）です。
   - 対象カテゴリ:
     ① 生活・機材メンテナンス: 「爪切り」「美容院・ヘアカット」「歯科健診・定期通院」「シーツ等寝具の洗濯」「楽器弦の全交換」「機材メンテ」など、身体・生活環境・機材の全体的・本格的な定期メンテナンス。
     ② 能動的音楽スキルアップ: ユーザーが当日の会話ログで以下のスキルアップを行ったことが確認できた場合、該当項目の日付を当日（${targetDateStr}）に更新（または新規追加）してください：
       - \`ピアノ演奏: YYYY-MM-DD\`
       - \`ギター演奏: YYYY-MM-DD\`
       - \`トロンボーン演奏: YYYY-MM-DD\`
       - \`楽曲制作: YYYY-MM-DD\`（オリジナル/アレンジ含む）
       - \`打ち込み再現・耳コピ: YYYY-MM-DD\`
       - \`チャート楽曲分析・ルーツ逆引き: YYYY-MM-DD\`
       - \`スケッチ（30分/1時間）: YYYY-MM-DD\`
   - 【絶対除外ルール】:
     ① 日常の軽微なお手入れや部分ケア（例: 引っ掛かりがあった爪1本だけを削った、気になる枝毛を切った）は cycle_stamps には絶対に記録しないでください。
     ② このような局所的ケアや応急処置はすべて 1 の rolling_memory のみに記録し、cycle_stamps には追記せず既存の記録をそのまま維持してください。
4. weekly_summary: 直近数日間の疲労・睡眠・メンタル状況の推移を100文字程度で簡潔にまとめてください。
5. dictionary（用語辞書・客観的前提知識）:
   - 既存の用語辞書の内容を基本として維持してください。
   - 【客観的事実・定義に限定】: 百科事典や用語集のように、客観的事実・作品定義・属性・誤認防止の注意点のみを記述してください。「ユーザーが好んでいる」「楽しみにしている」等の主観的感情や評価は辞書に含めてはなりません。
   - 会話ログの中で、ユーザーが独自の用語、新出ゲーム・作品、オリジナル創作の設定・意味などを説明・定義していた場合、または明示的に「覚えておいて」と伝えた場合、「単語名（別名）: 客観的な定義・属性」の形式で辞書に追記してください。
   - 単にタイトル名が会話に出ただけのものは追加せず、ユーザーがその意味・内容・属性を説明した場合のみを追加してください。

【出力形式】JSONのみ
{
  "rolling_memory": "更新された直近7〜10日分の活動バッファ（改行区切り箇条書き）",
  "profile": "新陳代謝・更新されたプロファイル文字列",
  "cycle_stamps": "更新された周期イベント文字列",
  "weekly_summary": "100文字程度の直近生活サマリー",
  "dictionary": "更新された用語辞書文字列（改行区切り）"
}`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  try {
    let cleaned = fetchGeminiTextWithRetry(requestPayload);
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log('メモリー更新解析失敗: ' + e.message);
    return {
      rolling_memory: currentRollingMemory,
      profile: currentProfile,
      cycle_stamps: currentCycleStamps,
      weekly_summary: currentWeeklySummary,
      dictionary: currentDictionary
    };
  }
}

/**
 * 毎月1日用: 前月の日報集約テキストから月間ハイライト・思い出ジャーナルを生成
 * @param {string} monthlyDataText 前月日報の集約テキスト
 * @param {string} monthStr YYYY-MM
 * @param {string=} dictionaryText 用語辞書テキスト
 * @return {string} Markdown月報
 */
function generateMonthlyJournalMarkdown(monthlyDataText, monthStr, dictionaryText) {
  const relevantDict = (dictionaryText && typeof filterRelevantDictionaryEntries === 'function')
    ? filterRelevantDictionaryEntries(dictionaryText, monthlyDataText)
    : (dictionaryText || '');

  const prompt = `あなたはサウンドディレクター専属の生活伴走アシスタントです。前月（${monthStr}）の日報記録をもとに、Notionに保存する「月間ハイライト＆思い出ジャーナル」を作成してください。

【前月の日報集約データ】
${monthlyDataText}
${relevantDict ? `\n【関連用語定義（固有名詞・作品・プロジェクトの誤認防止用）】\n${relevantDict}\n` : ''}
【月報作成ルール】
1. 客観的な事実記録（前半）と主観的な総括・メッセージ（最後）の明確な分離:
   - 前半の振り返りセクション（ハイライト・成果・クリエイティブ・生活リズム）は、事実や具体的なエピソードを箇条書き主体で整理し、AIの勝手なポエムや講評を混ぜないでください。
   - AIからの親身な総括ストーリーや来月への展望・エールといった主観的なコメントは、最後の「💬 秘書からの総括＆来月へのメッセージ」セクションに集約してください。
2. 具体的なエピソードの保持:
   - 抽象的なまとめだけでなく、その月にあった印象的な出来事、楽しんだ作品・ゲーム、食事や暮らしの具体的なエピソードが生き生きと思い出せるように記述してください。
3. 思い出の写真の選別と埋め込み（任意）:
   - 日報集約データの中に \`![キャプション](https://...)\` 形式の画像が含まれており、その月のハイライトや思い出として象徴的なものがあれば、該当する話題の直下に **独立した1行** として \`![キャプション](画像URL)\` の形式で適宜埋め込んでください（無理にすべて埋め込む必要はなく、印象的なものを厳選してください）。

【ジャーナル構成要件】
# ${monthStr} 月間ハイライト＆思い出ジャーナル
- ## 📅 今月のハイライト（事実ベース）
  （その月の象徴的な出来事やトピックを客観的な事実ベースで箇条書きで整理）
- ## 🏆 完了した主要プロジェクト・タスク
  （仕事・システム開発・生活面などで達成した主な成果やタスクの記録）
- ## 🎨 クリエイティブ＆インプット（音楽・映画・読書・ゲーム・制作の具体的な記録）
  （触れた作品・ゲーム・音楽や、自身の制作・演奏活動の具体的なエピソード記録）
- ## 🌿 心身・健康・生活のリズム
  （睡眠・体調の波や、セルフケア・暮らしの傾向の客観的振り返り）
- ## 💬 秘書からの総括＆来月へのメッセージ
  （1ヶ月間の歩みに対する秘書からの温かい総括ストーリーと、来月に向けた親身な展望・メッセージ）
※見出し、箇条書き（\`- \`）、太字（\`**強調**\`）、区切り線（独立行の \`---\`）を活用し、読みやすいMarkdown形式で記述してください。`;

  const requestPayload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  return fetchGeminiTextWithRetry(requestPayload);
}

/**
 * 開発・デバッグ用: Gemini APIの接続テスト
 * GASエディタでこの関数を選択して実行すると、APIキーやエンドポイントの疎通確認が可能です。
 */
function testGeminiConnection() {
  const config = getConfig();
  Logger.log('Gemini API Key 確認: ' + (config.geminiApiKey ? config.geminiApiKey.substring(0, 6) + '...' : '未設定'));
  
  try {
    const res = callGeminiFlash('こんにちは！テストです。', [], '【コンテキスト】\nテスト実行中', '');
    Logger.log('Gemini API 呼び出し成功！');
    Logger.log('AI返答: ' + JSON.stringify(res, null, 2));
  } catch (e) {
    Logger.log('Gemini API 呼び出し失敗: ' + e.message);
  }
}

