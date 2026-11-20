/**
 * FastState.js - v2 二層高速ステート管理・論理日境界（03:00）・アンカーカード合成モジュール
 * PropertiesService (V2_FAST_STATE) による最速応答と、スプレッドシート memory.V2_FAST_STATE ミラー復旧を担う
 */

/**
 * 論理日キー（03:00〜翌02:59 JST）を yyyy-MM-dd 形式で返す
 * @param {Date=} nowOpt
 * @return {string}
 */
function getLogicalDayKey(nowOpt) {
  const now = nowOpt || new Date();
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return Utilities.formatDate(shifted, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 初期 FastState オブジェクトを生成
 * @param {string} dayKey
 * @return {Object}
 */
function createEmptyFastState_(dayKey) {
  return {
    dayKey: dayKey || getLogicalDayKey(),
    activeSession: null,
    completedToday: {},
    dismissedToday: {},
    isLowMode: false,
    triagedToday: false,
    lastAction: null,
    weatherFetchedAt: '',
    dailyBriefing: null,
    aiDeck: {
      generatedAt: '',
      cards: [],
      lowCards: []
    },
    listCache: {
      updatedAt: '',
      tasks: [],
      shopping: [],
      stock: [],
      habits: []
    }
  };
}

/**
 * 論理日境界（03:00 JST）跨ぎ時の状態クリーンアップ（日跨ぎ就寝 activeSession は完全保護）
 * @param {Object} state
 * @param {Date=} nowOpt
 * @return {{ state: Object, rolledOver: boolean }}
 */
function ensureLogicalDayBoundary(state, nowOpt) {
  const now = nowOpt || new Date();
  const currentDayKey = getLogicalDayKey(now);
  if (!state || typeof state !== 'object') {
    return { state: createEmptyFastState_(currentDayKey), rolledOver: true };
  }

  const normalized = Object.assign(createEmptyFastState_(currentDayKey), state);
  if (normalized.dayKey === currentDayKey) {
    return { state: normalized, rolledOver: false };
  }

  // 03:00 境界を跨いだ場合: 日次フラグのみリセットし、就寝セッションは維持する
  const preservedSleep = (normalized.activeSession && normalized.activeSession.isSleepCard)
    ? normalized.activeSession
    : null;

  normalized.dayKey = currentDayKey;
  normalized.activeSession = preservedSleep;
  normalized.completedToday = {};
  normalized.dismissedToday = {};
  normalized.isLowMode = false;
  normalized.triagedToday = false;
  return { state: normalized, rolledOver: true };
}

/**
 * FastState を PropertiesService から高速読込（欠損時はシート memory.V2_FAST_STATE から自動復旧）
 * @param {Date=} nowOpt
 * @return {Object}
 */
function loadFastState(nowOpt) {
  const now = nowOpt || new Date();
  const props = PropertiesService.getScriptProperties();
  let parsed = null;

  const rawProp = props.getProperty(SYSTEM_CONSTANTS.V2_FAST_STATE_PROP_KEY);
  if (rawProp) {
    try {
      parsed = JSON.parse(rawProp);
    } catch (e) {
      Logger.log('V2_FAST_STATE parse error (PropertiesService): ' + e.message);
    }
  }

  if (!parsed) {
    try {
      const mem = getMemory();
      if (mem && mem.V2_FAST_STATE) {
        parsed = JSON.parse(mem.V2_FAST_STATE);
      }
    } catch (e2) {
      Logger.log('V2_FAST_STATE restore error (Spreadsheet): ' + e2.message);
    }
  }

  const check = ensureLogicalDayBoundary(parsed, now);
  if (check.rolledOver || !rawProp) {
    saveFastState(check.state, check.rolledOver);
  }
  return check.state;
}

/**
 * FastState を PropertiesService（および必要に応じて memory シートミラー）へ保存
 * @param {Object} state
 * @param {boolean=} syncSheetMirror
 */
function saveFastState(state, syncSheetMirror) {
  if (!state) return;
  const serialized = JSON.stringify(state);
  // PropertiesService の 9KB/key 上限ガード（リストキャッシュが肥大化した場合は圧縮）
  let toStore = serialized;
  if (toStore.length > 8500 && state.listCache) {
    const slimState = Object.assign({}, state, {
      listCache: { updatedAt: state.listCache.updatedAt || '', tasks: [], shopping: [], stock: [], habits: [] }
    });
    toStore = JSON.stringify(slimState);
  }
  try {
    PropertiesService.getScriptProperties().setProperty(SYSTEM_CONSTANTS.V2_FAST_STATE_PROP_KEY, toStore);
  } catch (e) {
    Logger.log('saveFastState PropertiesService error: ' + e.message);
  }

  if (syncSheetMirror) {
    try {
      setMemoryValue('V2_FAST_STATE', toStore);
    } catch (e2) {
      Logger.log('saveFastState Sheet mirror error: ' + e2.message);
    }
  }
}

/**
 * スプレッドシートの現在状態から Lists タブ用の統一スナップショットを構築
 * @param {Object=} memoryOpt
 * @param {Date=} nowOpt
 * @return {{ tasks: Array, shopping: Array, stock: Array, habits: Array, updatedAt: string }}
 */
function buildListsSnapshot(memoryOpt, nowOpt) {
  const now = nowOpt || new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const memory = memoryOpt || getMemory();

  // 1. Tasks（未完了 ＋ 本日完了分、期限順ソート）
  const rawTasks = getTasks();
  const allTasks = typeof sortTasksByUrgency_ === 'function' ? sortTasksByUrgency_(rawTasks, todayStr) : rawTasks;
  const tasks = allTasks
    .filter(t => t.status === '未完了' || (t.status === '完了' && t.completedDate === todayStr))
    .map(t => {
      let cat = 'その他';
      let cleanTitle = String(t.title || '').trim();
      const bm = cleanTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (bm) {
        cat = bm[1].trim();
        cleanTitle = bm[2].trim();
      }
      return {
        id: t.id,
        cat: cat,
        title: t.title,
        cleanTitle: cleanTitle,
        due: t.dueDate || '',
        mins: t.estimatedMins || 30,
        memo: t.memo || '',
        remindContext: t.remindContext || '',
        docUrl: t.docUrl || '',
        done: t.status === '完了'
      };
    });

  // 2. Shopping（未買のみ）
  const shopping = getShoppingList('未買').map(s => ({
    id: 'SHOP_' + s.rowIndex,
    rowIndex: s.rowIndex,
    item: s.item,
    cat: s.category || '日用品',
    createdDate: s.createdDate || '',
    done: false
  }));

  // 3. Input Stock（未消化 ＋ 本日消化分）
  const stock = getInputStockList()
    .filter(i => i.status === '未' || (i.status === '完' && i.consumedDate === todayStr))
    .map(i => ({
      id: 'INPUT_' + i.rowIndex,
      rowIndex: i.rowIndex,
      type: i.type || 'その他',
      title: i.title,
      memo: i.memo || '',
      mins: i.estimatedMins || 30,
      done: i.status === '完'
    }));

  // 4. Habits（cycle_stamps ベース）
  const habits = [];
  const rawStamps = (memory && memory.cycle_stamps) ? String(memory.cycle_stamps).trim() : '';
  if (rawStamps) {
    const lines = rawStamps.split(/[,\n、]+/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([^:：]+)[：:]\s*(.+)$/);
      const label = m ? m[1].replace(/^[・\-\s]+/, '').trim() : lines[i];
      const val = m ? m[2].trim() : '';
      let dateStr = '';
      let elapsedDays = null;
      const dm = val.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
      if (dm) {
        dateStr = dm[1].replace(/\//g, '-');
        const p = dateStr.split('-');
        const dt = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
        if (!isNaN(dt.getTime())) {
          elapsedDays = Math.max(0, Math.floor((todayDate.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }
      const elapsedText = (elapsedDays === null)
        ? '未着手'
        : (elapsedDays === 0 ? '今日' : `${elapsedDays}日前`);
      habits.push({
        id: 'HABIT_' + label,
        title: label,
        date: dateStr,
        elapsedDays: elapsedDays,
        elapsed: elapsedText,
        mins: getDefaultHabitEstimatedMins_(label),
        stampedToday: elapsedDays === 0
      });
    }
    habits.sort((a, b) => {
      const ae = a.elapsedDays === null ? 9999 : a.elapsedDays;
      const be = b.elapsedDays === null ? 9999 : b.elapsedDays;
      return be - ae;
    });
  }

  return {
    updatedAt: Utilities.formatDate(now, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss+09:00"),
    tasks: tasks,
    shopping: shopping,
    stock: stock,
    habits: habits
  };
}

/**
 * 習慣項目名に応じた見込み目安分数
 * @param {string} label
 * @return {number}
 */
function getDefaultHabitEstimatedMins_(label) {
  const s = String(label || '');
  if (/爪切り/.test(s)) return 5;
  if (/室内運動|フィットネス/.test(s)) return 20;
  if (/散歩|外歩き/.test(s)) return 30;
  if (/アニメ|映画/.test(s)) return 45;
  if (/DTM|楽曲/.test(s)) return 45;
  return 20;
}

/**
 * コード側担当の確定アンカーカード（朝の細分化身支度・勤務ブロック・日跨ぎ就寝）を生成
 * @param {string} workMode 'commute' | 'remote' | 'holiday'
 * @param {Date} now
 * @param {Object} fastState
 * @return {Array<Object>}
 */
function buildRoutineAnchorCards(workMode, now, fastState) {
  const minsOfDay = now.getHours() * 60 + now.getMinutes();
  const completed = (fastState && fastState.completedToday) || {};
  const dismissed = (fastState && fastState.dismissedToday) || {};
  const avail = (id) => !completed[id] && !dismissed[id];
  const cards = [];

  // 1. 朝の身支度（細分化維持: 午前中 04:00〜12:59 の間、未完分を順次表示）
  if (minsOfDay >= 4 * 60 && minsOfDay < 13 * 60) {
    if (avail('anchor_breakfast')) {
      cards.push({ id: 'anchor_breakfast', icon: 'coffee', title: '朝食', sub: 'まずは食べて体を起こす', mins: 20, isAnchor: true });
    }
    if (avail('anchor_dress')) {
      cards.push({ id: 'anchor_dress', icon: 'shirt', title: '着替え', sub: '今日の服に着替える', mins: 10, isAnchor: true });
    }
    if (avail('anchor_makeup')) {
      cards.push({ id: 'anchor_makeup', icon: 'sparkles', title: 'メイク', sub: 'ベースから仕上げまで', mins: 15, isAnchor: true });
    }
    if (avail('anchor_hair')) {
      cards.push({ id: 'anchor_hair', icon: 'wind', title: 'ヘアセット', sub: '髪を整えて身支度を仕上げる', mins: 10, isAnchor: true });
    }
    if (workMode === 'commute' && avail('anchor_commute')) {
      cards.push({ id: 'anchor_commute', icon: 'train', title: '出社（移動）', sub: '最寄り駅まで歩き、渋谷へ', mins: 90, isAnchor: true, cycleStampLabel: '外歩き・散歩' });
    }
  }

  // 2. 平日勤務ブロック（10:00〜19:00、昼休憩 12:00〜13:00）
  if (workMode !== 'holiday') {
    if (minsOfDay >= 9 * 60 + 30 && minsOfDay < 12 * 60 && avail('anchor_work_am')) {
      cards.push({ id: 'anchor_work_am', icon: 'laptop', title: '本業（午前）', sub: '12:00の昼休憩まで集中', mins: 120, isWorkBlock: true, isAnchor: true });
    }
    if (minsOfDay >= 12 * 60 && minsOfDay < 14 * 60 && avail('anchor_lunch')) {
      cards.push({ id: 'anchor_lunch', icon: 'utensils', title: '昼食・昼休憩', sub: 'しっかり休んで午後に備える', mins: 60, isAnchor: true });
    }
    if (minsOfDay >= 12 * 60 + 45 && minsOfDay < 18 * 60 + 30 && avail('anchor_work_pm')) {
      cards.push({ id: 'anchor_work_pm', icon: 'laptop', title: '本業（午後）', sub: '19:00の終業まで進める', mins: 240, isWorkBlock: true, isAnchor: true });
    }
    if (workMode === 'commute' && minsOfDay >= 18 * 60 && minsOfDay < 22 * 60 && avail('anchor_return')) {
      cards.push({ id: 'anchor_return', icon: 'train', title: '帰路（帰宅移動）', sub: '業務終了、自宅へ帰る', mins: 90, isAnchor: true, cycleStampLabel: '外歩き・散歩' });
    }
  }

  const rawAiCards = (fastState.aiDeck && Array.isArray(fastState.aiDeck.cards)) ? fastState.aiDeck.cards : [];
  const hasAiAnchor = (id) => rawAiCards.some(c => c && c.id === id);

  // 2.5 風呂上がりスキンケア（入浴完了後のみ最優先表示）
  if (completed['anchor_bath'] && avail('anchor_skincare')) {
    cards.push({ id: 'anchor_skincare', icon: 'sparkles', title: '風呂上がりのスキンケア', sub: '肌を整えてリラックス', mins: 15, isAnchor: true });
  }

  // 2.6 夕方以降の生活アンカー（AIが既に配置していればAIの順番を尊重、未配置時のみ補完）
  if (minsOfDay >= 17 * 60) {
    if (avail('anchor_dinner') && !hasAiAnchor('anchor_dinner')) {
      cards.push({ id: 'anchor_dinner', icon: 'utensils', title: '夕食', sub: '一息ついてしっかり食べる', mins: 45, isAnchor: true });
    }
    if (avail('anchor_bath') && !hasAiAnchor('anchor_bath')) {
      cards.push({ id: 'anchor_bath', icon: 'droplet', title: '入浴', sub: '湯船で一日の疲れを流す', mins: 30, isAnchor: true });
    }
  }

  // 3. 日跨ぎ「就寝」カード（21:30以降〜翌04:00前まで保証）
  if ((minsOfDay >= 21 * 60 + 30 || minsOfDay < 4 * 60) && avail('anchor_sleep')) {
    cards.push({
      id: 'anchor_sleep',
      icon: 'bed',
      title: '就寝',
      sub: 'おやすみなさい · 朝まで記録',
      mins: 420,
      isSleepCard: true,
      isAnchor: true
    });
  }

  return cards;
}

/**
 * 緊急フォールバック用の低負荷カード（aiDeck.lowCards が未生成時のみ使用）
 * @return {Array<Object>}
 */
function getFallbackLowCards_() {
  return [
    { id: 'low_fb_water', icon: 'coffee', title: '温かい飲み物を一口飲む', sub: 'まずは座ったまま水分だけ', mins: 3 },
    { id: 'low_fb_stretch', icon: 'wind', title: 'YouTubeで5分ストレッチ', sub: '肩・首を軽くほぐす', mins: 5 },
    { id: 'low_fb_desk', icon: 'home', title: '机の上を1つだけ片付ける', sub: '目の前1つだけ整える', mins: 3 }
  ];
}

/**
 * アンカーカードと AI デッキを統合し、Home 表示候補リストを組み立てる
 * @param {string} workMode
 * @param {Date} now
 * @param {Object} fastState
 * @return {{ cards: Array<Object>, lowCards: Array<Object> }}
 */
function composeHomeDeck(workMode, now, fastState) {
  const completed = (fastState && fastState.completedToday) || {};
  const dismissed = (fastState && fastState.dismissedToday) || {};
  const isAvail = (c) => c && c.id && !completed[c.id] && !dismissed[c.id];

  const anchors = buildRoutineAnchorCards(workMode, now, fastState);
  const aiCardsRaw = (fastState && fastState.aiDeck && Array.isArray(fastState.aiDeck.cards))
    ? fastState.aiDeck.cards
    : [];
  const aiLowRaw = (fastState && fastState.aiDeck && Array.isArray(fastState.aiDeck.lowCards))
    ? fastState.aiDeck.lowCards
    : [];

  const aiCards = aiCardsRaw.filter(c => {
    if (!isAvail(c)) return false;
    if (c.isTriage && fastState.triagedToday) return false;
    return true;
  });

  // 引き算カードは最上位、次に朝・勤務の直近アンカー、その後 AI カード、最後に就寝アンカーを自然配置
  const triageCards = aiCards.filter(c => c.isTriage);
  const normalAiCards = aiCards.filter(c => !c.isTriage);
  const nonSleepAnchors = anchors.filter(c => !c.isSleepCard);
  const sleepAnchors = anchors.filter(c => c.isSleepCard);

  // 重複ID排除
  const seen = {};
  const merged = [];
  const pushUnique = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (!seen[arr[i].id]) {
        seen[arr[i].id] = true;
        merged.push(arr[i]);
      }
    }
  };

  pushUnique(triageCards);
  pushUnique(nonSleepAnchors);
  pushUnique(normalAiCards);
  pushUnique(sleepAnchors);

  const lowCards = aiLowRaw.filter(isAvail);
  return {
    cards: merged,
    lowCards: lowCards.length > 0 ? lowCards : getFallbackLowCards_().filter(isAvail)
  };
}

/**
 * 直前行動からの経過時間（Δt）テキストを生成
 * @param {Object|null} lastAction
 * @param {Date=} nowOpt
 * @return {string}
 */
function buildDeltaText(lastAction, nowOpt) {
  if (!lastAction || !lastAction.completedAt) return '';
  const now = nowOpt || new Date();
  const prevMs = new Date(lastAction.completedAt).getTime();
  if (isNaN(prevMs)) return '';
  const diffMins = Math.max(0, Math.floor((now.getTime() - prevMs) / 60000));

  if (lastAction.isSleep && diffMins <= 20) {
    return 'おはようございます · 起床直後';
  }
  if (diffMins < 5) {
    return `直前: ${lastAction.title}（完了直後）`;
  }
  if (diffMins < 60) {
    return `直前: ${lastAction.title}（${diffMins}分前）`;
  }
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return `直前: ${lastAction.title}（${h}時間${m > 0 ? m + '分' : ''}前）`;
}

/**
 * 天気情報が3時間以上古いか、エラー・出社日渋谷欠損時に再取得すべきか判定
 * @param {Object} fastState
 * @param {string} workMode
 * @param {string} weatherInfo
 * @param {Date=} nowOpt
 * @return {boolean}
 */
function isWeatherStale(fastState, workMode, weatherInfo, nowOpt) {
  const now = nowOpt || new Date();
  const info = String(weatherInfo || '').trim();
  if (!info || info.indexOf('エラー') !== -1) return true;
  if (workMode === 'commute' && info.indexOf('渋谷') === -1) return true;

  const fetchedAt = fastState && fastState.weatherFetchedAt ? new Date(fastState.weatherFetchedAt).getTime() : 0;
  if (!fetchedAt || isNaN(fetchedAt)) return true;
  return (now.getTime() - fetchedAt) >= SYSTEM_CONSTANTS.WEATHER_STALE_MS;
}
