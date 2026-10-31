/**
 * Calendar.js - Googleカレンダーおよび日本の祝日取得モジュール（動的ウィンドウ・複数家族共用カレンダー対応）
 */

const USER_PREFIX = '♪';
const OTHER_PREFIXES = ['◆', '★', '♯', '#'];

/**
 * 第2家族共用カレンダーの予定タイトルから抽出対象かどうかを判定
 * - 本人の記号（♪）が含まれる（単独、または ◆♪ / ♪★ 等の連名） -> 抽出: 共用(本人)
 * - 家族メンバーの記号（♪, ◆, ★, ♯, #）が一切含まれない -> 抽出: 共用(家族全体)
 * - 本人以外の記号のみ含まれる -> 除外
 * @param {string} title
 * @return {{include: boolean, category: string}}
 */
function evaluateHouseholdEvent(title) {
  const t = String(title || '');
  if (t.includes(USER_PREFIX)) {
    return { include: true, category: '共用(本人)' };
  }
  const hasOther = OTHER_PREFIXES.some(p => t.includes(p));
  if (!hasOther) {
    return { include: true, category: '共用(家族全体)' };
  }
  return { include: false, category: '除外' };
}

/**
 * 曜日と時間帯に応じた動的ウィンドウでカレンダー予定と日本の祝日を取得し、コンテキスト文字列として整形
 * - 日曜 18:00以降: 今日〜翌週日曜 23:59:59 (来週1週間全体)
 * - それ以外 (月〜土、日曜18時前): 今日〜翌週月曜 23:59:59 (今週 + 直近週末 + 週明け月曜)
 * @param {Date=} simulatedNowDate オプション: シミュレーション日時
 * @return {string}
 */
function getCalendarAndHolidayContext(simulatedNowDate) {
  const now = simulatedNowDate || new Date();
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

  // 2. 第1家族共用カレンダーのイベント取得（完全読み取り専用・「♪」記号フィルタ付き）
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

  // 3. 第2家族共用カレンダーのイベント取得（完全読み取り専用・♪付き および プレフィックスなし＝家族全体を抽出）
  if (config.householdCalendarId && config.householdCalendarId !== config.familyCalendarId) {
    try {
      const householdCal = CalendarApp.getCalendarById(config.householdCalendarId);
      if (householdCal) {
        const hEvents = householdCal.getEvents(startTime, endTime);
        const matchedHouseholdEvents = [];
        hEvents.forEach(ev => {
          const evalRes = evaluateHouseholdEvent(ev.getTitle());
          if (evalRes.include) {
            matchedHouseholdEvents.push({ ev: ev, category: evalRes.category });
          }
        });
        if (matchedHouseholdEvents.length > 0) {
          calendarText += `\n=== 第2家族共用カレンダー（本人関与 ＆ 家族全体） ===\n`;
          matchedHouseholdEvents.forEach(item => {
            const ev = item.ev;
            const title = ev.getTitle();
            const cat = item.category;
            if (ev.isAllDayEvent()) {
              const dateStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
              calendarText += `・[${cat}・終日] ${dateStr}: ${title}\n`;
            } else {
              const startStr = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
              const endStr = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
              calendarText += `・[${cat}] ${startStr}〜${endStr}: ${title}\n`;
            }
          });
        }
      }
    } catch (hErr) {
      calendarText += `・第2家族共用カレンダー取得エラー: ${hErr.message}\n`;
    }
  }

  // 4. 日本の祝日カレンダーのイベント取得（期間内に祝日が存在する場合のみ出力してトークン節約）
  try {
    const holidayCal = CalendarApp.getCalendarById(SYSTEM_CONSTANTS.JAPAN_HOLIDAY_CALENDAR_ID);
    if (holidayCal) {
      const holidays = holidayCal.getEvents(startTime, endTime);
      if (holidays.length > 0) {
        calendarText += `\n=== 日本の祝日情報（期間内） ===\n`;
        holidays.forEach(h => {
          const dateStr = Utilities.formatDate(h.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd(E)');
          calendarText += `・${dateStr}: ${h.getTitle()}\n`;
        });
      }
    }
  } catch (e) {
    Logger.log(`祝日カレンダー取得エラー: ${e.message}`);
  }

  return calendarText;
}

/**
 * 本日の予定一覧を高密度サマリー配列として取得（デイリーブリーフィング・Liteコンテキスト用）
 * メインカレンダー ＋ 第1家族共用カレンダー（♪付きのみ） ＋ 第2家族共用カレンダー（♪付き＆プレフィックスなし）
 * @param {Date=} simulatedNowDate
 * @return {Array<string>} 今日の予定文字列一覧
 */
function getTodayEventsList(simulatedNowDate) {
  const now = simulatedNowDate || new Date();
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

  // 2. 第1家族共用カレンダー（♪付きのみ）
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

  // 3. 第2家族共用カレンダー（♪付き＆プレフィックスなし）
  if (config.householdCalendarId && config.householdCalendarId !== config.familyCalendarId) {
    try {
      const householdCal = CalendarApp.getCalendarById(config.householdCalendarId);
      if (householdCal) {
        const hEvents = householdCal.getEvents(todayStart, todayEnd);
        hEvents.forEach(ev => {
          const title = ev.getTitle();
          const evalRes = evaluateHouseholdEvent(title);
          if (evalRes.include) {
            if (ev.isAllDayEvent()) {
              eventStrings.push(`[${evalRes.category}・終日] ${title}`);
            } else {
              const s = Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'HH:mm');
              const e = Utilities.formatDate(ev.getEndTime(), 'Asia/Tokyo', 'HH:mm');
              eventStrings.push(`[${evalRes.category}] ${s}〜${e} ${title}`);
            }
          }
        });
      }
    } catch (e) {
      Logger.log('第2家族カレンダー本日予定取得失敗: ' + e.message);
    }
  }

  return eventStrings;
}

/**
 * 予定タイトルが「タスク消化」「作業」「整理」などの包括的タスク枠（アンブレラ枠）かどうかを判定
 * （単一の具体的行為ではなく、複数のタスクを消化・推進するための時間枠）
 * @param {string} title
 * @return {boolean}
 */
function isUmbrellaEventTitle(title) {
  if (!title || typeof title !== 'string') return false;
  return /(タスク|作業|整理|片付|片づけ|自由時間|フリー|予備|余白|バッファ|段取り)/i.test(title);
}

/**
 * 現在のカレンダー予定の有無と、次の境界（直近予定または23:00就寝目安）までの残り分数を機械的に算出
 * （Flash-LiteおよびFlashに暗算させず、正確な時間の鏡を提供するためのGAS前処理関数）
 * @param {Date=} simulatedNowDate
 * @return {{isDuringEvent: boolean, currentEventTitle: string|null, currentEventRemainingMinutes: number, isUmbrellaEvent: boolean, minutesUntilNext: number, summaryText: string}}
 */
function getNextBoundaryInfo(simulatedNowDate) {
  const now = simulatedNowDate || new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const config = getConfig();

  const timedEvents = [];

  // 1. メインカレンダーの時間指定予定
  try {
    const defaultCal = CalendarApp.getDefaultCalendar();
    if (defaultCal) {
      defaultCal.getEvents(todayStart, todayEnd).forEach(ev => {
        if (!ev.isAllDayEvent()) {
          timedEvents.push({ title: ev.getTitle(), start: ev.getStartTime(), end: ev.getEndTime() });
        }
      });
    }
  } catch (e) {}

  // 2. 第1家族共用カレンダー（♪付き）の時間指定予定
  if (config.familyCalendarId) {
    try {
      const familyCal = CalendarApp.getCalendarById(config.familyCalendarId);
      if (familyCal) {
        familyCal.getEvents(todayStart, todayEnd).forEach(ev => {
          if (!ev.isAllDayEvent() && ev.getTitle().includes('♪')) {
            timedEvents.push({ title: ev.getTitle(), start: ev.getStartTime(), end: ev.getEndTime() });
          }
        });
      }
    } catch (e) {}
  }

  // 3. 第2家族共用カレンダー（本人関与のみ時間拘束としてカウント）の時間指定予定
  if (config.householdCalendarId && config.householdCalendarId !== config.familyCalendarId) {
    try {
      const householdCal = CalendarApp.getCalendarById(config.householdCalendarId);
      if (householdCal) {
        householdCal.getEvents(todayStart, todayEnd).forEach(ev => {
          if (!ev.isAllDayEvent()) {
            const evalRes = evaluateHouseholdEvent(ev.getTitle());
            if (evalRes.include) {
              timedEvents.push({ title: `[${evalRes.category}] ${ev.getTitle()}`, start: ev.getStartTime(), end: ev.getEndTime() });
            }
          }
        });
      }
    } catch (e) {}
  }

  timedEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  const nowMs = now.getTime();
  const activeEvents = [];
  let nextEvent = null;

  for (let i = 0; i < timedEvents.length; i++) {
    const ev = timedEvents[i];
    const sMs = ev.start.getTime();
    const eMs = ev.end.getTime();
    if (sMs <= nowMs && nowMs < eMs) {
      activeEvents.push(ev);
    } else if (sMs > nowMs && !nextEvent) {
      nextEvent = ev;
    }
  }

  const formatMins = (mins) => {
    if (mins < 60) return `${mins}分`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}時間${m}分（計${mins}分）` : `${h}時間（計${mins}分）`;
  };

  if (activeEvents.length > 0) {
    const cur = activeEvents[0];
    const remMins = Math.max(1, Math.round((cur.end.getTime() - nowMs) / 60000));
    const sStr = Utilities.formatDate(cur.start, 'Asia/Tokyo', 'HH:mm');
    const eStr = Utilities.formatDate(cur.end, 'Asia/Tokyo', 'HH:mm');
    const isUmbrella = isUmbrellaEventTitle(cur.title);

    let text = isUmbrella
      ? `現在予定の最中（タスク・作業包括枠）: 「${cur.title}」(${sStr}〜${eStr} / 枠終了まで残り${formatMins(remMins)})`
      : `現在予定の最中: 「${cur.title}」(${sStr}〜${eStr} / 終了まで残り${formatMins(remMins)})`;

    if (nextEvent) {
      const nsStr = Utilities.formatDate(nextEvent.start, 'Asia/Tokyo', 'HH:mm');
      const minsToNext = Math.max(1, Math.round((nextEvent.start.getTime() - nowMs) / 60000));
      text += ` ｜ 次の予定: 「${nextEvent.title}」(${nsStr}〜 / 開始まであと${formatMins(minsToNext)})`;
    }
    return {
      isDuringEvent: true,
      currentEventTitle: cur.title,
      currentEventRemainingMinutes: remMins,
      isUmbrellaEvent: isUmbrella,
      minutesUntilNext: isUmbrella ? remMins : 0,
      summaryText: text
    };
  }

  if (nextEvent) {
    const minsUntilNext = Math.max(1, Math.round((nextEvent.start.getTime() - nowMs) / 60000));
    const sStr = Utilities.formatDate(nextEvent.start, 'Asia/Tokyo', 'HH:mm');
    const eStr = Utilities.formatDate(nextEvent.end, 'Asia/Tokyo', 'HH:mm');
    return {
      isDuringEvent: false,
      currentEventTitle: null,
      currentEventRemainingMinutes: 0,
      isUmbrellaEvent: false,
      minutesUntilNext: minsUntilNext,
      summaryText: `次の予定「${nextEvent.title} (${sStr}〜${eStr})」まで残り ${formatMins(minsUntilNext)}`
    };
  }

  // 本日これ以降のカレンダー時間指定予定がない場合、23:00就寝目安までの残り時間を計算
  const bedtime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0);
  const minsUntilBed = Math.round((bedtime.getTime() - nowMs) / 60000);
  if (minsUntilBed > 0) {
    return {
      isDuringEvent: false,
      currentEventTitle: null,
      currentEventRemainingMinutes: 0,
      isUmbrellaEvent: false,
      minutesUntilNext: minsUntilBed,
      summaryText: `本日のこれ以降のカレンダー固定予定なし（23:00就寝目安まで残り ${formatMins(minsUntilBed)}）`
    };
  } else {
    return {
      isDuringEvent: false,
      currentEventTitle: null,
      currentEventRemainingMinutes: 0,
      isUmbrellaEvent: false,
      minutesUntilNext: 0,
      summaryText: `本日の固定予定なし（23:00就寝目安時刻を過ぎています）`
    };
  }
}

/**
 * 本日のカレンダー予定（メイン＋家族共用♪）に「出社」が含まれているか判定
 * @return {boolean}
 */
function hasOfficeEventToday() {
  const todayEvents = getTodayEventsList();
  return todayEvents.some(evStr => evStr.includes('出社'));
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
