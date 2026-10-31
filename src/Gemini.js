/**
 * Gemini.js - Gemini 3.1 Flash-Lite ＆ Gemini 3.8 Flash 2段階ハイブリッド連携モジュール
 * 前段 Flash-Lite ルーティング ＋ 後段 Flash 動的アセンブル実行
 * 低レイテンシ（thinkingBudget: 0）、Web検索グラウンディング、JSONスキーマ
 */

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
      description: '今着目・提案・操作すべきタスクのID（段取り相談時は最大3〜5件、通常提案・操作時は最大2件。該当なしは空配列）'
    },
    need_db_action: {
      type: 'BOOLEAN',
      description: 'タスク・予定・買物・インプット・メモリーの追加/完了/更新/削除などのDB操作が実際に必要か'
    },
    db_target_type: {
      type: 'STRING',
      enum: ['none', 'task_complete', 'task_add', 'task_update', 'task_delete', 'routine', 'calendar', 'shopping', 'input_stock', 'memory', 'other'],
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
   - "体調・疲労の訴え": 痛み、強い倦怠感、発熱、消耗など、身体やメンタルの不調に関する言及（※空気や肌の乾燥、季節の寒暖差、天候の感想などの日常的な所感・雑談は体調不良と混同せず"雑談"に分類すること）。
   - "過ごし方相談": 空き時間や余白に何をして過ごすか、段取りや一日のタイムスケジュール・選択肢を求める相談（「次何しよう」「暇だな」「明日の予定」「タイスケ作って」等）。
   - "雑談": 日常の出来事の共有、感想、挨拶、フリートーク、季節や気温・乾燥などの環境所感。

2. previous_action_status（直前行動の完了・継続推論）:
   - 直前の会話履歴でユーザーが何らかの行動開始を宣言していた場合、そこからの経過時間（Δt）と最新発言の内容から推論する：
     * "継続中": 経過時間Δtが短くその行動や後続の本番行動がまだ終わっていない、または具体的作業・外出の最中と推察される場合。
       ※最重要注意: カレンダー予定が「タスク消化」「作業」「整理」「自由時間」などの包括枠（アンブレラ枠）であること自体は、個別作業の「継続中」とは見なしません。ユーザーが特定の具体的行為（「Reaperいじってる」「コード書き中」等）に没頭中と発言していない限り、「該当なし」または「完了済み」としてください。
     * "完了済み": 最新発言で完了が報告された、または十分な時間が経過し一段落したと推察される場合。
     * "該当なし": 直前に行動開始の宣言がない、または本日初回の発言である場合。

3. action_intent（対話の主目的・演出スタンス）:
   - "immediate_sendoff": 風呂・食事・睡眠・移動・作業開始など、直ちに物理行動に向かう場合（提案を挟まず気持ちよく送り出す）。
   - "support_stated_goal": ユーザーが自発的にやりたいことや目標を決めている場合（別の選択肢を押し付けず、その意志を尊重し就寝・健康と両立する引き際を見立てる）。
   - "proactive_proposal": 一段落して余白が発生した、カレンダーが「タスク消化」「作業枠」などの包括枠にある、または何をして過ごすか・一日の段取りを相談している場合（放置タスクやスキルの自発提案、タイムスケジュールの組み立てを行う）。
   - "db_operation": タスク完了や追加、カレンダー登録などDB操作が主目的の場合。
   - "general_dialogue": 日常の雑談、感想、状況報告。

4. focused_task_ids（今着目・提案・操作すべきタスクの選別）:
   - ★最重要【期限超過・本日期限タスクの最優先】: コンテキストの未完了タスク一覧の中に「期限超過（⚠️期限超過）」や「本日期限（📅本日期限）」のタスクが存在する場合、過ごし方相談や余白時間、およびカレンダーが「タスク消化」「作業」等の包括枠にある時間帯において、それらを最優先で選出してください。
   - 【完了・操作時】: ユーザー発言内に終了・完了表現（「〜終わった」「〜終えた」「〜完了」「〜した」等）があり、コンテキストの【現在の未完了タスク一覧】に該当・関連するタスクが存在する場合、必ずそのタスクIDを選出して配列で出力（例: ["T_..."]）。
   - 【提案・段取り時】: まとまった余白時間や過ごし方相談時、「タスク消化」「作業」枠の最中、一日のタイスケ相談時は、現在の時間帯・場所・心身状態（疲労や覚醒度）と各タスクの「期限」「リマインド目安（例: 『夜・自室』『休日PC』）」を照合し、今取り組むべき優先タスク（通常相談やタスク消化枠時は1〜2件、一日の段取り時は最大3〜5件）を選出。
   - 不要または該当なしの場合は空配列 [] を出力。

5. need_db_action（実データベース・メモリー操作の要否）:
   - ユーザーがタスクの追加・完了・更新・削除、定期ルーティン追加、カレンダー予定の登録・変更、買い物メモの追加・購入済チェック、インプット作品の記録、生活習慣やプロファイル等のメモリー更新を求めている場合は true。
   - ★重要【完了報告のタスク昇格】: ユーザーが行動の完了を報告した際、未完了タスク一覧に該当するものがある場合も、タスク完了処理を実行するため true とする（食事など日常行動と混ざっていてもタスク該当があれば true）。
   - ★重要【目標の自発タスク化】: ユーザーが翌日や週末など、今後の時間枠でやりたいこと・行動予定を具体的に口にした場合（「活動目標の表明」）も、伴走タスクとして自動登録するため true とする。
   - 単なる日常行動の報告（「夕飯食べた」「ニュース見終えた」「風呂入る」など）で未完了タスクやDB更新が伴わない場合のみ false。

6. db_target_type（必要なDB操作の種別）:
   - "none"（操作不要）、"task_complete"（タスク完了）、"task_add"（単発タスク追加・目標のタスク化）、"task_update"（タスク更新）、"task_delete"（タスク削除）、"routine"（毎日のタスク化・定期ルーティン・日課追加）、"calendar"（予定登録/変更）、"shopping"（買物）、"input_stock"（作品ストック）、"memory"（生活習慣・プロファイル・辞書更新）、"other"（その他）。

7. future_schedule_inquiry（未来日程・カレンダー照会の有無）:
   - 明日以降の予定、週末スケジュール、来週などの確認・照会、または未来のスケジュールを意識した相談が含まれている場合は true。当日のやり取りのみなら false。

8. location（現在地の特定）:
   - 会話文脈、カレンダー予定、時間帯から現在地を推論し、"自宅" / "職場" / "移動中" / "外出先" のいずれかを出力。

9. health_status（当日の心身シグナル抽出）:
   - 当日ログおよび最新発言の事実から、"通常" / "低調" / "不調" を客観的に判定：
     * "通常": 通常通り活動可能。日常的な空気や肌の乾燥、寒暖差、天気の感想、満腹感、一時的な軽い感覚などは「通常」として扱う。
     * "低調": 軽い疲労感、眠気、集中力の低下など、活動自体は可能だがペース配慮（短時間・低負荷な行動）が適した状態。
     * "不調": ★【タスクよりも休息を優先すべき体調】発熱、強い倦怠感、身体の痛み、明らかな体調不良、睡眠不足による激しい消耗など。本人が休みよりタスクやゲームを優先しようとしても、システムがセーフティとして介入し、活動を停止して休息・睡眠を最優先させるべき状態。

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
- 以下の分岐に応じて、対等で頼れる大人の伴走者として応答してください：

1. ユーザーが自発的に活動目標（「〜したい」「〜する」「〜やろうかな」）を表明している場合:
   - 別の選択肢や多肢選択メニューを押し付けず、ユーザー自身の意志を全面的に支持・尊重する。
   - コンテキストの【時間の鏡】（就寝23:00目安）を踏まえ、生活前提（入浴・食事・休養）を崩さない「無理のない引き際・タイムボックス（例: ○○頃を目安にひと区切りつける）」をスマートに見立てて伴走する。
   - ※もし本日期限や直近に迫った着目タスクがある場合は、「それもいいですが、先に○○だけ15分で済ませませんか？」と愛のある健全な懐疑・優先度チェックを自然に添える。
   - 【目標の自然なタスク化】ユーザーが明日や週末など今後のやりたいこと・行動予定を口にした場合は、ただ会話で同意・応援するだけでなく、本人が忘れないよう自然にタスク（翌日期限・適切なリマインド目安付き）として登録し、返信文で「明日のタスクに『〜』を入れておきました！」と軽やかに添える。

2. 何をすべきか迷っている・余白を持て余している場合（「暇だな」「次何しよう」「他にやるべきことある？」等の過ごし方相談）:
   - ★最重要【期限超過・本日期限タスクの最優先提示】: コンテキストの【着目・関連タスク】に「⚠️期限超過」や「📅本日期限」のタスクがある場合は、他の娯楽や余白提案よりもまず「そういえば期限が過ぎている『〇〇』があるよ」「本日期限の『〇〇』はどうする？」と現状確認・リスケや着手を最優先でリフレクションする。
   - その上で、手元の着目タスク（リマインド目安や期限が近いもの）やスキルメニュー、文化・娯楽、および【生活習慣メモリー（lifestyle_habits）】の運動・身体ケア（所要時間や天候・気分に合わせ、室内完結の手軽な短時間動画・ゲームフィットネスから屋外歩行まで適切に選択）から、今の状況に最も摩擦が少ない具体的な選択肢（2〜3枚）を手元に差し出す。
   - ※同日中にすでに提案済みの項目は重複提案しない。21:30以降は就寝に向けた低負荷な選択肢や休息を中心にする。

3. カレンダーが「タスク消化」「作業枠」などの包括枠にある場合（またはタスク完了直後）:
   - ユーザーは今、溜まった用事やタスクを進めるためのタイムボックスの中にいます。単に「応援しています」と会話を閉じるのではなく、タスク着手を促す「触媒（カタリスト）」として機能してください。
   - コンテキストの【時間の鏡】から「枠の終了までの残り時間（例: あと20分）」を把握し、手元の着目タスク（⚠️期限超過や📅本日期限のものを最優先）から「次はこれをやりませんか？」「これなら〇〇分で片付きそうです」と軽やかに着手を触媒する。
   - 直前にタスクを完了した報告があった場合もしっかり労った上で、まだ枠時間に余裕があれば次の優先タスクを1件スマートに促す。枠終了が近い場合は無理強いせずスッキリ完了させる。

4. 一日のタイムスケジュール・段取りの組み立てを求められた場合:
   - 【起床から就寝までの完全なタイムライン設計】:
     「午前」「夕方以降」などの曖昧なまとめ方をせず、起床から就寝まで一日全体の各枠を具体的な時刻範囲（HH:mm〜HH:mm）で時間割化して提示する。
   - 【生活リズムの土台（第2層の堅持）】:
     起床直後に重い活動へ直行させず、朝食や低覚醒からのゆったりした立ち上げ（身支度、ウォームアップ等）を朝の前提として組み、健康的なリズムを支える。
   - 【生活習慣メモリーのアンカー配置と柔軟性】:
     コンテキストの【生活習慣メモリー（lifestyle_habits）】に定義された食事や入浴などの時間を基本アンカーとして時間割に配置する。ただし、外出や長時間の活動を行う場合は固定枠に縛られず、動線に合わせた柔軟な例外を認める。
   - 【主活動の確保と全データプールの横断活用】:
     ユーザーが表明した活動目標や、コンテキストの【未消化ストック（input_stock）】から選定した主活動に必要なまとまった時間枠を優先して確保する。
   - 【直近記録（疎遠度）に基づくリバランス】:
     * 【周期スタンプ（cycle_stamps）】や会話履歴を参照し、直近数日間で身体の運動・ケアや他者・社会との接点が途絶えている場合は、主活動を圧迫しない時間帯にそれらを補う枠を優先的にタイスケへ織り交ぜる。
     * 運動や身体ケアの枠を提案する際は、単一の行動に偏らず、【生活習慣メモリー（lifestyle_habits）】に登録された手札から状況や時間枠に適した選択肢を提示する。
     * 生活課題タスクは、期限が迫っているものを隙間に1コマ添える程度とし、タスクだけで枠を埋め尽くさない。
   - 【予定タイトルのシンプル化】:
     カレンダー予定名には注釈・小言・タスク詳細のカッコ書き（（〜に気をつけて）、（〇〇など））を一切含めず、簡潔で視認性の高い名称にする。
   - ※【低調時のペース配慮】心身状態が「低調」（軽い疲れや眠気等）の時は、重い課題を強要せず、10〜15分でサクッと片付く手元のタスクや、ゆったりした過ごし方（ストレッチ、音楽、身体ケア等）を手元に差し出し、本人の自律的なペースに寄り添うこと（活動の完全停止はせず、自律的な選択を尊重する）。`;
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
   - ユーザーが \`cycle_stamps\` の登録活動（爪切り、外歩き・散歩、室内運動・フィットネス、読書、ピアノ、ギター、楽曲制作・DTM、ビジネスインプット等）を実施した報告があった場合は、\`cycle_stamps_updates\` に \`"項目名: YYYY-MM-DD"\` を出力して当日日付へ更新する。
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
  if (dbTargetType === 'routine') {
    return `【データベース操作仕様: 定期ルーティン ＆ 当日タスク】
毎日・毎週などの定期的な日課・ルーティン化を依頼された場合は、以下のJSONキーを出力してください：
- 【明日以降の自動生成ルール】: routine_actions にルールを出力（毎日なら type: "interval_days", value: "1"、特定曜日なら type: "day_of_week", value: "MON" 等）。
- 【本日分の未完了タスク】: 「今日はまだやってない」等、本日分のタスクがまだ実行されていない場合は、本日すぐ取り組めるよう task_actions にも本日の単発タスク（due_date: 当日日付）を出力してください。
{
  "reply_text": "【必須】ユーザーへの返信文",
  "routine_actions": [
    { "action": "add", "title": "対象/プロジェクト：具体的な内容", "type": "interval_days", "value": "1", "memo": "補足" }
  ],
  "task_actions": [
    { "action": "add", "title": "対象/プロジェクト：具体的な内容", "due_date": "YYYY-MM-DD", "memo": "補足", "remind_context": "提案目安" }
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
  return `【特別介入モード: 引き算・リスケ・心身回復の最優先（セーフティ発動）】
- 現在、客観的に【タスクや娯楽よりも休息を優先すべき体調】（発熱、強い倦怠感、身体の痛み、体調不良、危険な過労・消耗など）と判断されています。
- 本人が休みよりゲームやタスク、作業を優先しようとしていても、システムが愛のある「引き算のセーフティ」として毅然と介入してください。
- タスクの消化や活動の遂行を促すことはやめ、「今日はやめておきましょう」「別日に回して、今は回復と休息を最優先にしましょう」という『引き算・撤退の意思決定』をシステム側から能動的に提案し、罪悪感のない休息を全面的に肯定してください。
- もし本日期限のタスクがある場合も、無理に今日やらせず、明日以降へのリスケジュールを軽やかに促してください。`;
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
  const isUmbrella = Boolean(boundaryInfo && boundaryInfo.isUmbrellaEvent);

  // 1. 即時行動の開始（風呂入る、ご飯食べる、寝る等） -> フェーズB（即時送り出し）
  if (intent === 'immediate_sendoff' || tags.indexOf('単発行動の開始') !== -1) {
    return 'PHASE_B';
  }

  // 2. 過ごし方相談（何をするかの見直し・タイスケ・やること相談）または 活動目標の表明 -> フェーズC（余白・段取り設計 ＆ 目標伴走）
  // ※直前の予定枠内であっても、ユーザー自身が立ち止まって相談している場合はフェーズCを優先
  if (intent === 'support_stated_goal' || intent === 'proactive_proposal' ||
      tags.indexOf('活動目標の表明') !== -1 || tags.indexOf('過ごし方相談') !== -1) {
    return 'PHASE_C';
  }

  // 3. カレンダーが包括的タスク枠（タスク消化、作業、整理枠等）の最中にある場合
  // ※単一の具体的行為（お絵描き、Reaper制作、会議等）ではなく、複数のタスクを消化するためのコンテナ枠。
  // ユーザーが特定作業への没頭を明言していない限り、タスク着手・推進を後押しする「触媒（PHASE_C）」として扱う。
  if (isUmbrella) {
    // 完了報告があった場合、または提案候補タスクが存在する場合は確実にPHASE_C
    if (tags.indexOf('完了報告') !== -1 || (liteResult && liteResult.focused_task_ids && liteResult.focused_task_ids.length > 0)) {
      return 'PHASE_C';
    }
    // 特定の没頭作業宣言がない場合もPHASE_Cでタスク着手を触媒
    if (prevStatus !== '継続中') {
      return 'PHASE_C';
    }
  }

  // 4. 直前行動が継続中（具体的没頭作業のモメンタム保護） -> フェーズA（受託専念）
  if (prevStatus === '継続中') {
    return 'PHASE_A';
  }

  // それ以外（通常対話、完了受諾、DB操作等） -> フェーズD
  return 'PHASE_D';
}

/**
 * cycle_stamps 文字列をパースし、各項目の経過日数ラベルを付与した文字列を生成
 * @param {string} rawStamps
 * @param {Date} todayDate
 * @return {string}
 * @private
 */
function formatCycleStampsWithElapsed_(rawStamps, todayDate) {
  if (!rawStamps || !rawStamps.trim()) return '';
  if (typeof parseCycleStamps !== 'function') return rawStamps.trim();
  const parsed = parseCycleStamps(rawStamps, todayDate || new Date());
  if (!parsed || parsed.length === 0) return rawStamps.trim();
  return parsed.map(p => {
    const elapsedText = (p.elapsedDays !== null && p.elapsedDays !== undefined)
      ? (p.elapsedDays === 0 ? '今日' : `${p.elapsedDays}日前`)
      : '未着手';
    return `${p.label}: ${p.date || '未着手'} (${elapsedText})`;
  }).join('\n');
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
  // タスクや娯楽よりも休息を優先すべき客観的体調（発熱、激痛、強い倦怠感など）の場合に引き算セーフティを発動
  const isRelief = (liteResult.health_status === '不調');
  const hasStatedGoal = (tags.indexOf('活動目標の表明') !== -1) || (liteResult && liteResult.action_intent === 'support_stated_goal');

  // 未完了タスク一覧の取得（未完了タスクの照合およびFlashへの選別注入に使用）
  const allUncompletedTasks = uncompletedTasksOpt || getTasks('未完了');

  // 完了報告のセーフティネット照合（発言に完了のニュアンスがあり、LiteがIDを抽出していなかった場合のタスク名照合）
  const isCompletionTone = (tags.indexOf('完了報告') !== -1) || /(終|終わ|完了|できた|片付)/.test(userText || '');
  let matchedCompletedTasks = [];
  if (isCompletionTone && allUncompletedTasks && allUncompletedTasks.length > 0 && (!liteResult || !liteResult.focused_task_ids || liteResult.focused_task_ids.length === 0)) {
    matchedCompletedTasks = allUncompletedTasks.filter(t => {
      if (!t.title) return false;
      const u = (userText || '').toLowerCase();
      const cleanTitle = t.title.replace(/^[^：:]+[：:]\s*/, '').replace(/（[^）]+）|\([^)]+\)/g, '').trim().toLowerCase();
      if (cleanTitle && u.includes(cleanTitle)) return true;
      const coreWord = cleanTitle.replace(/(作成|消化|クリア|購入|確認|掃除|手入れ|読む|見る|見学|周回)/g, '').trim();
      return (coreWord.length >= 2 && u.includes(coreWord));
    });
  }

  const needDbModule = Boolean(liteResult.need_db_action) ||
    (tags.indexOf('DB依頼') !== -1) ||
    hasImages ||
    hasStatedGoal ||
    (matchedCompletedTasks.length > 0) ||
    /(✅|タスク追加|タスク更新|タスク完了|タスク削除|予定追加|予定変更|カレンダー登録|買物追加|ルーティン|日課|定期|メモして|覚えて|記録して|反映して)/.test(userText);
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
    if (matchedCompletedTasks.length > 0) {
      effectiveTargetType = 'task_complete';
    } else if (effectiveTargetType === 'none' && hasStatedGoal) {
      effectiveTargetType = 'task_add';
    } else if (effectiveTargetType === 'none' && /(ルーティン|日課|定期)/.test(userText)) {
      effectiveTargetType = 'routine';
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

  // タスクの選別注入（Liteのキュレーションまたは完了照合タスクのみ注入し、機械的注入・sliceは完全撤廃）
  let tasksToInject = [];

  if (phase === 'PHASE_A' || phase === 'PHASE_B') {
    // 進行中保護 or 即時送り出し: 既存タスクの提案・提示は一切不要
    tasksToInject = [];
  } else if (liteResult && liteResult.focused_task_ids && liteResult.focused_task_ids.length > 0) {
    // Liteが状況・緊急度に合わせてキュレーションした着目・提案・操作タスク（Liteに一本化）
    tasksToInject = (allUncompletedTasks || []).filter(t => liteResult.focused_task_ids.indexOf(t.id) !== -1);
  } else if (matchedCompletedTasks.length > 0) {
    // 完了報告でLiteがIDを返さなかった場合のセーフティネット（一致したタスクのみピンポイント注入）
    tasksToInject = matchedCompletedTasks.slice(0, 2);
  } else if (liteResult && (liteResult.db_target_type === 'task_complete' || liteResult.db_target_type === 'task_update' || liteResult.db_target_type === 'task_delete')) {
    // タスク操作対象だがLiteがIDを返さなかった場合のフォールバック（発言キーワード合致タスクを抽出）
    const matched = (allUncompletedTasks || []).filter(t => userText && userText.includes(t.title));
    tasksToInject = matched.length > 0 ? matched.slice(0, 2) : [];
  } else {
    // 通常の余白・対話時: Liteがタスクを選定しなかった場合は一切注入しない（機械的な注入は全廃）
    tasksToInject = [];
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
      // ユーザーが明確な活動目標を表明していない時、またはタイスケ・過ごし方相談時に周期記録を提示候補として注入
      const isScheduleInquiry = (tags.indexOf('過ごし方相談') !== -1);
      const hasDeclaredGoal = (tags.indexOf('活動目標の表明') !== -1);
      if (!hasDeclaredGoal || isScheduleInquiry) {
        if (!hasDeclaredGoal && memory.skill_options && memory.skill_options.trim() !== '') {
          contextLines.push(`【能動的スキルアップメニュー (skill_options)】:\n${memory.skill_options.trim()}`);
        }
        if (memory.cycle_stamps && memory.cycle_stamps.trim() !== '') {
          const formattedStamps = formatCycleStampsWithElapsed_(memory.cycle_stamps, precomputed.todayDate);
          contextLines.push(`【活動・メンテナンス最終記録 (cycle_stamps)】:\n${formattedStamps}`);
        }
      }
      if (memory.weekly_summary && memory.weekly_summary.trim() !== '') {
        contextLines.push(`【直近1〜2週間の生活・活動サマリー】: ${memory.weekly_summary.trim()}`);
      }
    }
  }

  // カレンダー予定の動的注入（フェーズCの余白・提案・段取り時、または未来日程照会・カレンダー操作時は直近〜週末予定を注入）
  const needFutureCalendar = (phase === 'PHASE_C') ||
    Boolean(liteResult.future_schedule_inquiry) ||
    Boolean(liteResult.db_target_type === 'calendar');

  if (needFutureCalendar) {
    const excludeDate = (memory && memory._testCalendarExcludeDate) || '';
    const calCtx = getCalendarAndHolidayContext(precomputed.now, excludeDate);
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
 * 生活伴走システムの1ターン統合実行エンジン（Flash-Lite 司令塔 ＋ Flash 動的アセンブル実行）
 * @param {string} userText
 * @param {Array<GoogleAppsScript.Base.Blob>} imageBlobs
 * @param {string} todayLogsText
 * @param {Object=} memoryOpt
 * @param {Date=} simulatedNowDate
 * @return {{
 *   phase: string,
 *   phaseLabel: string,
 *   liteResult: Object,
 *   primaryResult: Object,
 *   logMeta: Object
 * }}
 */
function executeCompanionTurn(userText, imageBlobs, todayLogsText, memoryOpt, simulatedNowDate) {
  const memory = memoryOpt || getMemory();
  const now = simulatedNowDate || new Date();

  // 1. GAS前処理: 客観数値の機械的算出
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

  // 2. 前段 Flash-Lite 実行（意図分類・ルーティング）
  const hasImages = Boolean(imageBlobs && imageBlobs.length > 0);
  const liteCall = callGeminiLite(userText, hasImages, todayLogsText, memory, precomputed, allUncompletedTasks);
  const liteResult = liteCall.result;
  const liteUsage = liteCall.usage || {};

  // 3. GAS ルール層: フェーズ判定
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

  // 4. 後段 Flash のリクエスト構築
  const newPayload = buildNewSystemFlashPayload(userText, imageBlobs, todayLogsText, memory, liteResult, phase, precomputed, allUncompletedTasks);

  // 5. 後段 Flash の実行
  const singleRes = fetchGeminiResultWithRetry(newPayload);
  const newUsage = singleRes.usage || {};
  const newParsed = parseGeminiActionJson_(singleRes.text, newUsage);

  // 6. トークン集計
  const litePrompt = liteUsage.promptTokenCount || 0;
  const liteCand = liteUsage.candidatesTokenCount || 0;
  const liteCache = liteUsage.cachedContentTokenCount || 0;
  const liteTotal = liteUsage.totalTokenCount || (litePrompt + liteCand);

  const flashPrompt = newUsage.promptTokenCount || 0;
  const flashCand = newUsage.candidatesTokenCount || 0;
  const flashCache = newUsage.cachedContentTokenCount || 0;
  const flashTotal = newUsage.totalTokenCount || (flashPrompt + flashCand);

  const newTotalTokens = liteTotal + flashTotal;

  const logMeta = {
    isTwoModel: true,
    litePromptTokens: litePrompt,
    liteCandidatesTokens: liteCand,
    liteCachedTokens: liteCache,
    flashPromptTokens: flashPrompt,
    flashCandidatesTokens: flashCand,
    flashCachedTokens: flashCache,
    newTotalTokens: newTotalTokens,
    phaseAndTags: phaseAndTags
  };

  return {
    phase: phase,
    phaseLabel: phaseLabel,
    liteResult: liteResult,
    primaryResult: newParsed,
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
   - 【動的照合ルール】:
     * 上記【既存の周期イベント記録】に登録されている各項目名を参照し、当日の会話ログの中でその活動（または直接関連する作業・実験・実践など。例: 「楽曲制作・DTM」であれば作曲だけでなくDAW操作・音源設定・連携実験等も含む）が行われたことが確認できた項目の日付を当日（${targetDateStr}）に更新してください。
     * 既存の項目（過去に記録された日付や「未着手」の表記）は、当日のログで実施が確認されない限り、架空の日付を捏造せずそのままの値（「未着手」なら「未着手」のまま）を維持してください。
     * 勝手に新しい項目を捏造・追加せず、既存の項目セットをベースに日付のみを新陳代謝してください。
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
 * 開発・デバッグ用: Gemini APIの接続テスト（Lite & Flash 疎通確認）
 * GASエディタでこの関数を選択して実行すると、APIキーやエンドポイントの疎通確認が可能です。
 */
function testGeminiConnection() {
  const config = getConfig();
  Logger.log('Gemini API Key 確認: ' + (config.geminiApiKey ? config.geminiApiKey.substring(0, 6) + '...' : '未設定'));

  const testPayload = {
    contents: [{ role: 'user', parts: [{ text: 'こんにちは！テストです。' }] }]
  };

  try {
    const liteRes = fetchGeminiResultWithRetry(testPayload, SYSTEM_CONSTANTS.GEMINI_LITE_ENDPOINT_BASE);
    Logger.log('✅ Gemini Lite API 呼び出し成功: ' + liteRes.text);
  } catch (e) {
    Logger.log('❌ Gemini Lite API 呼び出し失敗: ' + e.message);
  }

  try {
    const flashRes = fetchGeminiResultWithRetry(testPayload, SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE);
    Logger.log('✅ Gemini Flash API 呼び出し成功: ' + flashRes.text);
  } catch (e) {
    Logger.log('❌ Gemini Flash API 呼び出し失敗: ' + e.message);
  }
}

