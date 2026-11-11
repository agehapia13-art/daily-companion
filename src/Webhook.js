/**
 * Webhook.js - LINE Webhookハンドラー（doPost / doGet）
 * 厳密なユーザー認証、ファースト・ハロー判定、超低遅延Reply、安全な後続データ反映
 */

/**
 * LINEプラットフォームからのWebhook POSTリクエストを受信・処理
 * @param {Object} e イベントオブジェクト
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'empty payload' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);

    // ダッシュボード（GitHub Pages等）からのJSON APIリクエスト処理
    if (payload && payload.apiAction) {
      const apiRes = handleDashboardApiRequest(payload);
      return ContentService.createTextOutput(JSON.stringify(apiRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const config = getConfig();
    const events = payload.events || [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // ----------------------------------------------------
      // 0. セキュリティ: オーナーUser ID検証（他者アクセス遮断）
      // ----------------------------------------------------
      const senderUserId = event.source ? event.source.userId : null;
      if (!senderUserId || senderUserId !== config.ownerUserId) {
        Logger.log(`[セキュリティ遮断] 未許可のUser IDです: ${senderUserId} (設定値: ${config.ownerUserId})。初回設定時はこのUser IDをスクリプトプロパティ OWNER_USER_ID に設定してください。`);
        continue;
      }

      // メッセージ受信イベントのみ対象
      if (event.type !== 'message') continue;

      const messageType = event.message ? event.message.type : '';
      const replyToken = event.replyToken;

      // ----------------------------------------------------
      // 1. 画像イベント（image）: Drive保存 & バッファ蓄積（返答なし）
      // ----------------------------------------------------
      if (messageType === 'image') {
        try {
          const savedImage = downloadLineImageAndSaveToDrive(event.message.id);
          addImageIdToBuffer(savedImage.fileId);
          continue;
        } catch (imgErr) {
          Logger.log('画像処理エラー: ' + imgErr.message);
          replyLineMessage(replyToken, '画像の保存中にエラーが発生しました。もう一度送信してください。');
          continue;
        }
      }

      // ----------------------------------------------------
      // 2. テキストイベント（text）: ファースト・ハロー合流 ＋ 即時返答
      // ----------------------------------------------------
      if (messageType === 'text') {
        const userText = event.message.text ? event.message.text.trim() : '';
        executeAndPersistCompanionTurn_({
          promptText: userText,
          displayText: userText,
          inlineImages: [],
          consumeBuffer: true,
          allowErrorFallback: true,
          onBeforePersist: function (displayReplyText) {
            // G. LINE Reply API で返答送信
            replyLineMessage(replyToken, displayReplyText);
          }
        });
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (globalErr) {
    Logger.log('doPost 全体例外: ' + globalErr.message);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: globalErr.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 本日のデイリーブリーフィング文字列をプログラム制御で直接組み立て（AI出力に依存せず100%確実に1日1回配信）
 * @return {string}
 */
function buildDailyBriefingText() {
  const memory = getMemory();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  // 1. 予定 (メインカレンダー + 家族共用カレンダーの「♪」付き)
  const todayEvents = getTodayEventsList();
  const hasOffice = todayEvents.some(evStr => evStr.includes('出社'));

  // 2. 天気（「出社」予定の有無に応じて渋谷の天気を出し分け）
  let weatherLine = '・天気: ';
  let weatherText = (memory.weather_info || '').trim();
  let pressureAlertVal = memory.pressure_alert;

  if (!weatherText || weatherText.includes('エラー') || (hasOffice && !weatherText.includes('｜'))) {
    try {
      const freshWeather = fetchWeatherAndPressure();
      if (freshWeather && freshWeather.weatherInfo && !freshWeather.weatherInfo.includes('エラー')) {
        weatherText = freshWeather.weatherInfo;
        pressureAlertVal = freshWeather.pressureAlert;
        setMemoryValue('weather_info', weatherText);
        setMemoryValue('pressure_alert', pressureAlertVal);
      }
    } catch (wErr) {}
  }

  if (!hasOffice && weatherText.includes('｜')) {
    weatherText = weatherText.split('｜')[0].trim();
  }

  if (weatherText && !weatherText.includes('エラー')) {
    weatherLine += weatherText;
  } else {
    weatherLine += '室内を過ごしやすい温度・湿度に整えてお過ごしください';
  }

  // 3. 気圧
  const isPressureDrop = pressureAlertVal === 'TRUE';
  const pressureLine = isPressureDrop
    ? '・気圧: ⚠️ 急降下アラート発令中（頭痛・体調の変化にご注意ください）'
    : '・気圧: 安定（急降下アラートなし）';

  // 4. 予定フォーマット
  let scheduleLine = '・予定: ';
  if (todayEvents.length > 0) {
    scheduleLine += todayEvents.join(' / ');
  } else {
    scheduleLine += 'カレンダーの登録予定なし（終日フリー）';
  }

  // 5. タスク (本日期限・期限超過、および最優先・優先度高め指定の重要タスク)
  const tasks = getTasks('未完了');
  const urgentTasks = tasks
    .filter(t => t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // 期限なしまたは未来期限であっても、リマインド目安やメモに「最優先」「優先度高」と指定された重要タスクを最大1〜2件合流
  const highPriorityTasks = tasks
    .filter(t => (!t.dueDate || t.dueDate > todayStr) && /最優先|優先度高/.test((t.remindContext || '') + (t.memo || '')))
    .slice(0, 2);

  const displayTasks = [...urgentTasks, ...highPriorityTasks];

  let taskLine = '';
  if (displayTasks.length > 0) {
    const formatTaskItem = (t) => {
      const base = formatTaskTitleWithBadge(t.title);
      if (t.dueDate && t.dueDate < todayStr) {
        return `⚠️[期限超過:${t.dueDate}] ${base}`;
      }
      if (!t.dueDate || t.dueDate > todayStr) {
        return `⭐[優先] ${base}`;
      }
      return base;
    };
    if (displayTasks.length === 1) {
      taskLine = `・タスク: ${formatTaskItem(displayTasks[0])}`;
    } else {
      taskLine = `・タスク (${displayTasks.length}件):\n` + displayTasks.map(t => `  - ${formatTaskItem(t)}`).join('\n');
    }
  } else {
    taskLine = '・タスク: 本日期限・優先の重要タスクはありません';
  }

  return `━━━━━━━━━━━━━━\n☀️ 本日のデイリーブリーフィング\n${weatherLine}\n${pressureLine}\n${scheduleLine}\n${taskLine}\n━━━━━━━━━━━━━━`;
}

/**
 * GETハンドラー: 生活伴走Webダッシュボード（HTML Service）を配信
 * （?mode=health 指定時のみ疎通確認テキストを返却）
 */
function doGet(e) {
  if (e && e.parameter) {
    if (e.parameter.mode === 'health') {
      return ContentService.createTextOutput('LINE Bot 生活秘書システムは正常稼働中です。')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    if (e.parameter.apiAction) {
      let args = [];
      try {
        if (e.parameter.args) args = JSON.parse(e.parameter.args);
      } catch (err) {}
      const apiRes = handleDashboardApiRequest({
        apiAction: e.parameter.apiAction,
        args: args
      });
      return ContentService.createTextOutput(JSON.stringify(apiRes))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return renderDashboardHtml(e);
}

/**
 * Gemini呼び出しエラーをユーザー向けの案内文とエラー種別へ変換
 * @param {Error} geminiErr
 * @return {{ code: string, message: string }}
 */
function classifyGeminiError_(geminiErr) {
  const errStr = String((geminiErr && geminiErr.message) || geminiErr || '');
  if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota') || errStr.includes('Credit')) {
    return {
      code: 'QUOTA',
      message: '【システム通知】Gemini APIのクレジット残高不足、または利用クォータの上限に達しました。\nGoogle AI Studio / Google Cloud コンソールの残高・お支払い情報をご確認ください。'
    };
  }
  if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand')) {
    return {
      code: 'UNAVAILABLE',
      message: '【システム通知】GoogleのAIサーバーが現在一時的にアクセス集中・混雑しています。\n自動再試行を行いましたが応答が得られませんでした。少し時間を置いてもう一度お話しください。'
    };
  }
  if (errStr.includes('401') || errStr.includes('403') || errStr.includes('API key')) {
    return {
      code: 'AUTH',
      message: '【システム通知】Gemini APIキーの認証に失敗しました。\nGASスクリプトプロパティの GEMINI_API_KEY 設定をご確認ください。'
    };
  }
  if (errStr.includes('404')) {
    return {
      code: 'NOT_FOUND',
      message: '【システム通知】Geminiの指定モデルが見つかりません(404)。\nモデル設定をご確認ください。'
    };
  }
  return {
    code: 'UNKNOWN',
    message: `【システム通知】思考エンジンの応答中にエラーが発生しました。\n詳細: ${errStr.substring(0, 100)}`
  };
}

/**
 * AI返答文に混入した手動通知風行を除去する（DB実行結果と二重表示を防ぐ）
 * @param {string} text
 * @return {string}
 */
function stripManualNoticeLines_(text) {
  return String(text || '').split('\n').filter(line => {
    const trimmed = line.trim();
    return !/^(📝\s*タスク追加|📝\s*タスク更新|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🎬\s*インプット|🔄\s*ルーティン|📁\s*フォルダ作成|📄\s*資料|🔗\s*タスク紐付)/.test(trimmed);
  }).join('\n').trim();
}

/**
 * LINE・PWA共通の生活伴走1ターン実行〜DB適用〜ブリーフィング合流〜ログ・メモリー永続化パイプライン
 * @param {Object} params
 * @param {string} params.promptText AIへ渡す入力文
 * @param {string=} params.displayText ログ保存・表示用の自然な発話文（省略時は promptText）
 * @param {Array<{ blob: GoogleAppsScript.Base.Blob, fileName?: string, url?: string }>=} params.inlineImages 直接添付された画像一覧（url未設定時はGemini成功後にDriveへ保存）
 * @param {boolean=} params.consumeBuffer 画像バッファ（LINE先行送信・ショートカット経由）を取り込むか（既定 true）
 * @param {boolean=} params.allowErrorFallback LINE向け: Geminiエラー時も通知返信＋ログ記録へフォールバックするか（既定 false）
 * @param {Function=} params.onBeforePersist 返答文確定直後（永続化直前）に呼ばれるコールバック（LINE即時返信等）
 * @return {Object} ターン実行結果
 */
function executeAndPersistCompanionTurn_(params) {
  const opts = params || {};
  const promptText = String(opts.promptText || '').trim();
  const displayBase = opts.displayText !== undefined ? String(opts.displayText).trim() : promptText;
  const consumeBuffer = opts.consumeBuffer !== false;
  const allowErrorFallback = !!opts.allowErrorFallback;
  const extraImages = Array.isArray(opts.inlineImages) ? opts.inlineImages : [];

  // A. 本日初回発言判定 (ファースト・ハロー)
  // ※朝ブリーフィングは午前04:00〜昼11:59（正午まで）の発言かつ、本日未配信の場合のみ発動
  const currentHour = new Date().getHours();
  const isMorningTime = currentHour >= 4 && currentHour < 12;
  const isFirstHello = isMorningTime && !isBriefingDeliveredToday();

  // B. 蓄積画像＋直接添付画像の統合
  const bufferedImages = consumeBuffer ? getBufferedImages() : { blobs: [], urls: [] };
  const extraBlobs = extraImages.map(img => img && img.blob).filter(Boolean);
  const imageBlobs = bufferedImages.blobs.concat(extraBlobs);
  let imageUrls = bufferedImages.urls.slice();

  // C. 本日の全会話ログおよびメモリー情報の取得
  const todayLogsCondensed = getCondensedTodayLogs();
  const memory = getMemory();

  // D. 生活伴走エンジン実行（Flash-Lite 司令塔 ＋ Flash 動的アセンブル）
  let turnOutcome = null;
  let aiResult;
  let isGeminiSuccess = false;
  let geminiErrInfo = null;
  try {
    turnOutcome = executeCompanionTurn(promptText, imageBlobs, todayLogsCondensed, memory);
    aiResult = turnOutcome.primaryResult;
    isGeminiSuccess = true;
  } catch (geminiErr) {
    Logger.log('Gemini呼び出しエラー: ' + String((geminiErr && geminiErr.message) || geminiErr));
    geminiErrInfo = classifyGeminiError_(geminiErr);

    if (!allowErrorFallback) {
      return {
        isGeminiSuccess: false,
        errorCode: geminiErrInfo.code,
        errorMessage: geminiErrInfo.message,
        pureReplyText: geminiErrInfo.message,
        executedNotices: [],
        briefingText: '',
        displayReplyText: geminiErrInfo.message,
        loggedUserText: displayBase,
        imageUrls: imageUrls,
        nowStr: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
        aiResult: null,
        turnOutcome: null
      };
    }

    aiResult = {
      reply_text: geminiErrInfo.message,
      task_actions: [],
      calendar_actions: [],
      shopping_actions: [],
      input_stock_actions: [],
      routine_actions: [],
      project_actions: []
    };
  }

  // 直接添付された画像はGemini成功後にDriveへ保存（失敗時の不要なDriveゴミを防止）
  if (isGeminiSuccess && extraImages.length > 0) {
    for (let i = 0; i < extraImages.length; i++) {
      const item = extraImages[i];
      if (!item) continue;
      if (item.url) {
        imageUrls.push(item.url);
      } else if (item.blob) {
        try {
          const fname = item.fileName || item.blob.getName() || `pwa_img_${Date.now()}_${i}.jpg`;
          const saved = saveImageBlobToDrive_(item.blob, fname);
          imageUrls.push(saved.url);
        } catch (imgSaveErr) {
          Logger.log('PWA添付画像のDrive保存エラー: ' + imgSaveErr.message);
        }
      }
    }
  }

  // F. DB・カレンダー操作アクションの即時適用
  let pureReplyText = (aiResult.reply_text || '了解いたしました。').trim();
  const executedNotices = [];

  try {
    let createdProjectUrlMap = {};
    if (aiResult.project_actions && aiResult.project_actions.length > 0 && typeof applyProjectActions === 'function') {
      const projRes = applyProjectActions(aiResult.project_actions);
      if (projRes && projRes.notices) {
        executedNotices.push.apply(executedNotices, projRes.notices);
      }
      if (projRes && projRes.createdUrlMap) {
        createdProjectUrlMap = projRes.createdUrlMap;
      }
    }
    if (aiResult.task_actions && aiResult.task_actions.length > 0) {
      const taskRes = applyTaskActions(aiResult.task_actions, createdProjectUrlMap);
      executedNotices.push.apply(executedNotices, taskRes);
    }
    if (aiResult.calendar_actions && aiResult.calendar_actions.length > 0) {
      const calRes = applyCalendarActions(aiResult.calendar_actions);
      executedNotices.push.apply(executedNotices, calRes);
    }
    if (aiResult.shopping_actions && aiResult.shopping_actions.length > 0) {
      const shopRes = applyShoppingActions(aiResult.shopping_actions);
      executedNotices.push.apply(executedNotices, shopRes);
    }
    if (aiResult.input_stock_actions && aiResult.input_stock_actions.length > 0) {
      const inputRes = applyInputStockActions(aiResult.input_stock_actions);
      executedNotices.push.apply(executedNotices, inputRes);
    }
    if (aiResult.routine_actions && aiResult.routine_actions.length > 0) {
      const routineRes = applyRoutineActions(aiResult.routine_actions);
      executedNotices.push.apply(executedNotices, routineRes);
    }
  } catch (actionErr) {
    Logger.log('アクション先行適用エラー: ' + actionErr.message);
  }

  if (executedNotices.length > 0) {
    pureReplyText = stripManualNoticeLines_(pureReplyText);
  }

  let loggedAiReply = pureReplyText;
  if (executedNotices.length > 0) {
    loggedAiReply += '\n\n' + executedNotices.join('\n');
  }

  let briefingText = '';
  if (isFirstHello && isGeminiSuccess) {
    markBriefingDeliveredToday();
    briefingText = buildDailyBriefingText();
    loggedAiReply += '\n\n' + briefingText;
  }

  if (typeof opts.onBeforePersist === 'function') {
    opts.onBeforePersist(loggedAiReply);
  }

  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  let loggedUserText = displayBase;
  if (aiResult.image_summary && aiResult.image_summary.trim() !== '') {
    const imgDesc = `[画像内容: ${aiResult.image_summary.trim()}]`;
    loggedUserText = loggedUserText ? `${loggedUserText}\n${imgDesc}` : imgDesc;
  }

  // H. 後続処理（バッファクリア・ログ保存・メモリー更新）
  try {
    if (isGeminiSuccess && consumeBuffer && bufferedImages.blobs.length > 0) {
      clearImageBuffer();
    }

    const imgUrlString = imageUrls.join('\n');
    const logMeta = turnOutcome ? turnOutcome.logMeta : (aiResult._usage || null);
    appendLog(nowStr, 'user', loggedUserText, imgUrlString, loggedAiReply, logMeta);

    if (aiResult.memory_updates) {
      if (aiResult.memory_updates.cycle_stamps_updates) {
        if (updateCycleStampsSafely(aiResult.memory_updates.cycle_stamps_updates)) {
          Logger.log('周期スタンプ(cycle_stamps)を更新しました: ' + aiResult.memory_updates.cycle_stamps_updates);
        }
      }
      if (aiResult.memory_updates.lifestyle_habits) {
        updateLifestyleHabitsSafely(aiResult.memory_updates.lifestyle_habits);
        Logger.log('生活習慣メモリー(lifestyle_habits)を更新しました');
      }
      if (aiResult.memory_updates.profile) {
        updateProfileSafely(aiResult.memory_updates.profile);
        Logger.log('プロファイル(profile)を安全に更新しました');
      }
      if (aiResult.memory_updates.dictionary) {
        updateDictionarySafely(aiResult.memory_updates.dictionary);
        Logger.log('用語辞書(dictionary)に新しい前提知識を安全に反映しました');
      }
    }

    if (memory.monthly_report_ready === 'TRUE') {
      setMemoryValue('monthly_report_ready', 'FALSE');
    }
  } catch (postProcessErr) {
    Logger.log('後続処理反映エラー: ' + postProcessErr.message);
  }

  return {
    isGeminiSuccess: isGeminiSuccess,
    errorCode: geminiErrInfo ? geminiErrInfo.code : '',
    errorMessage: geminiErrInfo ? geminiErrInfo.message : '',
    pureReplyText: pureReplyText,
    executedNotices: executedNotices,
    briefingText: briefingText,
    displayReplyText: loggedAiReply,
    loggedUserText: loggedUserText,
    imageUrls: imageUrls,
    nowStr: nowStr,
    aiResult: aiResult,
    turnOutcome: turnOutcome
  };
}
