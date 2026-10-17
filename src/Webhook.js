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

        // C. コンテキスト情報の取得 (スプレッドシート & 動的カレンダー)
        const sheetContext = getSpreadsheetContext(userText);
        const calendarContext = getCalendarAndHolidayContext();
        const combinedContext = `${sheetContext}\n\n${calendarContext}`;

        // D. 本日の全会話ログ（極小高密度フォーマット: HH:mm User: ... / AI: ...）の取得
        const todayLogsCondensed = getCondensedTodayLogs();

        // E. Gemini 3.8 Flash 呼び出し（JSON取得）
        let aiResult;
        let isGeminiSuccess = false;
        try {
          aiResult = callGeminiFlash(userText, imageBlobs, combinedContext, todayLogsCondensed, isFirstHello);
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
            system_notification: '',
            task_actions: [],
            calendar_actions: [],
            shopping_actions: [],
            input_stock_actions: [],
            routine_actions: []
          };
        }

        // F. DB・カレンダー操作アクションの即時適用（ブリーフィングおよび返信文へ確実に反映させるため先に実行）
        let replyText = (aiResult.reply_text || '了解いたしました。').trim();
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

        // F2. 実行されたDB/カレンダー操作通知の統合（重複防止）
        // プログラムが正式な通知文字列（✅ タスク完了: ..., 📝 タスク追加: ..., 📅 カレンダー追加: ...）を一元付加する
        if (executedNotices.length > 0) {
          // AIが返信文内に手動で書いた可能性がある絵文字プレフィックス付き通知行を除去して一本化
          const cleanedReplyLines = replyText.split('\n').filter(line => {
            const trimmed = line.trim();
            return !/^(📝\s*タスク追加|✅\s*タスク完了|🗑️\s*タスク破棄|📅\s*カレンダー|🛒\s*買物|🔄\s*ルーティン)/.test(trimmed);
          });
          replyText = cleanedReplyLines.join('\n').trim();
          replyText += '\n\n' + executedNotices.join('\n');
        }

        // プログラム制御による朝ブリーフィング合流（1日1回・初回のみ確実に付加し即時配信完了記録）
        if (isFirstHello && isGeminiSuccess) {
          markBriefingDeliveredToday();
          replyText += '\n\n' + buildDailyBriefingText();
        }

        // G. LINE Reply API で返答送信
        replyLineMessage(replyToken, replyText);

        // H. 返答完了後の後続処理（ログ保存・メモリー更新・バッファクリア）
        try {
          // Gemini呼び出しが成功した場合のみ画像バッファクリア
          if (isGeminiSuccess && imageBlobs.length > 0) {
            clearImageBuffer();
          }

          // ログ追記 (画像内容の要約があればテキストに統合して保存し、文脈を永続化)
          const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
          const imgUrlString = imageUrls.join('\n');
          let loggedUserText = userText;
          if (aiResult.image_summary && aiResult.image_summary.trim() !== '') {
            const imgDesc = `[画像内容: ${aiResult.image_summary.trim()}]`;
            loggedUserText = loggedUserText ? `${loggedUserText}\n${imgDesc}` : imgDesc;
          }
          appendLog(nowStr, 'user', loggedUserText, imgUrlString, replyText);

          // メモリー更新: 日中の通常チャットでの profile 勝手な上書きを禁止（深夜バッチで1日まとめて慎重に代謝）
          // ※「プロファイル更新して」「設定変更して」等、ユーザーが明示的にプロファイル変更を求めた場合のみ日中反映
          if (aiResult.memory_updates) {
            const isExplicitProfileRequest = userText && (
              userText.includes('プロフィール') ||
              userText.includes('プロファイル') ||
              userText.includes('設定変更') ||
              userText.includes('覚えておいて') ||
              userText.includes('登録して')
            );

            if (isExplicitProfileRequest && aiResult.memory_updates.profile) {
              updateProfileSafely(aiResult.memory_updates.profile);
              Logger.log('ユーザー明示要求によりプロファイルを安全に更新/追記しました');
            }

            // 用語辞書への追記（辞書更新や新用語の定義がある場合）
            if (aiResult.memory_updates.dictionary) {
              updateDictionarySafely(aiResult.memory_updates.dictionary);
              Logger.log('用語辞書に新しい前提知識を安全に反映しました');
            }
          }

          // 月報通知フラグの解除
          const memory = getMemory();
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

  // 1. 天気
  let weatherLine = '・天気: ';
  let weatherText = (memory.weather_info || '').trim();
  if (!weatherText || weatherText.includes('エラー')) {
    try {
      const freshWeather = fetchWeatherAndPressure();
      if (freshWeather && freshWeather.weatherInfo && !freshWeather.weatherInfo.includes('エラー')) {
        weatherText = freshWeather.weatherInfo;
        setMemoryValue('weather_info', weatherText);
        setMemoryValue('pressure_alert', freshWeather.pressureAlert);
      }
    } catch (wErr) {}
  }
  if (weatherText && !weatherText.includes('エラー')) {
    weatherLine += weatherText;
  } else {
    weatherLine += '室内を過ごしやすい温度・湿度に整えてお過ごしください';
  }

  // 2. 気圧
  const isPressureDrop = memory.pressure_alert === 'TRUE';
  const pressureLine = isPressureDrop
    ? '・気圧: ⚠️ 急降下アラート発令中（頭痛・体調の変化にご注意ください）'
    : '・気圧: 安定（急降下アラートなし）';

  // 3. 予定 (メインカレンダー + 家族共用カレンダーの「♪」付き)
  const todayEvents = getTodayEventsList();
  let scheduleLine = '・予定: ';
  if (todayEvents.length > 0) {
    scheduleLine += todayEvents.join(' / ');
  } else {
    const rolling = memory.rolling_memory || '';
    if (rolling.includes('フルリモート') || rolling.includes('在宅')) {
      scheduleLine += '終日フルリモート作業（カレンダー登録なし）';
    } else {
      scheduleLine += 'カレンダーの登録予定なし（終日フリー）';
    }
  }

  // 4. タスク (本日期限の未完了タスク)
  const tasks = getTasks('未完了');
  const todayTasks = tasks.filter(t => t.dueDate === todayStr);
  let taskLine = '・タスク: ';
  if (todayTasks.length > 0) {
    taskLine += todayTasks.map(t => t.title).join(' / ');
  } else {
    taskLine += '本日期限の重要タスクはありません';
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
