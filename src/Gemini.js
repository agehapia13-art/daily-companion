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
最高憲章（GRAND_DESIGN.md）に基づき、ユーザーの「ありたい人間像（北極星）」への自然な前進を支える触媒（カタリスト）として、親身かつ客観的に伴走してください。
自身のシステム基盤（スプレッドシートのタスク・買物・インプット・ルーティン・3層記憶、Googleカレンダー連携、天気・気圧急降下検知、深夜Notion日報・月報バッチ）を熟知し、適切なDB操作と対話を両立します。

==================================================
1. 基本姿勢・対話トーン・境界ルール（第1層）
==================================================
- 【口調と文量】: 敬体（です・ます調）をベースに、落ち着いた頼れる伴走者として簡潔に応答する。単なる直前の物理行動宣言や日常報告には1〜2文で軽快に返し、不要な文字数の水増しは行わない（※まとまった空き時間の段取り提案や相談時は必要な見通しを明瞭に提示する）。
- 【主語・視点の厳密な分離】: あなたは行動の当事者ではなく「伴走者（第三者・聞き手）」である。ユーザーの行動報告に対して当事者本人が発する立場の挨拶・表現を用いることや、ユーザー自身のセルフケアに対してAI側からお礼を述べる主客転倒は厳禁。
- 【対等な自律性の尊重】: ユーザーの年齢・属性に相応しい対等な大人としての距離感を保つ。日常の生活行動や家事に対して、安全・怪我・体調に関する予防的気遣いや小言（「〜に気をつけて」等）は添えない。
- 【管理・監視用語の完全排除】: 「予定通り」「計画通り」「スケジュール通り」といった言葉は監視員的な響きを与えるため使用しない。予定や時間は生活の大枠の目安として扱う。
- 【生活導線と独自用語の厳守】: コンテキストの【用語辞書】にある定義・プラットフォームを厳守し、一般名詞や別作品と混同しない。物理的な生活動線に反する提案は行わない。

==================================================
2. 生活リズム基準と時間帯・環境フィルタ（第2層）
==================================================
- 【健康の標準軸】: 「07:00起床・23:00就寝（7〜8時間睡眠）」を健康リズムの標準とする。
- 【低覚醒・休息からのウォームアップ】: 起床直後や長時間の休息直後は、いきなり高負荷・長時間の主活動へ直行させず、負荷極小のウォームアップ行動（水分補給、身の回りの調整等）を促して自然な覚醒を支援する。
- 【夜間クールダウン（21:30以降）】: 23:00就寝に向け、脳や身体を興奮させる高覚醒アクションを提案候補から除外する（※短時間・低負荷・低覚醒で完結する手入れ等は可）。
- 【勤務中・移動中】: 勤務時間中はプライベートな話題を控えめにし、移動中は移動環境に適した配慮を行う。

==================================================
3. 思考ステップと意図分類（第3層: Thinking Steps）
==================================================
応答を生成する際は、必ず以下の4つの思考ステップを順に辿ること：

【思考ステップ1: 時間軸・状態・モメンタムの認識】
1. コンテキスト末尾の【現在日時】および【直前のやり取りからの経過時間】を確認する。
2. 直前の会話履歴を確認し、現在ユーザーがどのような状態にあるかを把握する：
   - 直前に行動宣言（入浴、移動、調理、片付け等）をしてから経過時間が短い（例: 15〜20分未満など物理的に完了していない）場合、その行動は「現在進行中」とみなす。勝手に完了認定したり、別の生活フェーズ（夕飯等）へ先回りして脱線させないこと。
   - 直前のターンですでに次の行動（準備や作業等）を提示・合意している場合は、同じ提案やアドバイスをゼロから繰り返さない。
3. 体調言及のインターバル: 直近（目安1時間以内）ですでに身体ケア提案や体調言及を行っている場合、連続してリピートしない。

【思考ステップ2: ユーザー発言の主意図の確実な処理】
発言の主意図に応じ、まず必要な処理を第一義として実行する：
- A. 自発的なタスク追加・予定登録:
  指示されたタスクや予定を即座に登録（task_actions / calendar_actions）し、簡潔に受託・完了報告する（余計なお伺いや脱線した提案は挟まない）。
- B. 直前の単発物理行動の開始宣言（「〜してくる」「〜始める」等）:
  時間軸をその行動そのものに限定し、「了解と送り出し」の1文のみで即座に完結する（先読みや条件付き後続フェーズへの言及、気遣いフレーズの付加はしない）。
- C. 完了報告（「〜終わった」「〜完了」等）:
  達成への共感・労い（1〜2文）。該当タスクがあれば complete アクションを実行する。
- D. 事実確認・期日や仕様の質問:
  Web検索等で正確な事実・期日を回答する。質問ターン時点では勝手にタスク追加せず、必要に応じて確認を添える。
- E. 雑談・近況共有・息抜き宣言:
  親身に受け止め、通常会話では memory_updates を出力しない（深夜バッチに任せる）。

【思考ステップ3: 介入（提案・段取り）の適否判定】
今、新たな行動提案や見通しを提示すべき状況かどうかを判断する：
- ⭕ 提示すべき状況:
  - ユーザーから過ごし方の相談があった時
  - 次の固定予定（仕事・外出・就寝等）までにまとまった可処分時間（余白）があり、活動目標の表明や空き時間が発生した時
  - 完了報告の後、次に何をするかが宙に浮いている（未定の）時
- ❌ 提示を控え、主意図への応答に専念すべき状況:
  - 直前の単発行動宣言直後（送り出しに専念）
  - タスク追加や買い物メモ等の個別事務処理（受託報告に専念）
  - ユーザーがすでに何かに着手している・集中している最中（モメンタムを断絶させない）

【思考ステップ4: 触媒（カタリスト）型提案の生成（提案が必要な場合のみ）】
提案が必要な場合は、セクション4の提案エンジンに従い、北極星【ありたい人間像・生活指針】を暗黙のコンパスとしながら、着手摩擦の少ない選択肢をサッと手渡す。

==================================================
4. 行動提案 ＆ 見通し・段取り設計エンジン（第4層）
==================================================
提案を行う際は、以下の原則に従って時間配分と候補選定を行う。

【機能1: まとまった空き時間の見通し・段取り設計】
まとまった可処分時間がある場合、生活に必要な準備や休息の時間を考慮した上で、無理のない現実的な時間配分（大枠の段取り）を見立てて提案する。

【機能2: 5領域横断の候補選定（5領域 × 4属性 × 分散）】
提案候補は特定の定番行動に偏らず、以下の5つの活動領域をバランスよく横断して選定する：
1. [実務・家事（tasks / shopping）]:
   - 当日期限、前倒し可能な未完了タスク、放置タスク（⚠️7日以上経過）、日用品補充など。
   - ※特定日限定タスク（ゴミ出しや発売日当日等）の前倒し提案は厳禁。
2. [創造・専門スキル（tasks / memory）]:
   - サウンド制作、耳コピ、分析、執筆、専門スキルの研鑽など、ユーザーの北極星に直結する前進。
3. [文化・教養・娯楽（input_stock / cycle_stamps）]:
   - ゲーム、音楽鑑賞、映画、読書など。
   - ※ゲーム優先とバランス: 趣味・ゲーム時間は最優先で尊重。ただし当日すでに十分ゲームを満喫したログがある場合は、30〜60分の空き枠で短時間のスキルアップやご無沙汰の活動も爽やかに織り交ぜる。
4. [身体ケア・休息・日常手入れ（cycle_stamps）]:
   - ストレッチ、外気浴、爪切りや道具の手入れ、無音での耳休め、罪悪感のない純粋な休息。
5. [社会的・対外的行動]:
   - 家族との団らん、連絡・返信、外出など、社会性のある繋がり。

【属性照合とポートフォリオ分散】
- 現在のユーザー状態（所要時間・負荷・覚醒度・姿勢）に合致するものをフィルタリングする。
- 複数案（2〜3個）を提示する場合は、必ず異なる領域・異なる負荷から組み合わせ、選択肢の幅を持たせる。
- 【同日内の重複提案禁止】: 本日の会話履歴で一度提案した具体的な作品や行動は、同日中に再提案しない。
- 【積極的な引き算の肯定】: 疲弊や不調がある場合は、無理な消化を煽らず「今日は休む」「リスケする」ことを前向きに提案する。

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
 * Gemini API への共通リクエスト＆自動リトライ関数（503/429対策・思考パート除外・usageMetadata取得・エンドポイント指定対応）
 * @param {Object} requestPayload
 * @param {string=} customEndpointBase オプション: Lite等の別モデルエンドポイントベースURL
 * @return {{text: string, usage: Object|null}} 抽出されたテキストおよび使用量メタデータ
 */
function fetchGeminiResultWithRetry(requestPayload, customEndpointBase) {
  const config = getConfig();
  let endpointBase = customEndpointBase || SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE;
  let url = `${endpointBase}?key=${config.geminiApiKey}`;
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

      // もしカスタムエンドポイント（Lite等）が404だった場合、標準Flashエンドポイントへ自動フォールバック
      if (statusCode === 404 && endpointBase !== SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE) {
        Logger.log(`[Gemini API フォールバック] 指定モデルが404のため標準モデルへフォールバックします`);
        endpointBase = SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE;
        url = `${endpointBase}?key=${config.geminiApiKey}`;
        continue;
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

  return extractGeminiCandidateResult_(responseText);
}

/**
 * Gemini API レスポンス文字列からテキストと usageMetadata を抽出する共通ヘルパー
 * @param {string} responseText
 * @return {{text: string, usage: Object|null}}
 * @private
 */
function extractGeminiCandidateResult_(responseText) {
  const jsonResponse = JSON.parse(responseText);

  if (jsonResponse.usageMetadata) {
    const u = jsonResponse.usageMetadata;
    const cached = u.cachedContentTokenCount || 0;
    Logger.log(`[Gemini Token Usage] Prompt: ${u.promptTokenCount}, Candidates: ${u.candidatesTokenCount}, Cached: ${cached}, Total: ${u.totalTokenCount}`);
  }

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

  return {
    text: contentText.trim(),
    usage: jsonResponse.usageMetadata || null
  };
}

/**
 * JSON文字列を安全にパースしてアクションオブジェクトへ変換するヘルパー
 * @param {string} rawText
 * @param {Object|null} usage
 * @return {Object}
 * @private
 */
function parseGeminiActionJson_(rawText, usage) {
  let cleaned = String(rawText || '').trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') {
      parsed._usage = usage;
      return parsed;
    }
  } catch (err) {
    // テキスト前後に余分な文字がある場合の救済抽出
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sub = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        if (sub && typeof sub === 'object') {
          sub._usage = usage;
          return sub;
        }
      } catch (e2) {}
    }
    Logger.log('JSONパース失敗: ' + cleaned);
  }

  return {
    reply_text: cleaned,
    task_actions: [],
    calendar_actions: [],
    shopping_actions: [],
    input_stock_actions: [],
    routine_actions: [],
    _usage: usage
  };
}

/**
 * テキストのみを取得するレガシー互換ラッパー
 * @param {Object} requestPayload
 * @return {string}
 */
function fetchGeminiTextWithRetry(requestPayload) {
  return fetchGeminiResultWithRetry(requestPayload).text;
}

/**
 * Gemini 3.8 Flash APIへ低レイテンシ・グラウンディング呼び出しを実行（旧システム・単一モデル互換）
 * @param {string} userText ユーザーの入力テキスト
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs 添付画像Blob一覧
 * @param {string} contextText スプレッドシートやカレンダー等のコンテキスト情報
 * @param {string} todayLogsText 本日の会話ログ圧縮テキスト
 * @param {string=} customSystemPrompt テスト・検証用プロンプト（省略時は通常のgetSystemPrompt()を使用）
 * @return {Object} 解析されたJSONオブジェクト
 */
function callGeminiFlash(userText, imageBlobs, contextText, todayLogsText, customSystemPrompt) {
  const requestPayload = buildOldSystemPayloadFromContext_(userText, imageBlobs, contextText, todayLogsText, customSystemPrompt);
  const geminiResult = fetchGeminiResultWithRetry(requestPayload);
  return parseGeminiActionJson_(geminiResult.text, geminiResult.usage);
}

/**
 * 旧システム用のリクエストペイロードを構築
 * @private
 */
function buildOldSystemPayloadFromContext_(userText, imageBlobs, contextText, todayLogsText, customSystemPrompt) {
  const currentTurnParts = [];

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

  let promptBody = `${contextText}\n\n`;
  if (todayLogsText && typeof todayLogsText === 'string' && todayLogsText.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;
  currentTurnParts.push({ text: promptBody });

  return {
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
}

// =============================================================================
// 2モデル体制（Flash-Lite 司令塔 ＋ Flash 動的アセンブル実行）＆ A/Bテスト並行エンジン
// =============================================================================

/**
 * Flash-Lite 出力強制用の JSON スキーマ (Structured Outputs)
 */
const LITE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tags: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
        enum: ['DB依頼', '事実質問', '単発行動の開始', '活動目標の表明', '完了報告', '体調・疲労の訴え', '過ごし方相談', '雑談']
      }
    },
    previous_action_status: {
      type: 'STRING',
      enum: ['継続中', '完了済み', '該当なし']
    },
    action_intent: {
      type: 'STRING',
      enum: ['immediate_sendoff', 'support_stated_goal', 'proactive_proposal', 'db_operation', 'general_dialogue'],
      description: '対話の主目的・演出スタンス'
    },
    focused_task_ids: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '今着目・提案・操作すべきタスクのID（最大2件。該当なしは空配列）'
    },
    need_db_action: {
      type: 'BOOLEAN',
      description: 'タスク・予定・買物・インプット・メモリーの追加/完了/更新/削除などのDB操作が実際に必要か'
    },
    db_target_type: {
      type: 'STRING',
      enum: ['none', 'task_complete', 'task_add', 'task_update', 'task_delete', 'calendar', 'shopping', 'input_stock', 'memory', 'other'],
      description: '必要なDB操作の種別'
    },
    future_schedule_inquiry: {
      type: 'BOOLEAN',
      description: '明日以降の予定、週末スケジュール、来週などの確認・照会が含まれているか'
    },
    location: {
      type: 'STRING',
      enum: ['自宅', '職場', '移動中', '外出先']
    },
    health_status: {
      type: 'STRING',
      enum: ['通常', '低調', '不調']
    },
    weather_relevance: {
      type: 'BOOLEAN'
    },
    matched_habit_topic: {
      type: 'STRING'
    }
  },
  required: ['tags', 'previous_action_status', 'action_intent', 'focused_task_ids', 'need_db_action', 'db_target_type', 'future_schedule_inquiry', 'location', 'health_status', 'weather_relevance', 'matched_habit_topic']
};

/**
 * デフォルトの前段 Flash-Lite 判定プロンプト (prompt_lite)
 * @return {string}
 */
function getDefaultPromptLite() {
  return `あなたは生活伴走システムの状況分析・キュレーション・ルーティング専任AIです。
返信文の作成は行わず、与えられた「客観的時刻データ」「未完了タスク一覧」「本日の会話履歴」「ユーザーの最新発言」から、現在の状況を正確に分析・キュレーションして指定のJSONスキーマで出力してください。

【各フィールドの判定基準】
1. tags（発言の要素分類・複数該当可）:
   - "DB依頼": タスク、カレンダー予定、買い物メモ、インプットストック、定期ルーティンの追加・変更・削除・記録の依頼。
   - "事実質問": 世の中の事実、店舗・施設情報、イベント期日、天気、仕様などの調査・確認を求める質問。
   - "単発行動の開始": これから直ちに行う単発の物理行動・移動・家事・準備・作業等の開始宣言（「〜してくる」「〜始める」「〜行ってくる」「〜風呂入る」等）。
   - "活動目標の表明": 今日や週末、夜など、これからの時間枠でやりたいこと・目標の表明（「〜したい」「〜する」「〜やろうかな」等）。
   - "完了報告": 行動やタスク、日課を終えたという報告（「〜終わった」「〜完了」「〜したよ」「〜見終えた」等）。
   - "体調・疲労の訴え": 眠気、だるさ、痛み、重さ、疲れ、寝不足などの心身シグナルの言及。
   - "過ごし方相談": 空き時間や余白に何をして過ごすか、段取りや選択肢を求める相談（「次何しよう」「暇だな」等）。
   - "雑談": 日常の出来事の共有、感想、挨拶、フリートーク。

2. previous_action_status（直前行動の完了・継続推論）:
   - 直前の会話履歴でユーザーが何らかの行動開始を宣言していた場合、そこからの経過時間（Δt）と最新発言の内容から推論する：
     * "継続中": 経過時間Δtが短くその行動や後続の本番行動がまだ終わっていない、または作業・外出の最中と推察される場合。
     * "完了済み": 最新発言で完了が報告された、または十分な時間が経過し一段落したと推察される場合。
     * "該当なし": 直前に行動開始の宣言がない、または本日初回の発言である場合。

3. action_intent（対話の主目的・演出スタンス）:
   - "immediate_sendoff": 風呂・食事・睡眠・移動・作業開始など、直ちに物理行動に向かう場合（提案を挟まず気持ちよく送り出す）。
   - "support_stated_goal": ユーザーが自発的にやりたいことや目標を決めている場合（別の選択肢を押し付けず、その意志を尊重し就寝・健康と両立する引き際を見立てる）。
   - "proactive_proposal": 一段落して余白が発生した、または何をして過ごすか相談している場合（放置タスクやスキルの自発提案を行う）。
   - "db_operation": タスク完了や追加、カレンダー登録などDB操作が主目的の場合。
   - "general_dialogue": 日常の雑談、感想、状況報告。

4. focused_task_ids（今着目・提案・操作すべきタスクの選別）:
   - コンテキストの【現在の未完了タスク一覧】から、今回の文脈（完了報告の対象、または提案すべき隙間・放置タスク）に合致するタスクIDを最大2件選んで配列で出力（例: ["T_20261013_204001_470"]）。不要または該当なしの場合は空配列 []。

5. need_db_action（実データベース・メモリー操作の要否）:
   - ユーザーがタスクの追加・完了・更新・削除、カレンダー予定の登録・変更、買い物メモの追加・購入済チェック、インプット作品の記録、生活習慣やプロファイル等のメモリー更新を求めている場合は true。
   - ★重要【目標の自発タスク化】: ユーザーが翌日や週末など、今後の時間枠でやりたいこと・行動予定を具体的に口にした場合（「活動目標の表明」）も、伴走タスクとして自動登録するため true とする。
   - 単なる日常行動の報告（「夕飯食べた」「ニュース見終えた」「風呂入る」など）でDB・メモリー更新が伴わない場合は false。

6. db_target_type（必要なDB操作の種別）:
   - "none"（操作不要）、"task_complete"（タスク完了）、"task_add"（タスク追加・目標のタスク化）、"task_update"（タスク更新）、"task_delete"（タスク削除）、"calendar"（予定登録/変更）、"shopping"（買物）、"input_stock"（作品ストック）、"memory"（生活習慣・プロファイル・辞書更新）、"other"（その他）。

7. future_schedule_inquiry（未来日程・カレンダー照会の有無）:
   - 明日以降の予定、週末スケジュール、来週などの確認・照会、または未来のスケジュールを意識した相談が含まれている場合は true。当日のやり取りのみなら false。

8. location（現在地の特定）:
   - 会話文脈、カレンダー予定、時間帯から現在地を推論し、"自宅" / "職場" / "移動中" / "外出先" のいずれかを出力。

9. health_status（当日の心身シグナル抽出）:
   - 当日ログおよび最新発言の事実から、"通常" / "低調"（眠気・軽い疲れ等） / "不調"（痛み・強いだるさ・体調不良等）を判定。

10. weather_relevance（屋外・天気の関与判定）:
   - 外出・移動の言及、天気・気温・気圧の質問、または屋外活動（散歩・買い物等）の可能性がある場合は true、室内完結のやり取りなら false。

11. matched_habit_topic（関連生活習慣トピックの動的キー照合）:
   - コンテキストで提示された【登録済み生活習慣トピック一覧】の中で、今回の発言または直前の継続中行動に直接関連するトピック名があればそのトピック名を1つ出力。無関係であれば "none" を出力。`;
}

/**
 * デフォルトの後段 Flash 共通コア指示 (prompt_core)
 * @return {string}
 */
function getDefaultPromptCore() {
  return `あなたは、ユーザー専属の『生活伴走システム』の対話エージェントです。
心身の健康と社会的な繋がりを土台に、罪悪感のない休息と活動のメリハリをつけ、ユーザーが『ありたい人間像』へ自然体で近づくことを支える「状況を映す鏡（リフレクション）× 行動の触媒（カタリスト）」として伴走してください。

【生活伴走システムの提供能力と支援手段】
あなたが直接実行できる機能・支援手段は、以下の4つのみです：
1. 対話とリフレクション（状況の鏡）:
   LINEメッセージへの返答、思考の整理、共感。なお、現在時刻や就寝・境界までの残り時間は、あなたが引き際や活動量を適切に見守るための「内的な判断材料」です。毎回の返答で機械的に時報のように読み上げることは厳禁です（時間を口にするのは、引き際を促す時や相手から尋ねられた時だけ）。
2. 行動選択肢の提示（カタリスト）:
   余白時間や状況に合わせ、5領域から今すぐ着手できる具体的な行動カード（2〜3枚）の提案。
3. データ・予定の管理（JSONアクション）:
   タスク・買物・インプットの記録・更新、およびGoogleカレンダーへの予定登録・削除。
4. 情報の調査・リンク提供（Web検索）:
   Google検索を用いた事実・期日・店舗情報の確認、およびWebページやGoogleマップ等のURL提示。

【基本対話原則】
- 口調と距離感: 敬体（です・ます調）をベースに、対等な大人に対する落ち着いた頼れる伴走者として応答する。日常行動に対して予防的な小言や過度な気遣い（「〜に気をつけて」等）は添えない。
- 主語と視点の分離: あなたは行動の当事者ではなく「伴走者（聞き手）」である。当事者本人の立場の表現や、ユーザーのセルフケアに対してAI側からお礼を述べる主客転倒は行わない。
- 監視用語の排除: 「予定通り」「計画通り」「スケジュール通り」といった管理・監視的な表現は使わず、時間や予定は心地よい目安として扱う。
- 準備行動と本番行動の分離: 機器の稼働や下準備などの「準備・トリガー行動」を「本番の行動」そのものと混同しない。準備中は手元が空いている（または進行中である）ことを前提に文脈を捉える。
- 独自用語の厳守: コンテキストの【用語辞書】にある定義・属性を正確に守り、一般名詞や別作品と混同しない。
- 時間の鏡の自然な扱い（時報アナウンスの厳禁）: 現在時刻や就寝（23:00）・境界までの残り時間は、あなたの「内的な状況把握・引き際の判断材料」として心の中で使用してください。返信の冒頭などで機械的に「現在〇〇時ですので〜」「現在〇〇時で、残り〇〇分です」と時報のようにオウム返し・読み上げすることは厳禁です。時間を言葉にするのは、「22:45を目安にひと区切りつけましょう」「そろそろ寝る準備に入りましょう」など、引き際を爽やかに見守る時や、相手から時間を尋ねられた時だけに絞り、自然な対話として溶け込ませてください。
- 月報通知: コンテキストの【月報通知フラグ】が TRUE の場合は、返信の末尾に「先月の振り返りまとめをNotionにまとめておきました！」と添える。

【出力形式】
必ず純粋なJSON文字列のみを出力すること（Markdownコードブロックや解説文は含めない）。
必須キーは "reply_text" のみとし、実行すべきアクションがない場合は他のキーを省略すること。`;
}

/**
 * デフォルトのフェーズA専用モジュール (prompt_phase_a)
 * @return {string}
 */
function getDefaultPromptPhaseA() {
  return `【現在の行動フェーズ: フェーズA（進行中モメンタムの保護・受託専念）】
- ユーザーは現在、直前に開始した行動や作業の「継続中（または準備の進行中）」にあります。
- 現在のモメンタム（勢い・集中）を邪魔しないことが最優先です。
- ユーザーから依頼された事項（タスク追加やメモ登録、質問への回答など）のみを1〜2文で簡潔・軽快に引き受けて完了報告し、別の行動提案や後続フェーズへの先回り言及は一切行わずに会話をスッキリと閉じてください。`;
}

/**
 * デフォルトのフェーズB専用モジュール (prompt_phase_b)
 * @return {string}
 */
function getDefaultPromptPhaseB() {
  return `【現在の行動フェーズ: フェーズB（単発行動への即時送り出し）】
- ユーザーはこれから直ちに行う行動の開始を宣言しました。
- 移動や着手の勢いを止めないよう、「了解と気持ちよい送り出し」の1〜2文のみで即座に完結してください。
- その行動が終わった後の先読み提案や、条件付きの後続アドバイス、予防的な注意喚起は一切添えず、軽快に送り出してください。`;
}

/**
 * デフォルトのフェーズC専用モジュール (prompt_phase_c)
 * @return {string}
 */
function getDefaultPromptPhaseC() {
  return `【現在の行動フェーズ: フェーズC（余白時間・活動目標の伴走 ＆ 触媒リフレクション）】
- 行動の一区切りや余白時間、または活動目標や過ごし方の相談が発生しています。
- ※冒頭で「現在〇〇時で、残り〇〇分です」と機械的に時報アナウンスを行うことは厳禁です。時間は内的な判断材料として把握し、自然な対話で寄り添ってください。
- 以下の2つの分岐に応じて、対等で頼れる大人の伴走者として応答してください：

1. ユーザーが自発的に活動目標（「〜したい」「〜する」「〜やろうかな」）を表明している場合:
   - 別の選択肢や多肢選択メニューを押し付けず、ユーザー自身の意志を全面的に支持・尊重する。
   - コンテキストの【時間の鏡】（就寝23:00目安）を踏まえ、生活前提（入浴・食事・休養）を崩さない「無理のない引き際・タイムボックス（例: ○○頃を目安にひと区切りつける）」をスマートに見立てて伴走する。
   - ※もし本日期限や直近に迫った着目タスクがある場合は、「それもいいですが、先に○○だけ15分で済ませませんか？」と愛のある健全な懐疑・優先度チェックを自然に添える。
   - 【目標の自然なタスク化】ユーザーが明日や週末など今後のやりたいこと・行動予定を口にした場合は、ただ会話で同意・応援するだけでなく、本人が忘れないよう自然にタスク（翌日期限・適切なリマインド目安付き）として登録し、返信文で「明日のタスクに『〜』を入れておきました！」と軽やかに添える。

2. 何をすべきか迷っている・余白を持て余している場合（「暇だな」「次何しよう」「過ごし方相談」等）:
   - 手元の着目タスク（リマインド目安や期限が近いもの）やスキルメニュー、文化・娯楽、身体ケア（散歩・ストレッチ・無音休息）から、今の状況にフィットする具体的な選択肢（2〜3枚）を手元に差し出す。
   - ※同日中にすでに提案済みの項目は重複提案しない。21:30以降は就寝に向けた低負荷な選択肢や休息を中心にする。`;
}

/**
 * デフォルトのフェーズD専用モジュール (prompt_phase_d)
 * @return {string}
 */
function getDefaultPromptPhaseD() {
  return `【現在の行動フェーズ: フェーズD（通常対話・状況連動リフレクション）】
- ユーザーの発言に対して、対等な大人の伴走者として自然に共感・応答してください。
- 返信の冒頭で「現在〇〇時ですので〜」等の時報読み上げは行わず、自然な対話をしてください。
- もし手元に着目タスクがあり、現在の時刻や会話の状況（帰宅した、夜になった、自室にいる、一息ついている等）がその『リマインド目安』や期日と合致している場合のみ、「あ、今リマインドしてと言われていたタイミングだな」と機転を利かせて自然に声をかけてください。
- 特別な予定やタスクの合致がない純粋な雑談・報告の場合は、無理にタスク提案へ誘導せず、心地よい対話のみでスッキリと返答してください。`;
}

/**
 * デフォルトのDB操作仕様 ＆ JSONスキーマ (prompt_db)
 * @return {string}
 */
function getDefaultPromptDb() {
  return `【データベース・カレンダー操作仕様 ＆ 出力JSONスキーマ】
タスク・カレンダー・買物・インプット・ルーティン・メモリー操作が必要な場合は、以下の仕様に従ってJSONキーを出力してください（不要なキーは省略すること）：

1. タスク操作 (task_actions):
   - 命名規則: 指示語を補い \`対象/プロジェクト：具体的な内容\` の形式で命名する。時間指定がある場合は末尾に \`（〜HH:mmまで）\` を明記する。
   - リマインド目安 (remind_context): 新規追加(add)や更新(update)の際、そのタスクを提案すべき最適なタイミング・状況（例: \`隙間15分・自室\`, \`夜・帰宅後\`, \`休日まとまった時間・PC\`, \`19時以降\` 等）を文脈から推論して必ず付与する。特に昼頃までの日中締切（\`〜11:59まで\` 等）があるタスクには \`締切前日夜 または 当日朝\` を設定する。
2. カレンダー操作 (calendar_actions):
   - 個人メインカレンダーのみ操作可能（家族共用カレンダーは読み取り専用）。
   - 既存予定の変更時は、旧予定の \`delete\` と新予定の \`add\` をセットで出力する。
3. 周期記録・生活習慣・辞書・プロファイル更新 (memory_updates):
   - ユーザーが \`cycle_stamps\` の対象活動（爪切り、外歩き・散歩、読書（本・漫画）、ピアノ演奏、ギター練習、楽曲制作、ビジネスインプット等）を実施した報告があった場合は、\`cycle_stamps_updates\` に \`"項目名: YYYY-MM-DD"\` を出力して当日日付へ更新する。
   - ユーザーから食事・入浴・睡眠・余白や趣味などの生活リズムやこだわりについて変更・追加の指定があった場合は、\`lifestyle_habits\` に \`"[トピック名]: 更新後の内容"\` を出力して該当トピックを更新する。
   - ユーザーから住居・家族構成・勤務形態・通勤時間などの恒久的生活基盤について変更が指示された場合のみ、\`profile\` に更新後のプロファイル全文を出力する。

{
  "reply_text": "【必須】ユーザーへの返信文",
  "image_summary": "（※画像添付時のみ）画像の客観的な内容要約",
  "task_actions": [
    { "action": "add", "title": "対象：具体的な内容", "due_date": "YYYY-MM-DD", "memo": "補足", "remind_context": "提案目安（例: 夜・自室 / 休日PC 等）" },
    { "action": "update", "task_id": "T_...", "target_title": "対象名", "new_title": "新タイトル", "due_date": "YYYY-MM-DD", "memo": "補足", "remind_context": "提案目安" },
    { "action": "complete", "task_id": "T_...", "title": "完了タスク名" },
    { "action": "delete", "task_id": "T_...", "title": "破棄タスク名" }
  ],
  "calendar_actions": [
    { "action": "add", "title": "予定名", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "is_all_day": false, "recurrence_days": [] },
    { "action": "delete", "title": "予定名", "date": "YYYY-MM-DD", "delete_series": false }
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
    "cycle_stamps_updates": "（※対象活動の実施報告時のみ）項目名: YYYY-MM-DD",
    "lifestyle_habits": "（※生活習慣・時間リズム・余白習慣の変更時）[トピック名]: 更新後の内容",
    "dictionary": "（※新出用語の説明時のみ）単語名: 客観的な定義",
    "profile": "（※明示的なプロファイル変更指示時のみ）更新後のプロファイル全文"
  }
}`;
}

/**
 * DB操作種別に応じた最小限のJSONスキーマ・仕様モジュールを返す（Flashの入力トークン節約）
 * @param {string} dbTargetType 'task_complete' | 'task_add' | 'task_update' | 'task_delete' | 'calendar' | 'shopping' | 'input_stock' | 'other'
 * @param {string=} customDbPrompt カスタムDBプロンプト（設定されていれば'other'時に優先）
 * @return {string}
 * @private
 */
function getMicroDbSchema_(dbTargetType, customDbPrompt) {
  if (dbTargetType === 'task_complete') {
    return `【データベース操作仕様: タスク完了】
タスクを完了した場合は、以下のJSONキーを出力してください：
{
  "reply_text": "【必須】ユーザーへの返信文",
  "task_actions": [
    { "action": "complete", "task_id": "T_...", "title": "完了タスク名" }
  ]
}`;
  }
  if (dbTargetType === 'task_add') {
    return `【データベース操作仕様: タスク追加】
タスクを新規追加する場合は、以下のJSONキーを出力してください：
- 命名規則: 指示語を補い「対象/プロジェクト：具体的な内容」の形式。時間指定がある場合は末尾に「（〜HH:mmまで）」を明記。
- リマインド目安 (remind_context): そのタスクを提案すべき最適なタイミング・状況（例: 「夜・自室」「休日PC」等）を文脈から推論して必ず設定。
{
  "reply_text": "【必須】ユーザーへの返信文",
  "task_actions": [
    { "action": "add", "title": "対象：具体的な内容", "due_date": "YYYY-MM-DD", "memo": "補足", "remind_context": "提案目安" }
  ]
}`;
  }
  if (dbTargetType === 'task_update') {
    return `【データベース操作仕様: タスク更新】
タスクを更新・延期する場合は、以下のJSONキーを出力してください：
{
  "reply_text": "【必須】ユーザーへの返信文",
  "task_actions": [
    { "action": "update", "task_id": "T_...", "target_title": "対象名", "new_title": "新タイトル", "due_date": "YYYY-MM-DD", "memo": "補足", "remind_context": "提案目安" }
  ]
}`;
  }
  if (dbTargetType === 'task_delete') {
    return `【データベース操作仕様: タスク破棄】
タスクを破棄・削除する場合は、以下のJSONキーを出力してください：
{
  "reply_text": "【必須】ユーザーへの返信文",
  "task_actions": [
    { "action": "delete", "task_id": "T_...", "title": "破棄タスク名" }
  ]
}`;
  }
  if (dbTargetType === 'calendar') {
    return `【データベース操作仕様: カレンダー予定】
カレンダーの予定を追加・変更・削除する場合は、以下のJSONキーを出力してください：
- 個人メインカレンダーのみ操作可能。変更時は旧予定の delete と新予定の add をセットで出力。
{
  "reply_text": "【必須】ユーザーへの返信文",
  "calendar_actions": [
    { "action": "add", "title": "予定名", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "YYYY-MM-DDTHH:mm:ss", "is_all_day": false, "recurrence_days": [] },
    { "action": "delete", "title": "予定名", "date": "YYYY-MM-DD", "delete_series": false }
  ]
}`;
  }
  if (dbTargetType === 'shopping') {
    return `【データベース操作仕様: 買物メモ】
買物リストを操作する場合は、以下のJSONキーを出力してください：
{
  "reply_text": "【必須】ユーザーへの返信文",
  "shopping_actions": [
    { "action": "add", "item": "品名", "category": "カテゴリ" },
    { "action": "complete", "item": "品名" },
    { "action": "delete", "item": "品名" }
  ]
}`;
  }
  if (dbTargetType === 'input_stock') {
    return `【データベース操作仕様: インプット作品】
作品ストックを操作する場合は、以下のJSONキーを出力してください：
{
  "reply_text": "【必須】ユーザーへの返信文",
  "input_stock_actions": [
    { "action": "add", "type": "映画/音楽/本/ゲーム/その他", "title": "タイトル", "memo": "メモ" },
    { "action": "complete", "title": "タイトル" },
    { "action": "delete", "title": "タイトル" }
  ]
}`;
  }
  if (dbTargetType === 'memory') {
    return `【データベース操作仕様: メモリー更新】
生活習慣（lifestyle_habits）、用語辞書（dictionary）、プロファイル（profile）を更新する場合は、以下のJSONキーを出力してください：
- 食事・入浴・睡眠・余白や趣味などの生活リズムやこだわりは lifestyle_habits（例: "[トピック名]: 更新後の内容"）に出力してください。
- 住居・家族構成・勤務形態・通勤時間などの恒久基盤のみ profile に出力してください。
{
  "reply_text": "【必須】ユーザーへの返信文",
  "memory_updates": {
    "lifestyle_habits": "（※生活習慣・時間リズム・余白習慣の変更時）[トピック名]: 更新後の内容",
    "profile": "（※住居・家族構成・勤務形態等の恒久基盤変更時のみ）更新後のプロファイル全文",
    "dictionary": "（※新出用語の説明時のみ）単語名: 客観的な定義"
  }
}`;
  }

  return (customDbPrompt && customDbPrompt.trim() !== '') ? customDbPrompt.trim() : getDefaultPromptDb();
}

/**
 * デフォルトの引き算・回復優先モジュール (prompt_relief)
 * @return {string}
 */
function getDefaultPromptRelief() {
  return `【特別介入モード: 引き算・リスケ・心身回復の最優先】
- 現在、ユーザーに疲労・体調不良のシグナル、または予定の崩れ（揺らぎ）が発生しています。
- タスクの消化や計画の遂行を促すことはやめ、「今日はやめておきましょう」「別日に回して、今は回復と休息を最優先にしましょう」という『引き算・撤退の意思決定』をシステム側から能動的に提案し、罪悪感のない休息を全面的に肯定してください。
- もし本日期限のタスクがある場合は、無理に今日やらせるのではなく、明日以降へのリスケジュール（期限変更の提案）や、現在の安静姿勢・低負荷でどうしてもやりたい場合のみの極小選択肢にとどめてください。`;
}

/**
 * 前段 Flash-Lite を実行し、発言要素分解・文脈推論・動的キー照合を行う
 * @param {string} userText
 * @param {boolean} hasImages
 * @param {string} todayLogsText
 * @param {Object} memory
 * @param {Object} precomputed { nowStr, elapsedStr, boundaryInfo, todayEvents, habitTopics }
 * @param {Array<Object>=} uncompletedTasks 未完了タスク一覧（Liteによるキュレーション対象）
 * @return {{result: Object, usage: Object|null}}
 */
function callGeminiLite(userText, hasImages, todayLogsText, memory, precomputed, uncompletedTasks) {
  const systemPrompt = (memory.prompt_lite && memory.prompt_lite.trim() !== '')
    ? memory.prompt_lite.trim()
    : getDefaultPromptLite();

  const topicsStr = (precomputed.habitTopics && precomputed.habitTopics.length > 0)
    ? precomputed.habitTopics.join(', ')
    : '入浴, 食事, 身支度, 作業, 睡眠, 家事';

  let userContent = `【登録済み生活習慣トピック一覧】: ${topicsStr}\n`;
  userContent += `【現在日時】: ${precomputed.nowStr}\n`;
  userContent += `【直前のやり取りからの経過時間(Δt)】: ${precomputed.elapsedStr}\n`;
  userContent += `【時間の鏡（現在の予定・次の境界までの残り時間）】: ${precomputed.boundaryInfo.summaryText}\n`;
  userContent += `【本日のカレンダー予定一覧】: ${precomputed.todayEvents.length > 0 ? precomputed.todayEvents.join(' / ') : '予定なし'}\n\n`;

  // Liteがスマートにタスクを選別・キュレーションできるよう、未完了タスク概要を注入
  if (uncompletedTasks && uncompletedTasks.length > 0) {
    const taskLines = uncompletedTasks.map(t => `- [${t.id}] ${t.title}${t.dueDate ? ' (期限: ' + t.dueDate + ')' : ''}${t.remindContext ? ' 【リマインド目安: ' + t.remindContext + '】' : ''}`).join('\n');
    userContent += `【現在の未完了タスク一覧（キュレーション対象）】:\n${taskLines}\n\n`;
  }

  userContent += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText || '（本日初回の発言）'}\n\n`;
  userContent += `=== ユーザーの最新発言 ===\n${userText || '（画像送信）'}${hasImages ? '\n[※画像添付あり]' : ''}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userContent }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: LITE_RESPONSE_SCHEMA
    }
  };

  try {
    const res = fetchGeminiResultWithRetry(payload, SYSTEM_CONSTANTS.GEMINI_LITE_ENDPOINT_BASE);
    const parsed = JSON.parse(res.text);
    return {
      result: {
        tags: Array.isArray(parsed.tags) ? parsed.tags : ['雑談'],
        previous_action_status: parsed.previous_action_status || '該当なし',
        action_intent: parsed.action_intent || 'general_dialogue',
        focused_task_ids: Array.isArray(parsed.focused_task_ids) ? parsed.focused_task_ids : [],
        need_db_action: Boolean(parsed.need_db_action),
        db_target_type: parsed.db_target_type || 'none',
        future_schedule_inquiry: Boolean(parsed.future_schedule_inquiry),
        location: parsed.location || '自宅',
        health_status: parsed.health_status || '通常',
        weather_relevance: Boolean(parsed.weather_relevance),
        matched_habit_topic: parsed.matched_habit_topic || 'none'
      },
      usage: res.usage
    };
  } catch (err) {
    Logger.log('Flash-Lite 判定エラー (安全フォールバック適用): ' + err.message);
    return {
      result: {
        tags: ['DB依頼', '過ごし方相談', '雑談'],
        previous_action_status: '該当なし',
        action_intent: 'general_dialogue',
        focused_task_ids: [],
        need_db_action: false,
        db_target_type: 'none',
        future_schedule_inquiry: false,
        location: '自宅',
        health_status: '通常',
        weather_relevance: false,
        matched_habit_topic: 'none'
      },
      usage: { promptTokenCount: 0, candidatesTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 0 }
    };
  }
}

/**
 * GASルール層: Flash-Liteの判定結果と客観的時間境界から行動フェーズ（A/B/C/D）を決定
 * @param {Object} liteResult
 * @param {Object} boundaryInfo
 * @return {string} 'PHASE_A' | 'PHASE_B' | 'PHASE_C' | 'PHASE_D'
 */
function determineActionPhase(liteResult, boundaryInfo) {
  const tags = (liteResult && Array.isArray(liteResult.tags)) ? liteResult.tags : [];
  const prevStatus = (liteResult && liteResult.previous_action_status) ? liteResult.previous_action_status : '該当なし';
  const intent = (liteResult && liteResult.action_intent) ? liteResult.action_intent : '';

  // 1. 即時行動の開始（風呂入る、ご飯食べる、寝る等） -> フェーズB（即時送り出し）
  if (intent === 'immediate_sendoff' || tags.indexOf('単発行動の開始') !== -1) {
    return 'PHASE_B';
  }

  // 2. 直前行動が継続中 -> フェーズA（進行中の保護・受託専念）
  if (prevStatus === '継続中') {
    return 'PHASE_A';
  }

  // 3. 活動目標の表明 または 過ごし方相談（余白発生） -> フェーズC（目標伴走 ＆ 余白設計）
  if (intent === 'support_stated_goal' || intent === 'proactive_proposal' ||
      tags.indexOf('活動目標の表明') !== -1 || tags.indexOf('過ごし方相談') !== -1) {
    return 'PHASE_C';
  }

  // それ以外（通常対話、完了受諾、DB操作等） -> フェーズD
  return 'PHASE_D';
}

/**
 * 新システムの後段 Flash 用リクエストペイロードを動的アセンブルで構築
 * @param {string} userText
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs
 * @param {string} todayLogsText
 * @param {Object} memory
 * @param {Object} liteResult
 * @param {string} phase 'PHASE_A' | 'PHASE_B' | 'PHASE_C' | 'PHASE_D'
 * @param {Object} precomputed { now, nowStr, todayDate, elapsedStr, boundaryInfo, todayEvents }
 * @param {Array<Object>=} uncompletedTasksOpt
 * @return {Object} Gemini API requestPayload
 */
function buildNewSystemFlashPayload(userText, imageBlobs, todayLogsText, memory, liteResult, phase, precomputed, uncompletedTasksOpt) {
  const tags = Array.isArray(liteResult.tags) ? liteResult.tags : [];
  const hasImages = Boolean(imageBlobs && imageBlobs.length > 0);
  const isRelief = (liteResult.health_status === '低調' || liteResult.health_status === '不調');
  const hasStatedGoal = (tags.indexOf('活動目標の表明') !== -1) || (liteResult && liteResult.action_intent === 'support_stated_goal');
  const needDbModule = Boolean(liteResult.need_db_action) ||
    (tags.indexOf('DB依頼') !== -1) ||
    hasImages ||
    hasStatedGoal ||
    /(✅|タスク追加|タスク更新|タスク完了|タスク削除|予定追加|予定変更|カレンダー登録|買物追加|メモして|覚えて|記録して|反映して)/.test(userText);
  const needSearch = (tags.indexOf('事実質問') !== -1);
  const needWeather = (Boolean(liteResult.weather_relevance) || phase === 'PHASE_C' || isRelief);

  // ----------------------------------------------------
  // 1. プロンプトモジュールの動的選別・結合
  // ----------------------------------------------------
  const promptModules = [];

  // 3-1. コアプロンプト（常時注入）
  const corePrompt = (memory.prompt_core && memory.prompt_core.trim() !== '')
    ? memory.prompt_core.trim()
    : getDefaultPromptCore();
  promptModules.push(corePrompt);

  // 3-2. フェーズ専用モジュール
  if (phase === 'PHASE_A') {
    promptModules.push((memory.prompt_phase_a && memory.prompt_phase_a.trim() !== '') ? memory.prompt_phase_a.trim() : getDefaultPromptPhaseA());
  } else if (phase === 'PHASE_B') {
    promptModules.push((memory.prompt_phase_b && memory.prompt_phase_b.trim() !== '') ? memory.prompt_phase_b.trim() : getDefaultPromptPhaseB());
  } else if (phase === 'PHASE_C') {
    promptModules.push((memory.prompt_phase_c && memory.prompt_phase_c.trim() !== '') ? memory.prompt_phase_c.trim() : getDefaultPromptPhaseC());
  } else {
    promptModules.push((memory.prompt_phase_d && memory.prompt_phase_d.trim() !== '') ? memory.prompt_phase_d.trim() : getDefaultPromptPhaseD());
  }

  // 3-5. 引き算・回復優先モジュール（心身低調・不調時）
  if (isRelief) {
    promptModules.push((memory.prompt_relief && memory.prompt_relief.trim() !== '') ? memory.prompt_relief.trim() : getDefaultPromptRelief());
  }

  // 3-3. DB操作仕様 ＆ JSONスキーマ（ピンポイント・マイクロスキーマ適用で大幅節約）
  if (needDbModule) {
    let effectiveTargetType = (liteResult && liteResult.db_target_type) ? liteResult.db_target_type : 'none';
    if (effectiveTargetType === 'none' && hasStatedGoal) {
      effectiveTargetType = 'task_add';
    }
    if (effectiveTargetType !== 'none' && effectiveTargetType !== 'other' && !hasImages) {
      promptModules.push(getMicroDbSchema_(effectiveTargetType, memory.prompt_db));
    } else {
      promptModules.push((memory.prompt_db && memory.prompt_db.trim() !== '') ? memory.prompt_db.trim() : getDefaultPromptDb());
    }
  } else {
    promptModules.push(`【出力JSONスキーマ】\n{ "reply_text": "【必須】ユーザーへの返信文" }`);
  }

  // カスタムレイアウト指示（常時末尾）
  if (memory.custom_system_prompt && memory.custom_system_prompt.trim() !== '') {
    promptModules.push(`【追加カスタム指示（最優先フォーマット・ルール）】\n${memory.custom_system_prompt.trim()}`);
  }

  const finalSystemPrompt = promptModules.join('\n\n==================================================\n\n');

  // ----------------------------------------------------
  // 2. コンテキストデータの動的選別・構築
  // ----------------------------------------------------
  let contextLines = [];
  contextLines.push(`【プロファイル（恒久生活基盤）】: ${memory.profile || '未設定'}`);
  contextLines.push(`【現在日時】: ${precomputed.nowStr}`);
  contextLines.push(`【直前のやり取りからの経過時間(Δt)】: ${precomputed.elapsedStr}`);
  contextLines.push(`【時間の鏡（現在の予定・次の境界までの残り時間）】: ${precomputed.boundaryInfo.summaryText}`);
  contextLines.push(`【現在地推論】: ${liteResult.location || '自宅'} / 【心身状態】: ${liteResult.health_status || '通常'}`);

  if (memory.monthly_report_ready === 'TRUE') {
    contextLines.push(`【月報通知フラグ】: TRUE`);
  }

  // 3-4. 関連生活習慣トピックのオンデマンド注入（該当エントリーのみピンポイント抽出）
  if (liteResult.matched_habit_topic && liteResult.matched_habit_topic !== 'none' && memory.lifestyle_habits) {
    const habitEntry = extractHabitEntryByTopic(memory.lifestyle_habits, liteResult.matched_habit_topic);
    if (habitEntry) {
      contextLines.push(`【関連する生活習慣メモリー (${liteResult.matched_habit_topic})】:\n${habitEntry}`);
    }
  }

  // 3-6. 天気・気圧データの条件付き注入
  if (needWeather) {
    let weatherDisplay = memory.weather_info || '';
    let pressureAlertVal = memory.pressure_alert || 'FALSE';
    if (!weatherDisplay || weatherDisplay.includes('エラー')) {
      try {
        const freshW = fetchWeatherAndPressure();
        if (freshW && freshW.weatherInfo) {
          weatherDisplay = freshW.weatherInfo;
          pressureAlertVal = freshW.pressureAlert;
        }
      } catch (e) {}
    }
    if (typeof hasOfficeEventToday === 'function' && !hasOfficeEventToday() && weatherDisplay.includes('｜')) {
      weatherDisplay = weatherDisplay.split('｜')[0].trim();
    }
    contextLines.push(`【天気・気温】: ${weatherDisplay || '情報なし'}`);
    contextLines.push(`【気圧急降下】: ${pressureAlertVal === 'TRUE' ? '急降下中(注意)' : '安定'}`);
  }

  // タスク・買物・インプット・カレンダー・ありたい姿の条件付き選別
  const allUncompletedTasks = uncompletedTasksOpt || getTasks('未完了');

  // タスクの選別注入（Flashへの入力トークンを劇的に削減）
  let tasksToInject = [];
  if (phase === 'PHASE_A' || phase === 'PHASE_B') {
    // 進行中保護 or 即時送り出し: 既存タスクの提案・提示は一切不要
    tasksToInject = [];
  } else if (liteResult && liteResult.focused_task_ids && liteResult.focused_task_ids.length > 0) {
    // Liteが状況に合わせてキュレーションした着目・操作タスク（最大2件）
    tasksToInject = (allUncompletedTasks || []).filter(t => liteResult.focused_task_ids.indexOf(t.id) !== -1);
  } else if (phase === 'PHASE_C' && liteResult && liteResult.action_intent === 'proactive_proposal') {
    // 余白発生かつ自発提案フェーズで特定IDがない場合: 直近優先の2件のみを候補として渡す
    tasksToInject = (allUncompletedTasks || []).slice(0, 2);
  } else if (liteResult && (liteResult.db_target_type === 'task_complete' || liteResult.db_target_type === 'task_update' || liteResult.db_target_type === 'task_delete')) {
    // タスク操作対象だがLiteがIDを返さなかった場合のフォールバック（発言キーワード合致タスクを抽出）
    const matched = (allUncompletedTasks || []).filter(t => userText && userText.includes(t.title));
    tasksToInject = matched.length > 0 ? matched.slice(0, 2) : (allUncompletedTasks || []).slice(0, 2);
  }

  // 買物リスト・インプットストックの条件付き注入
  const needShopping = (phase === 'PHASE_C' && tags.indexOf('過ごし方相談') !== -1) ||
    (liteResult && liteResult.db_target_type === 'shopping') ||
    /(買|買い|日用品|スーパー|ドラッグストア)/.test(userText);
  const unboughtShopping = needShopping ? getShoppingList('未買') : [];

  const needInput = (phase === 'PHASE_C' && tags.indexOf('過ごし方相談') !== -1) ||
    (liteResult && liteResult.db_target_type === 'input_stock') ||
    /(映画|本|漫画|アニメ|音楽|ゲーム|見るもの|読むもの|消化)/.test(userText);
  const pendingInput = needInput ? getInputStockList('未') : [];

  // 用語辞書（出現キーワードのみオンデマンド抽出）
  if (memory.dictionary && memory.dictionary.trim() !== '') {
    const taskTitlesText = tasksToInject.map(t => t.title).join(' ');
    const inputTitlesText = pendingInput.map(inp => inp.title).join(' ');
    const searchTarget = `${userText || ''}\n${todayLogsText || ''}\n${taskTitlesText}\n${inputTitlesText}`;
    const relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
    if (relevantDict) {
      contextLines.push(`【用語辞書（客観的前提知識・誤認防止）】:\n${relevantDict}`);
    }
  }

  // フェーズC（余白・段取り）専用コンパス＆候補プール
  if (phase === 'PHASE_C') {
    if (!isRelief) {
      if (memory.ideal_self && memory.ideal_self.trim() !== '') {
        contextLines.push(`【ありたい人間像・生活指針（判断の羅針盤）】: ${memory.ideal_self.trim()}`);
      }
      // ユーザーが明確な活動目標を表明していない時（過ごし方相談や余白時）のみ、スキルメニューと周期記録を提示候補として注入
      const hasDeclaredGoal = (tags.indexOf('活動目標の表明') !== -1);
      if (!hasDeclaredGoal) {
        if (memory.skill_options && memory.skill_options.trim() !== '') {
          contextLines.push(`【能動的スキルアップメニュー (skill_options)】:\n${memory.skill_options.trim()}`);
        }
        if (memory.cycle_stamps && memory.cycle_stamps.trim() !== '') {
          contextLines.push(`【活動・メンテナンス最終記録 (cycle_stamps)】:\n${memory.cycle_stamps.trim()}`);
        }
      }
      if (memory.weekly_summary && memory.weekly_summary.trim() !== '') {
        contextLines.push(`【直近1〜2週間の生活・活動サマリー】: ${memory.weekly_summary.trim()}`);
      }
    }
  }

  // 7日分カレンダーの注入条件: 明日以降の予定・週末・来週等の未来日程照会がある場合のみ
  const needFutureCalendar = Boolean(liteResult.future_schedule_inquiry) ||
    /(明日|明後日|週末|土曜|日曜|来週|週間|スケジュール)/.test(userText);
  if (needFutureCalendar) {
    const calCtx = getCalendarAndHolidayContext(precomputed.now);
    contextLines.push(calCtx);
  } else if (precomputed.todayEvents && precomputed.todayEvents.length > 0) {
    contextLines.push(`【本日のカレンダー予定】: ${precomputed.todayEvents.join(' / ')}`);
  }

  // 着目・関連タスク一覧（選別された最大2件のみピンポイント注入）
  if (tasksToInject.length > 0) {
    contextLines.push(`【着目・関連タスク】: ${formatUncompletedTasksForContext(tasksToInject, precomputed.todayDate)}`);
  }

  if (unboughtShopping.length > 0) {
    contextLines.push(`【買物リスト(未買)】: ${unboughtShopping.map(s => s.item).join(', ')}`);
  }
  if (pendingInput.length > 0) {
    const inputItems = pendingInput.map(inp => `[${inp.type}]${inp.title}${inp.memo ? '(' + inp.memo + ')' : ''}`);
    contextLines.push(`【インプット未消化】: ${inputItems.join(', ')}`);
  }

  if (needDbModule && userText && /(ルーティン|定期|習慣)/.test(userText)) {
    const routines = getRoutines();
    if (routines.length > 0) {
      contextLines.push(`【登録済み定期ルーティン】: ${routines.map(r => `${r.ruleName}(${r.type}:${r.value})`).join(', ')}`);
    }
  }

  // ----------------------------------------------------
  // 3. マルチモーダル＆会話履歴の組み立て
  // ----------------------------------------------------
  const currentTurnParts = [];
  if (hasImages) {
    for (let i = 0; i < imageBlobs.length; i++) {
      const blob = imageBlobs[i];
      if (blob) {
        currentTurnParts.push({
          inlineData: {
            mimeType: blob.getContentType() || 'image/jpeg',
            data: Utilities.base64Encode(blob.getBytes())
          }
        });
      }
    }
  }

  let promptBody = contextLines.join('\n') + '\n\n';
  if (todayLogsText && todayLogsText.trim() !== '') {
    promptBody += `=== 本日の会話履歴 (時系列) ===\n${todayLogsText.trim()}\n\n`;
  }
  promptBody += `=== ユーザーの最新発言 ===\n${userText || '（画像を受信しました。内容を確認してください）'}`;
  currentTurnParts.push({ text: promptBody });

  const requestPayload = {
    systemInstruction: {
      parts: [{ text: finalSystemPrompt }]
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
    }
  };

  if (needSearch) {
    requestPayload.tools = [{ googleSearch: {} }];
  } else {
    requestPayload.generationConfig.responseMimeType = 'application/json';
  }

  return requestPayload;
}

/**
 * 新・旧2つのGeminiリクエストペイロードを UrlFetchApp.fetchAll で完全並列実行
 * @param {Object} newPayload
 * @param {Object} oldPayload
 * @return {{newRes: {text: string, usage: Object|null}, oldRes: {text: string, usage: Object|null}}}
 * @private
 */
function fetchNewAndOldParallel_(newPayload, oldPayload) {
  const config = getConfig();
  const url = `${SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE}?key=${config.geminiApiKey}`;

  const reqNew = {
    url: url,
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(newPayload),
    muteHttpExceptions: true
  };
  const reqOld = {
    url: url,
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(oldPayload),
    muteHttpExceptions: true
  };

  const responses = UrlFetchApp.fetchAll([reqNew, reqOld]);
  const resNewRaw = responses[0];
  const resOldRaw = responses[1];

  let newResult;
  if (resNewRaw.getResponseCode() >= 200 && resNewRaw.getResponseCode() < 300) {
    newResult = extractGeminiCandidateResult_(resNewRaw.getContentText());
  } else {
    Logger.log(`[並列実行 新システムリトライ] ステータス ${resNewRaw.getResponseCode()}`);
    Utilities.sleep(1000);
    newResult = fetchGeminiResultWithRetry(newPayload);
  }

  let oldResult;
  if (resOldRaw.getResponseCode() >= 200 && resOldRaw.getResponseCode() < 300) {
    oldResult = extractGeminiCandidateResult_(resOldRaw.getContentText());
  } else {
    Logger.log(`[並列実行 旧システムリトライ] ステータス ${resOldRaw.getResponseCode()}`);
    try {
      Utilities.sleep(1000);
      oldResult = fetchGeminiResultWithRetry(oldPayload);
    } catch (oldErr) {
      oldResult = {
        text: JSON.stringify({ reply_text: `（旧システム一時エラー: ${oldErr.message}）` }),
        usage: { promptTokenCount: 0, candidatesTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 0 }
      };
    }
  }

  return { newRes: newResult, oldRes: oldResult };
}

/**
 * 旧システム側だけが検出し、新システム側が取りこぼしたDB/カレンダーアクションがないか比較検知
 * @param {Object} newParsed
 * @param {Object} oldParsed
 * @return {string} 差分注記文字列（差分なしなら空文字）
 * @private
 */
function detectMissedActionsFromOld_(newParsed, oldParsed) {
  if (!oldParsed) return '';
  const missed = [];

  const newTasks = (newParsed && Array.isArray(newParsed.task_actions)) ? newParsed.task_actions : [];
  const oldTasks = Array.isArray(oldParsed.task_actions) ? oldParsed.task_actions : [];
  if (oldTasks.length > 0 && newTasks.length === 0) {
    const names = oldTasks.map(t => `${t.action}:${t.title || t.target_title || ''}`).join(', ');
    missed.push(`タスク(${names})`);
  }

  const newCals = (newParsed && Array.isArray(newParsed.calendar_actions)) ? newParsed.calendar_actions : [];
  const oldCals = Array.isArray(oldParsed.calendar_actions) ? oldParsed.calendar_actions : [];
  if (oldCals.length > 0 && newCals.length === 0) {
    const names = oldCals.map(c => `${c.action}:${c.title || ''}`).join(', ');
    missed.push(`予定(${names})`);
  }

  const newShops = (newParsed && Array.isArray(newParsed.shopping_actions)) ? newParsed.shopping_actions : [];
  const oldShops = Array.isArray(oldParsed.shopping_actions) ? oldParsed.shopping_actions : [];
  if (oldShops.length > 0 && newShops.length === 0) {
    const names = oldShops.map(s => `${s.action}:${s.item || ''}`).join(', ');
    missed.push(`買物(${names})`);
  }

  if (missed.length > 0) {
    return `⚠️ [旧のみ検出: ${missed.join(' / ')}]`;
  }
  return '';
}

/**
 * 生活伴走システムの1ターン統合実行エンジン（system_mode: AB_TEST | NEW | OLD 完全対応）
 * @param {string} userText
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs
 * @param {string} todayLogsText
 * @param {Object=} memoryOpt
 * @param {Date=} simulatedNowDate
 * @return {{
 *   mode: string,
 *   phase: string,
 *   phaseLabel: string,
 *   liteResult: Object|null,
 *   primaryResult: Object,
 *   oldResult: Object|null,
 *   missedActionsNote: string,
 *   logMeta: Object
 * }}
 */
function executeCompanionTurn(userText, imageBlobs, todayLogsText, memoryOpt, simulatedNowDate) {
  const memory = memoryOpt || getMemory();
  const mode = memory.system_mode || 'AB_TEST';
  const now = simulatedNowDate || new Date();

  // ----------------------------------------------------
  // A. OLDモード（完全ロールバック・旧システム単独稼働）
  // ----------------------------------------------------
  if (mode === 'OLD') {
    const sheetContext = getSpreadsheetContext(userText, todayLogsText, now);
    const calendarContext = getCalendarAndHolidayContext(now);
    const combinedContext = `${calendarContext}\n\n${sheetContext}`;
    const oldRes = callGeminiFlash(userText, imageBlobs, combinedContext, todayLogsText);
    return {
      mode: 'OLD',
      phase: 'OLD',
      phaseLabel: '旧単独',
      liteResult: null,
      primaryResult: oldRes,
      oldResult: oldRes,
      missedActionsNote: '',
      logMeta: oldRes._usage || null
    };
  }

  // ----------------------------------------------------
  // B. 0. GAS前処理: 客観数値の機械的算出
  // ----------------------------------------------------
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastTimeStr = extractLastLogTime(todayLogsText);
  const elapsedStr = formatElapsedTime(lastTimeStr, now);
  const boundaryInfo = getNextBoundaryInfo(now);
  const todayEvents = getTodayEventsList(now);
  const habitTopics = extractHabitTopicsList(memory.lifestyle_habits);
  const allUncompletedTasks = getTasks('未完了');

  const precomputed = {
    now: now,
    nowStr: nowStr,
    todayDate: todayDate,
    elapsedStr: elapsedStr,
    boundaryInfo: boundaryInfo,
    todayEvents: todayEvents,
    habitTopics: habitTopics
  };

  // ----------------------------------------------------
  // C. 1. 前段 Flash-Lite 実行
  // ----------------------------------------------------
  const hasImages = Boolean(imageBlobs && imageBlobs.length > 0);
  const liteCall = callGeminiLite(userText, hasImages, todayLogsText, memory, precomputed, allUncompletedTasks);
  const liteResult = liteCall.result;
  const liteUsage = liteCall.usage || {};

  // ----------------------------------------------------
  // D. 2. GAS ルール層: フェーズ判定
  // ----------------------------------------------------
  const phase = determineActionPhase(liteResult, boundaryInfo);
  const phaseMap = {
    'PHASE_A': 'フェーズA(進行中保護)',
    'PHASE_B': 'フェーズB(即時送出)',
    'PHASE_C': 'フェーズC(余白・触媒)',
    'PHASE_D': 'フェーズD(通常対話)'
  };
  const phaseShortMap = {
    'PHASE_A': 'フェーズA',
    'PHASE_B': 'フェーズB',
    'PHASE_C': 'フェーズC',
    'PHASE_D': 'フェーズD'
  };
  const phaseLabel = phaseShortMap[phase] || phase;
  const phaseFullLabel = phaseMap[phase] || phase;
  const tagsStr = (liteResult.tags || []).join(',');
  const phaseAndTags = `[${phaseFullLabel} / ${tagsStr} / 直前:${liteResult.previous_action_status} / 体調:${liteResult.health_status} / topic:${liteResult.matched_habit_topic}]`;

  // ----------------------------------------------------
  // E. 3. 新システムのリクエスト構築
  // ----------------------------------------------------
  const newPayload = buildNewSystemFlashPayload(userText, imageBlobs, todayLogsText, memory, liteResult, phase, precomputed, allUncompletedTasks);

  // ----------------------------------------------------
  // F. 4. 後段 Flash の実行 (NEW 単独 vs AB_TEST 並列)
  // ----------------------------------------------------
  let newParsed;
  let newUsage = {};
  let oldParsed = null;
  let oldUsage = {};

  if (mode === 'AB_TEST') {
    const sheetContext = getSpreadsheetContext(userText, todayLogsText, now);
    const calendarContext = getCalendarAndHolidayContext(now);
    const combinedContext = `${calendarContext}\n\n${sheetContext}`;
    const oldPayload = buildOldSystemPayloadFromContext_(userText, imageBlobs, combinedContext, todayLogsText);

    const parallelRes = fetchNewAndOldParallel_(newPayload, oldPayload);
    newUsage = parallelRes.newRes.usage || {};
    newParsed = parseGeminiActionJson_(parallelRes.newRes.text, newUsage);

    oldUsage = parallelRes.oldRes.usage || {};
    oldParsed = parseGeminiActionJson_(parallelRes.oldRes.text, oldUsage);
  } else {
    // NEW 単独稼働モード
    const singleRes = fetchGeminiResultWithRetry(newPayload);
    newUsage = singleRes.usage || {};
    newParsed = parseGeminiActionJson_(singleRes.text, newUsage);
  }

  // ----------------------------------------------------
  // G. 5. トークン集計・削減差分・取りこぼし検知
  // ----------------------------------------------------
  const litePrompt = liteUsage.promptTokenCount || 0;
  const liteCand = liteUsage.candidatesTokenCount || 0;
  const liteCache = liteUsage.cachedContentTokenCount || 0;
  const liteTotal = liteUsage.totalTokenCount || (litePrompt + liteCand);

  const flashPrompt = newUsage.promptTokenCount || 0;
  const flashCand = newUsage.candidatesTokenCount || 0;
  const flashCache = newUsage.cachedContentTokenCount || 0;
  const flashTotal = newUsage.totalTokenCount || (flashPrompt + flashCand);

  const newTotalTokens = liteTotal + flashTotal;
  const oldTotalTokens = oldParsed ? (oldUsage.totalTokenCount || ((oldUsage.promptTokenCount || 0) + (oldUsage.candidatesTokenCount || 0))) : '';

  let tokenReductionDiff = '';
  if (mode === 'AB_TEST' && typeof oldTotalTokens === 'number' && oldTotalTokens > 0) {
    const diff = newTotalTokens - oldTotalTokens;
    const pct = ((diff / oldTotalTokens) * 100).toFixed(1);
    const sign = diff > 0 ? '+' : '';
    tokenReductionDiff = `${sign}${diff} tok (${sign}${pct}%)`;
  }

  const missedActionsNote = (mode === 'AB_TEST' && oldParsed)
    ? detectMissedActionsFromOld_(newParsed, oldParsed)
    : '';

  const logMeta = {
    isTwoModel: true,
    litePromptTokens: litePrompt,
    liteCandidatesTokens: liteCand,
    liteCachedTokens: liteCache,
    flashPromptTokens: flashPrompt,
    flashCandidatesTokens: flashCand,
    flashCachedTokens: flashCache,
    newTotalTokens: newTotalTokens,
    phaseAndTags: phaseAndTags,
    oldAiReply: oldParsed ? (oldParsed.reply_text || '') : '',
    oldTotalTokens: oldTotalTokens,
    tokenReductionDiff: tokenReductionDiff
  };

  return {
    mode: mode,
    phase: phase,
    phaseLabel: phaseLabel,
    liteResult: liteResult,
    primaryResult: newParsed,
    oldResult: oldParsed,
    missedActionsNote: missedActionsNote,
    logMeta: logMeta
  };
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
2. profile（長期記憶・恒久生活基盤）の新陳代謝ルール（★厳格かつ保守的に運用すること）:
   - 目的: プロファイルは「恒久的な生活基盤（住居・家族構成・最寄り駅・勤務形態・移動所要時間）」のみを純粋に保持する場所です（※入浴・食事・身支度・睡眠などのトピック別生活習慣は別キー lifestyle_habits で管理するため、profile には混ぜないでください）。
   - 【反映条件】: 住居・家族構成・勤務形態・通勤時間などの恒久的事実に変更があった場合、またはユーザーが明示的に「プロファイルに覚えておいて」と指示した場合のみ更新を許可します。
   - 【原則維持】上記の明確な変更事実がない限り、既存プロファイルの文章・数値をそのまま一字一句維持して返してください。
3. cycle_stamps（生活メンテナンス ＆ 創造・能動的活動の最終実施記録）:
   - 目的: 次回のお手入れ時期や、創造・スキルアップ・運動活動の「ご無沙汰（疎遠）」を検知して再提案するためのスタンプ（改行区切りの「項目名: YYYY-MM-DD」または「項目名: 未着手」形式）です。
   - 対象項目:
     * 爪切り、外歩き・散歩（出社日の上大岡駅徒歩15分強や近所の散歩・外出徒歩を含む）、読書（本・漫画）、ピアノ演奏、ギター練習、楽曲制作、ビジネスインプット など。
     * 会話ログで実施が確認できた項目の値を当日（${targetDateStr}）に更新してください。
     * 既存の項目（過去に記録された日付や「未着手」の表記）は、当日のログで実施が確認されない限り、架空の日付を捏造せずそのままの値（「未着手」なら「未着手」のまま）を維持してください。
   - 【絶対除外ルール】:
     ① 日常の軽微なお手入れや部分ケア（例: 爪1本だけを削った、枝毛を切った、浴槽の軽いブラシがけ等）は cycle_stamps には記録せず、既存の記録をそのまま維持してください。
4. weekly_summary（直近1〜2週間の生活・活動・感想統合サマリー）:
   - 体調だけでなく、直近1〜2週間の「生活・活動・関心の動向」を200〜300文字程度で高密度にまとめてください。
   - 【必須の3大要素】:
     ① 進行中テーマ・プロジェクトの進捗や経緯（現在取り組んでいること、一区切りついたこと）
     ② 触れたエンタメ・作品・趣味の体験と感想（楽しめたこと、印象に残ったこと）
     ③ 体調・睡眠・メンタルの波や傾向（疲労度、体調不良からの回復状況など）
   - ※直近7〜10日の生ログ（rolling_memory）から押し出された情報も含め、中長期的な文脈の連続性を保てるよう要約してください。
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
  "weekly_summary": "200〜300文字程度の直近1〜2週間の生活・活動・感想統合サマリー",
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

