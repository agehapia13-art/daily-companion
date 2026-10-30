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

        // A. 本日初回発言判定 (ファースト・ハロー)
        // ※朝ブリーフィングは午前04:00〜昼11:59（正午まで）の発言かつ、本日未配信の場合のみ発動
        // ※午後（12:00以降）や夜の発言では絶対に誤発動させない
        const currentHour = new Date().getHours();
        const isMorningTime = currentHour >= 4 && currentHour < 12;
        const isFirstHello = isMorningTime && !isBriefingDeliveredToday();

        // B. 蓄積画像の取得
        const bufferedImages = getBufferedImages();
        const imageBlobs = bufferedImages.blobs;
        const imageUrls = bufferedImages.urls;

        // C. 本日の全会話ログおよびメモリー情報の取得
        const todayLogsCondensed = getCondensedTodayLogs();
        const memory = getMemory();

        // D. 生活伴走エンジン実行（system_mode: AB_TEST | NEW | OLD 対応）
        let turnOutcome = null;
        let aiResult;
        let isGeminiSuccess = false;
        try {
          turnOutcome = executeCompanionTurn(userText, imageBlobs, todayLogsCondensed, memory);
          aiResult = turnOutcome.primaryResult;
          isGeminiSuccess = true;
        } catch (geminiErr) {
          const errStr = String(geminiErr.message || '');
          Logger.log('Gemini呼び出しエラー: ' + errStr);

          let errorReply = '申し訳ありません、システムの処理中にエラーが発生しました。';
          if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota') || errStr.includes('Credit')) {
            errorReply = '【システム通知】Gemini APIのクレジット残高不足、または利用クォータの上限に達しました。\nGoogle AI Studio / Google Cloud コンソールの残高・お支払い情報をご確認ください。';
          } else if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.includes('high demand')) {
            errorReply = '【システム通知】GoogleのAIサーバーが現在一時的にアクセス集中・混雑しています。\n自動再試行を行いましたが応答が得られませんでした。少し時間を置いてもう一度お話しください。';
          } else if (errStr.includes('401') || errStr.includes('403') || errStr.includes('API key')) {
            errorReply = '【システム通知】Gemini APIキーの認証に失敗しました。\nGASスクリプトプロパティの GEMINI_API_KEY 設定をご確認ください。';
          } else if (errStr.includes('404')) {
            errorReply = '【システム通知】Geminiの指定モデルが見つかりません(404)。\nモデル設定をご確認ください。';
          } else {
            errorReply = `【システム通知】思考エンジンの応答中にエラーが発生しました。\n詳細: ${errStr.substring(0, 100)}`;
          }

          aiResult = {
            reply_text: errorReply,
            task_actions: [],
            calendar_actions: [],
            shopping_actions: [],
            input_stock_actions: [],
            routine_actions: []
          };
        }

        // F. DB・カレンダー操作アクションの即時適用（※二重実行防止のため新システム側のアクションのみ実行）
        const stripManualNoticeLines = (text) => {
          return String(text || '').split('\n').filter(line => {
            const trimmed = line.trim();
            return !/^(📝\s*タスク追加|📝\s*タスク更新|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🎬\s*インプット|🔄\s*ルーティン)/.test(trimmed);
          }).join('\n').trim();
        };

        let pureReplyText = (aiResult.reply_text || '了解いたしました。').trim();
        const executedNotices = [];

        try {
          if (aiResult.task_actions && aiResult.task_actions.length > 0) {
            const taskRes = applyTaskActions(aiResult.task_actions);
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
          pureReplyText = stripManualNoticeLines(pureReplyText);
        }

        // logs シート保存用の新システム返答（次ターンの会話履歴汚染を防ぐため旧返答や比較装飾を含めない）
        let loggedAiReply = pureReplyText;
        if (executedNotices.length > 0) {
          loggedAiReply += '\n\n' + executedNotices.join('\n');
        }

        // LINE 送信用の表示テキスト構築（AB_TEST モード時は1吹き出しで上下比較表示）
        let lineDisplayText = loggedAiReply;
        if (isGeminiSuccess && turnOutcome && turnOutcome.mode === 'AB_TEST' && turnOutcome.oldResult) {
          const newTok = (turnOutcome.logMeta && turnOutcome.logMeta.newTotalTokens !== undefined)
            ? Number(turnOutcome.logMeta.newTotalTokens).toLocaleString()
            : '-';
          const oldTok = (turnOutcome.logMeta && turnOutcome.logMeta.oldTotalTokens !== undefined)
            ? Number(turnOutcome.logMeta.oldTotalTokens).toLocaleString()
            : '-';
          const oldCleanReply = stripManualNoticeLines(turnOutcome.oldResult.reply_text || '');

          lineDisplayText = `🆕【新システム】(${turnOutcome.phaseLabel} / 合計 ${newTok} tok)\n${pureReplyText}\n\n`;
          lineDisplayText += `━━━━━━━━━━━━━━\n`;
          lineDisplayText += `🕰️【旧システム】(合計 ${oldTok} tok)\n${oldCleanReply}`;

          if (turnOutcome.missedActionsNote) {
            lineDisplayText += `\n\n${turnOutcome.missedActionsNote}`;
          }
          if (executedNotices.length > 0) {
            lineDisplayText += `\n\n${executedNotices.join('\n')}`;
          }
        }

        // プログラム制御による朝ブリーフィング合流（1日1回・初回のみ確実に付加し即時配信完了記録）
        if (isFirstHello && isGeminiSuccess) {
          markBriefingDeliveredToday();
          const briefingText = buildDailyBriefingText();
          lineDisplayText += '\n\n' + briefingText;
          loggedAiReply += '\n\n' + briefingText;
        }

        // G. LINE Reply API で返答送信
        replyLineMessage(replyToken, lineDisplayText);

        // H. 返答完了後の後続処理（ログ保存・メモリー更新・バッファクリア）
        try {
          // Gemini呼び出しが成功した場合のみ画像バッファクリア
          if (isGeminiSuccess && imageBlobs.length > 0) {
            clearImageBuffer();
          }

          // ログ追記 (第5列には新システムの返答のみを保存し、第6〜16列にLite/Flash別トークン・判定・旧比較を記録)
          const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
          const imgUrlString = imageUrls.join('\n');
          let loggedUserText = userText;
          if (aiResult.image_summary && aiResult.image_summary.trim() !== '') {
            const imgDesc = `[画像内容: ${aiResult.image_summary.trim()}]`;
            loggedUserText = loggedUserText ? `${loggedUserText}\n${imgDesc}` : imgDesc;
          }
          const logMeta = turnOutcome ? turnOutcome.logMeta : (aiResult._usage || null);
          appendLog(nowStr, 'user', loggedUserText, imgUrlString, loggedAiReply, logMeta);

          // メモリー更新（AIが文脈や指示から判定して出力した各領域の更新を安全関数経由で反映）
          if (aiResult.memory_updates) {
            // 1. cycle_stamps のオンデマンド更新（散歩・読書・楽器・爪切り等の実施報告時）
            if (aiResult.memory_updates.cycle_stamps_updates) {
              updateCycleStampsSafely(aiResult.memory_updates.cycle_stamps_updates);
              Logger.log('周期スタンプ(cycle_stamps)を更新しました: ' + aiResult.memory_updates.cycle_stamps_updates);
            }

            // 2. lifestyle_habits のオンデマンド更新（生活リズム・こだわり・余白習慣の変更時）
            if (aiResult.memory_updates.lifestyle_habits) {
              updateLifestyleHabitsSafely(aiResult.memory_updates.lifestyle_habits);
              Logger.log('生活習慣メモリー(lifestyle_habits)を更新しました');
            }

            // 3. プロファイルの安全な新陳代謝・追記（住居・家族構成・勤務形態等の恒久基盤）
            if (aiResult.memory_updates.profile) {
              updateProfileSafely(aiResult.memory_updates.profile);
              Logger.log('プロファイル(profile)を安全に更新しました');
            }

            // 4. 用語辞書への追記（新出用語の定義や説明がある時）
            if (aiResult.memory_updates.dictionary) {
              updateDictionarySafely(aiResult.memory_updates.dictionary);
              Logger.log('用語辞書(dictionary)に新しい前提知識を安全に反映しました');
            }
          }

          // 月報通知フラグの解除
          if (memory.monthly_report_ready === 'TRUE') {
            setMemoryValue('monthly_report_ready', 'FALSE');
          }
        } catch (postProcessErr) {
          Logger.log('後続処理反映エラー: ' + postProcessErr.message);
        }
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

  // 5. タスク (本日期限および期限超過の未完了タスク)
  const tasks = getTasks('未完了');
  const urgentTasks = tasks
    .filter(t => t.dueDate && t.dueDate <= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let taskLine = '';
  if (urgentTasks.length > 0) {
    const formatUrgentTask = (t) => {
      const base = formatTaskTitleWithBadge(t.title);
      return t.dueDate < todayStr ? `⚠️[期限超過:${t.dueDate}] ${base}` : base;
    };
    if (urgentTasks.length === 1) {
      taskLine = `・タスク: ${formatUrgentTask(urgentTasks[0])}`;
    } else {
      taskLine = `・タスク (${urgentTasks.length}件):\n` + urgentTasks.map(t => `  - ${formatUrgentTask(t)}`).join('\n');
    }
  } else {
    taskLine = '・タスク: 本日期限の重要タスクはありません';
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
