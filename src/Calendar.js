/**
 * Calendar.js - Googleカレンダーおよび日本の祝日取得モジュール（動的ウィンドウ対応）
 */

/**
 * 曜日と時間帯に応じた動的ウィンドウでカレンダー予定と日本の祝日を取得し、コンテキスト文字列として整形
 * - 日曜 18:00以降: 今日〜翌週日曜 23:59:59 (来週1週間全体)
 * - それ以外 (月〜土、日曜18時前): 今日〜翌週月曜 23:59:59 (今週 + 直近週末 + 週明け月曜)
 * @return {string}
 */
function getCalendarAndHolidayContext() {
  const now = new Date();
  const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const dayOfWeek = now.getDay(); // 0: 日, 1: 月, 2: 火, 3: 水, 4: 木, 5: 金, 6: 土
  const currentHour = now.getHours();
  let endTime;

  if (dayOfWeek === 0 && currentHour >= 18) {
    // 日曜日の夕方18時以降: 来週1週間全体（翌週の日曜日23:59:59まで = +7日）
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);
  } else {
    // 通常（月〜土、または日曜18時前）: 直近の翌週月曜日23:59:59まで
    // 月曜(1)なら+7日、火曜(2)なら+6日、...土曜(6)なら+2日、日曜(0)昼なら+1日
    const daysUntilNextMonday = ((8 - dayOfWeek) % 7) || 7;
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextMonday, 23, 59, 59);
  }

  const startStrLabel = Utilities.formatDate(startTime, 'Asia/Tokyo', 'yyyy-MM-dd(E)');
  const endStrLabel = Utilities.formatDate(endTime, 'Asia/Tokyo', 'yyyy-MM-dd(E)');
  let calendarText = `=== Googleカレンダー予定（期間: ${startStrLabel} 〜 ${endStrLabel}） ===\n`;

  const config = getConfig();

  // 1. デフォルトカレンダー（個人メイン）のイベント取得
  try {
    const defaultCal = CalendarApp.getDefaultCalendar();
    if (defaultCal) {
      const events = defaultCal.getEvents(startTime, endTime);
      if (events.length === 0) {
        calendarText += '・[メインカレンダー] 登録された予定はありません。\n';
      } else {
        events.forEach(ev => {
          const title = ev.getTitle();
          if (ev.isAllDayEvent()) {
            const dateStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
            calendarText += `・[メイン終日] ${dateStr}: ${title}\n`;
          } else {
            const startStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
            const endStr = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
            calendarText += `・[メイン予定] ${startStr}〜${endStr}: ${title}\n`;
          }
        });
      }
    } else {
      calendarText += '・デフォルトカレンダーを取得できませんでした。\n';
    }
  } catch (e) {
    calendarText += `・メインカレンダー取得エラー: ${e.message}\n`;
  }

  // 2. 家族共用カレンダーのイベント取得（完全読み取り専用・「♪」記号フィルタ付き）
  if (config.familyCalendarId) {
    try {
      const familyCal = CalendarApp.getCalendarById(config.familyCalendarId);
      if (familyCal) {
        const familyEvents = familyCal.getEvents(startTime, endTime);
        // 「♪」が含まれるユーザー自身の予定のみを抽出
        const myFamilyEvents = familyEvents.filter(ev => ev.getTitle().includes('♪'));
        if (myFamilyEvents.length > 0) {
          calendarText += `\n=== 家族共用カレンダー（ユーザー担当分: ♪付きのみ） ===\n`;
          myFamilyEvents.forEach(ev => {
            const title = ev.getTitle();
            if (ev.isAllDayEvent()) {
              const dateStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
              calendarText += `・[共用終日] ${dateStr}: ${title}\n`;
            } else {
              const startStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
              const endStr = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
              calendarText += `・[共用予定] ${startStr}〜${endStr}: ${title}\n`;
            }
          });
        }
      }
    } catch (fErr) {
      calendarText += `・家族共用カレンダー取得エラー: ${fErr.message}\n`;
    }
  }

  // 3. 日本の祝日カレンダーのイベント取得
  calendarText += `\n=== 日本の祝日情報（期間内） ===\n`;
  try {
    const holidayCal = CalendarApp.getCalendarById(SYSTEM_CONSTANTS.JAPAN_HOLIDAY_CALENDAR_ID);
    if (holidayCal) {
      const holidays = holidayCal.getEvents(startTime, endTime);
      if (holidays.length === 0) {
        calendarText += '・期間中に祝日はありません。\n';
      } else {
        holidays.forEach(h => {
          const dateStr = Utilities.formatDate(h.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
          calendarText += `・${dateStr}: ${h.getTitle()}\n`;
        });
      }
    } else {
      calendarText += '・祝日カレンダーが見つかりませんでした。\n';
    }
  } catch (e) {
    calendarText += `・祝日カレンダー取得エラー: ${e.message}\n`;
  }

  return calendarText;
}

/**
 * 本日の予定一覧を高密度サマリー配列として取得（デイリーブリーフィング用）
 * メインカレンダー ＋ 家族共用カレンダー（♪付きのみ）
 * @return {Array<string>} 今日の予定文字列一覧
 */
function getTodayEventsList() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const eventStrings = [];
  const config = getConfig();

  // 1. メインカレンダー
  try {
    const defaultCal = CalendarApp.getDefaultCalendar();
    if (defaultCal) {
      const events = defaultCal.getEvents(todayStart, todayEnd);
      events.forEach(ev => {
        const title = ev.getTitle();
        if (ev.isAllDayEvent()) {
          eventStrings.push(`[終日] ${title}`);
        } else {
          const s = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm');
          const e = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
          eventStrings.push(`${s}〜${e} ${title}`);
        }
      });
    }
  } catch (e) {
    Logger.log('メインカレンダー本日予定取得失敗: ' + e.message);
  }

  // 2. 家族共用カレンダー（♪付きのみ）
  if (config.familyCalendarId) {
    try {
      const familyCal = CalendarApp.getCalendarById(config.familyCalendarId);
      if (familyCal) {
        const fEvents = familyCal.getEvents(todayStart, todayEnd);
        fEvents.filter(ev => ev.getTitle().includes('♪')).forEach(ev => {
          const title = ev.getTitle();
          if (ev.isAllDayEvent()) {
            eventStrings.push(`[共用終日] ${title}`);
          } else {
            const s = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm');
            const e = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
            eventStrings.push(`[共用] ${s}〜${e} ${title}`);
          }
        });
      }
    } catch (e) {
      Logger.log('家族カレンダー本日予定取得失敗: ' + e.message);
    }
  }

  return eventStrings;
}

/**
 * カレンダー操作アクションを適用（メインカレンダーのみ対象。家族カレンダーは絶対に変更しない）
 * 単発予定（createEvent）および毎週の曜日指定定期予定（createEventSeries）に対応
 * @param {Array<Object>} actions
 * @return {Array<string>} 適用結果メッセージ一覧
 */
function applyCalendarActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const defaultCal = CalendarApp.getDefaultCalendar();
  if (!defaultCal) {
    Logger.log('カレンダー操作エラー: デフォルトカレンダーが取得できません');
    return [];
  }

  const weekdayMap = {
    'MON': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    'MONDAY': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    '月': { enumVal: CalendarApp.Weekday.MONDAY, label: '月' },
    'TUE': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    'TUESDAY': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    '火': { enumVal: CalendarApp.Weekday.TUESDAY, label: '火' },
    'WED': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    'WEDNESDAY': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    '水': { enumVal: CalendarApp.Weekday.WEDNESDAY, label: '水' },
    'THU': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    'THURSDAY': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    '木': { enumVal: CalendarApp.Weekday.THURSDAY, label: '木' },
    'FRI': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    'FRIDAY': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    '金': { enumVal: CalendarApp.Weekday.FRIDAY, label: '金' },
    'SAT': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    'SATURDAY': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    '土': { enumVal: CalendarApp.Weekday.SATURDAY, label: '土' },
    'SUN': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' },
    'SUNDAY': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' },
    '日': { enumVal: CalendarApp.Weekday.SUNDAY, label: '日' }
  };

  const results = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    try {
      if (act.action === 'add' && act.title) {
        // 曜日指定の定期繰り返し設定（recurrence_days）の解析
        let rawDays = [];
        if (Array.isArray(act.recurrence_days)) {
          rawDays = act.recurrence_days;
        } else if (typeof act.recurrence_days === 'string' && act.recurrence_days.trim() !== '') {
          rawDays = act.recurrence_days.split(/[,\s・]+/);
        }

        const weekdayEnums = [];
        const weekdayLabels = [];
        for (let dIdx = 0; dIdx < rawDays.length; dIdx++) {
          const key = String(rawDays[dIdx]).trim().toUpperCase();
          if (weekdayMap[key] && weekdayEnums.indexOf(weekdayMap[key].enumVal) === -1) {
            weekdayEnums.push(weekdayMap[key].enumVal);
            weekdayLabels.push(weekdayMap[key].label);
          }
        }

        if (weekdayEnums.length > 0) {
          // 毎週の定期予定（EventSeries）として登録
          const recurrence = CalendarApp.newRecurrence().addWeeklyRule().onlyOnWeekdays(weekdayEnums);
          const sDate = act.start_time ? new Date(act.start_time) : new Date();

          // 既存の単発重複予定（同タイトル）が直近14日内にあれば事前クリーンアップして二重登録を防止
          const cleanupStart = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 0, 0, 0);
          const cleanupEnd = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate() + 14, 23, 59, 59);
          const existingEvents = defaultCal.getEvents(cleanupStart, cleanupEnd);
          for (let k = 0; k < existingEvents.length; k++) {
            if (existingEvents[k].getTitle() === act.title && !existingEvents[k].isRecurringEvent()) {
              existingEvents[k].deleteEvent();
            }
          }

          if (act.is_all_day) {
            defaultCal.createAllDayEventSeries(act.title, sDate, recurrence);
            results.push(`📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} / 終日)`);
          } else {
            const eDate = act.end_time ? new Date(act.end_time) : new Date(sDate.getTime() + 60 * 60 * 1000);
            defaultCal.createEventSeries(act.title, sDate, eDate, recurrence);
            const sTimeStr = Utilities.formatDate(sDate, 'Asia/Tokyo', 'HH:mm');
            const eTimeStr = Utilities.formatDate(eDate, 'Asia/Tokyo', 'HH:mm');
            results.push(`📅 カレンダー定期追加: ${act.title} (毎週${weekdayLabels.join('・')} ${sTimeStr}〜${eTimeStr})`);
          }
        } else if (act.is_all_day) {
          const d = act.start_time ? new Date(act.start_time) : new Date();
          defaultCal.createAllDayEvent(act.title, d);
          const dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
          results.push(`📅 カレンダー終日追加: ${act.title} (${dateStr})`);
        } else {
          const sDate = act.start_time ? new Date(act.start_time) : new Date();
          // end_timeが指定されていない場合は1時間後に設定
          const eDate = act.end_time ? new Date(act.end_time) : new Date(sDate.getTime() + 60 * 60 * 1000);
          defaultCal.createEvent(act.title, sDate, eDate);
          const sStr = Utilities.formatDate(sDate, 'Asia/Tokyo', 'MM/dd HH:mm');
          const eStr = Utilities.formatDate(eDate, 'Asia/Tokyo', 'HH:mm');
          results.push(`📅 カレンダー追加: ${act.title} (${sStr}〜${eStr})`);
        }
      } else if (act.action === 'delete' && act.title) {
        // 指定タイトルの予定を検索して削除
        const targetDate = act.date ? new Date(act.date) : new Date();
        const startDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const endDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);
        const events = defaultCal.getEvents(startDay, endDay);
        for (let j = 0; j < events.length; j++) {
          if (events[j].getTitle().includes(act.title)) {
            const evTitle = events[j].getTitle();
            if (act.delete_series && events[j].isRecurringEvent()) {
              events[j].getEventSeries().deleteEventSeries();
              results.push(`📅 カレンダー定期削除: ${evTitle}`);
            } else {
              events[j].deleteEvent();
              results.push(`📅 カレンダー削除: ${evTitle}`);
            }
            break;
          }
        }
      }
    } catch (actErr) {
      Logger.log(`カレンダーアクション実行エラー [${act.title}]: ` + actErr.message);
    }
  }

  return results;
}
