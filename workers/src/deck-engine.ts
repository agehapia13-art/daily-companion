import {
  ActiveSession,
  BoundaryInfo,
  DailyBriefing,
  DeckCard,
  Env,
  FastState,
  HabitSnapshotItem,
  MemoryMap,
  StockSnapshotItem,
  TaskSnapshotItem,
  WorkMode
} from './types';
import {
  JST_OFFSET_MS,
  formatJstIso,
  formatJstYmd,
  getJstClock,
  getLogicalDayKey,
  pad2,
  parsePositiveEstimatedMins,
  toJstDate
} from './utils';

const GEMINI_35_LITE_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_FLASH_MODEL = 'gemini-3.8-flash';

const DECK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      description: '現在の状況・次の時間帯に適した行動カード候補（優先度順に6〜9件）',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: '一意のID（タスク/ストック連動時は対象IDまたは短い英数字ID）' },
          title: { type: 'STRING', description: 'カードの短いタイトル（18文字以内目安）' },
          sub: { type: 'STRING', description: '着手摩擦を下げる短い補足1行（24文字以内目安）' },
          mins: { type: 'INTEGER', description: '見込み所要時間（分）' },
          icon: {
            type: 'STRING',
            enum: [
              'coffee', 'utensils', 'droplets', 'droplet', 'book', 'music',
              'walk', 'wind', 'users', 'cart', 'sparkles', 'checkCircle',
              'sliders', 'compass', 'home', 'message'
            ]
          },
          linkedType: { type: 'STRING', enum: ['none', 'task', 'stock', 'habit'] },
          linkedId: { type: 'STRING', description: 'taskId / stockタイトル / habit項目名（なければ空文字）' },
          cycleStampLabel: { type: 'STRING', description: '完了時に更新すべき cycle_stamps 項目名（なければ空文字）' },
          isTriage: { type: 'BOOLEAN', description: '引き算（荷下ろし）提案カードなら true' },
          rightLabel: { type: 'STRING', description: 'isTriage=true 時のみ短いラベル（例: 引き算）' },
          triageTaskIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'isTriage=true 時に翌日へリスケ対象とするタスクID配列'
          }
        },
        required: ['id', 'title', 'sub', 'mins', 'icon', 'linkedType', 'linkedId', 'isTriage']
      }
    },
    low_cards: {
      type: 'ARRAY',
      description: '「少しだるい」押下時用の極小負荷カード（現在の時間帯・場所・体調に合う3〜5件）',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          sub: { type: 'STRING' },
          mins: { type: 'INTEGER' },
          icon: {
            type: 'STRING',
            enum: ['coffee', 'wind', 'home', 'droplet', 'book', 'music', 'sparkles', 'compass']
          },
          linkedType: { type: 'STRING', enum: ['none', 'task', 'stock', 'habit'] },
          linkedId: { type: 'STRING' }
        },
        required: ['id', 'title', 'sub', 'mins', 'icon']
      }
    }
  },
  required: ['cards', 'low_cards']
};

function getDefaultPromptDeck(): string {
  return `あなたは『マイコックピット』のカード編成AIです。
ユーザーが「選ぶだけ」で自然に次の一歩へ移れるよう、現在の状況・時間帯・心身状態・生活習慣（lifestyle_habits）・ありたい人間像（ideal_self）を踏まえ、Homeに表示する行動カード群をJSONで編成してください。

【編成の基本原則（固定スロット禁止・状況適応）】
1. 固定的な枠割り当て（「1番目は必ずタスク」等）は行わず、その瞬間の心身コンディション・残り可処分時間・天候・直近の文脈から最も自然で適した順に 6〜9件 を並べる。
2. 別添の【システム管理済みカード（重複生成不要）】および現在時刻に固定された勤務ブロックと重複するカードは生成しない。
3. ユーザーの生活リズム・身体ケア・余白の行動・担当外家事などの前提条件は、必ず【プロファイル (profile)】と【生活習慣メモリー (lifestyle_habits)】、および【当日の予定】を文脈として照合した上で提案する（特定習慣に依存する固定ルールは置かず、その日の予定と流れに柔軟に合わせる）。
4. 全5領域のバランスと「ありたい姿」：
   - 実務・生活課題（tasks）、創造・専門スキル（skill_options / 制作・創作）、文化・娯楽インプット（input_stock / 読書・ゲーム等）、身体・回復（運動・ケア・散歩）、社会・対人（家族との団らん・連絡・お出かけ）から、ご無沙汰（cycle_stamps 経過日数）や本日期限・優先指定を加味してバランスよく織り交ぜる。
   - 未完了タスクだけに偏らせず、非タスク行動（生活リズム、ストック作品、身体ケア、創作/スキル、対人）を自然に含める。
   - タスクの \`due_date\` と \`remind_context\`・直近ログを照合し、「単なる期限（前倒し可）」と「特定の日や特定の条件・環境で実施すると決めたタスク（その当日や条件・環境が整うまで提案しない）」を見分けて編成する。
   - 本業勤務中の時間帯は私生活タスクや余暇の無理な提案を抑え、休憩・退勤後の見通しに合わせる。
5. 引き算カード（isTriage: true）：
   - 残余時間に対して当日/期限超過タスクが過密である場合、気圧急降下アラート（TRUE）がある場合、または直近ログに疲労・低調サインがある場合のみ、先頭に \`isTriage: true\`（\`rightLabel: "引き算"\`）のカードを1枚だけ組み込み、明日以降へ回すべき \`triageTaskIds\` を指定する。通常余裕がある時は出さない。
6. 低負荷予備カード（low_cards: 3〜5件）：
   - ユーザーが「少しだるい」をタップした瞬間に待ち時間ゼロで切り替える予備カード。
   - 【時間軸】（朝/日中/夕方/夜・就寝前）、【直前完了】、【本日のログ要約】に記載された事実のみを根拠に、座ったまま・3〜10分で無理なくできる汎用的な小休止（水分補給、深呼吸、姿勢リセット、環境調整など）を3〜5件用意する。
   - 【プロファイル】の職業・属性から連想した未実施作業のケアは提案せず、実際に直前まで行っていた作業へのケアが必要な場合のみ【直前完了】や【本日のログ要約】の事実に沿って提案する。
7. トーン：
   - タイトルは簡潔に、サブ説明（sub）は押し付けや説教（「〜しましょう！」の連呼や小言）を避け、さっぱりとした等身大の視点で次の一歩を示す。`;
}

function formatJstHm(now: Date): string {
  const d = toJstDate(now);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatJstNowWithDay(now: Date): string {
  const d = toJstDate(now);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = days[d.getUTCDay()] || '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}(${dow}) ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function buildJstMorningDate(now: Date): Date {
  const d = toJstDate(now);
  const utcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0, 0) - JST_OFFSET_MS;
  return new Date(utcMs);
}

function formatWeatherLineForHome(weatherInfo: string, pressureAlert: string, workMode: WorkMode): string {
  const raw = String(weatherInfo || '').trim();
  if (!raw || raw.indexOf('取得エラー') !== -1) {
    return pressureAlert === 'TRUE' ? '気圧急降下注意' : '横浜・磯子';
  }
  const parts = raw.split('｜').map(s => s.trim()).filter(Boolean);
  const compactParts: string[] = [];
  const limit = workMode === 'commute' ? parts.length : 1;
  for (let i = 0; i < Math.min(limit, parts.length); i++) {
    const p = parts[i];
    const loc = p.indexOf('渋谷') !== -1 ? '渋谷' : '磯子';
    const descMatch = p.match(/:\s*([^\s]+)/);
    const tempMatch = p.match(/最高(\d+℃)/);
    const rainMatch = p.match(/降水確率(\d+%)/);
    const bits = [loc];
    if (descMatch) bits.push(descMatch[1]);
    if (tempMatch) bits.push(tempMatch[1]);
    else if (rainMatch) bits.push(rainMatch[1]);
    compactParts.push(bits.join(' '));
  }
  let line = compactParts.join(' · ');
  if (pressureAlert === 'TRUE') {
    line += ' · 気圧低下注意';
  }
  return line;
}

function sortTasksByUrgency(tasks: TaskSnapshotItem[], todayStr: string): TaskSnapshotItem[] {
  if (!tasks || tasks.length <= 1) return tasks || [];
  return tasks.slice().sort((a, b) => {
    const aDue = a.dueDate || '';
    const bDue = b.dueDate || '';

    const aOverdue = Boolean(aDue && aDue < todayStr);
    const bOverdue = Boolean(bDue && bDue < todayStr);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    if (aOverdue && bOverdue) return aDue.localeCompare(bDue);

    const aToday = aDue === todayStr;
    const bToday = bDue === todayStr;
    if (aToday && !bToday) return -1;
    if (!aToday && bToday) return 1;

    const aFuture = Boolean(aDue && aDue > todayStr);
    const bFuture = Boolean(bDue && bDue > todayStr);
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    if (aFuture && bFuture) return aDue.localeCompare(bDue);

    return (a.rowIndex || 0) - (b.rowIndex || 0);
  });
}

function getDefaultHabitEstimatedMins(label: string): number {
  const s = String(label || '');
  if (/爪切り/.test(s)) return 5;
  if (/室内運動|フィットネス/.test(s)) return 20;
  if (/散歩|外歩き/.test(s)) return 30;
  if (/アニメ|映画/.test(s)) return 45;
  if (/DTM|楽曲/.test(s)) return 45;
  return 20;
}

function parseCycleStamps(rawStamps: string, now: Date): HabitSnapshotItem[] {
  const trimmed = String(rawStamps || '').trim();
  if (!trimmed) return [];

  const jstNow = toJstDate(now);
  const todayUtcMs = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  const lines = trimmed.split(/[,\n、]+/).map(s => s.trim()).filter(Boolean);
  const habits: HabitSnapshotItem[] = [];

  for (const line of lines) {
    const m = line.match(/^([^:：]+)[：:]\s*(.+)$/);
    const label = m ? m[1].replace(/^[・\-\s]+/, '').trim() : line;
    const val = m ? m[2].trim() : '';
    let dateStr = '';
    let elapsedDays: number | null = null;
    const dm = val.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
    if (dm) {
      dateStr = dm[1].replace(/\//g, '-');
      const p = dateStr.split('-');
      const y = parseInt(p[0], 10);
      const mon = parseInt(p[1], 10);
      const d = parseInt(p[2], 10);
      if (Number.isFinite(y) && Number.isFinite(mon) && Number.isFinite(d)) {
        const dtUtcMs = Date.UTC(y, mon - 1, d);
        elapsedDays = Math.max(0, Math.floor((todayUtcMs - dtUtcMs) / 86400000));
      }
    }
    const elapsedText = elapsedDays === null
      ? '未着手'
      : (elapsedDays === 0 ? '今日' : `${elapsedDays}日前`);

    habits.push({
      id: `HABIT_${label}`,
      label,
      date: dateStr,
      elapsedDays,
      elapsed: elapsedText,
      stampedToday: elapsedDays === 0,
      estimatedMins: getDefaultHabitEstimatedMins(label)
    });
  }

  habits.sort((a, b) => {
    const ae = a.elapsedDays === null ? 9999 : a.elapsedDays;
    const be = b.elapsedDays === null ? 9999 : b.elapsedDays;
    return be - ae;
  });

  return habits;
}

function formatCycleStampsWithElapsed(habits: HabitSnapshotItem[], rawFallback: string): string {
  if (habits.length === 0) return rawFallback.trim();
  return habits.map(h => `${h.label}: ${h.date || '未着手'} (${h.elapsed})`).join('\n');
}

function formatUncompletedTasksForContext(uncompletedTasks: TaskSnapshotItem[], todayStr: string): string {
  if (!uncompletedTasks || uncompletedTasks.length === 0) return 'なし';
  return uncompletedTasks.map(t => {
    let duePart = '';
    if (t.dueDate) {
      if (t.dueDate < todayStr) {
        duePart = ` [⚠️期限超過:${t.dueDate}]`;
      } else if (t.dueDate === todayStr) {
        duePart = ` [📅本日期限:${t.dueDate}]`;
      } else {
        duePart = ` (期限:${t.dueDate})`;
      }
    }
    const remindPart = t.remindContext && t.remindContext.trim() ? ` | remind_context:${t.remindContext.trim()}` : '';
    const minsPart = t.estimatedMins ? ` | estimated_mins:${t.estimatedMins}` : '';
    const docPart = t.docUrl && t.docUrl.trim() ? ' | 📄資料連携済' : '';
    const memoPart = t.memo && t.memo.trim() ? ` | memo:${t.memo.trim()}` : '';
    return `- [${t.id}] ${t.title}${duePart}${minsPart}${remindPart}${docPart}${memoPart}`;
  }).join('\n');
}

function getFallbackLowCards(): DeckCard[] {
  return [
    { id: 'low_fb_water', icon: 'coffee', title: '温かい飲み物を一口飲む', sub: 'まずは座ったまま水分だけ', mins: 3, linkedType: 'none', linkedId: '' },
    { id: 'low_fb_stretch', icon: 'wind', title: 'YouTubeで5分ストレッチ', sub: '肩・首を軽くほぐす', mins: 5, linkedType: 'none', linkedId: '' },
    { id: 'low_fb_desk', icon: 'home', title: '机の上を1つだけ片付ける', sub: '目の前1つだけ整える', mins: 3, linkedType: 'none', linkedId: '' }
  ];
}

function buildFallbackAiDeck(
  uncompletedTasks: TaskSnapshotItem[],
  pendingInput: StockSnapshotItem[],
  habits: HabitSnapshotItem[],
  todayStr: string,
  now: Date
): FastState['aiDeck'] {
  const cards: DeckCard[] = [];
  const sortedTasks = sortTasksByUrgency(uncompletedTasks || [], todayStr);
  for (let i = 0; i < Math.min(3, sortedTasks.length); i++) {
    const t = sortedTasks[i];
    const clean = String(t.title || '').replace(/^\[[^\]]+\]\s*/, '').trim();
    cards.push({
      id: t.id,
      title: clean.length > 22 ? clean.substring(0, 22) + '…' : clean,
      sub: t.dueDate ? (t.dueDate <= todayStr ? '本日・直近の期限' : `期限: ${t.dueDate}`) : (t.remindContext || '手元の未完了タスク'),
      mins: t.estimatedMins || 30,
      icon: /お出かけ/.test(t.title) ? 'compass' : (/制作|創作/.test(t.title) ? 'music' : 'checkCircle'),
      linkedType: 'task',
      linkedId: t.id,
      cycleStampLabel: '',
      isTriage: false,
      triageTaskIds: []
    });
  }
  for (let j = 0; j < Math.min(2, (pendingInput || []).length); j++) {
    const s = pendingInput[j];
    cards.push({
      id: `INPUT_${s.rowIndex}`,
      title: s.title,
      sub: `${s.type || 'ストック'} · 少しずつ消化`,
      mins: s.estimatedMins || 20,
      icon: s.type === '音楽' ? 'music' : 'book',
      linkedType: 'stock',
      linkedId: s.title,
      cycleStampLabel: '',
      isTriage: false,
      triageTaskIds: []
    });
  }
  for (let k = 0; k < Math.min(2, (habits || []).length); k++) {
    const h = habits[k];
    if (h.stampedToday) continue;
    cards.push({
      id: h.id,
      title: h.label,
      sub: `${h.elapsed} · リズムを整える`,
      mins: h.estimatedMins || 20,
      icon: /運動|散歩/.test(h.label) ? 'wind' : (/ピアノ|ギター|音楽|DTM/.test(h.label) ? 'music' : 'sparkles'),
      linkedType: 'habit',
      linkedId: h.label,
      cycleStampLabel: h.label,
      isTriage: false,
      triageTaskIds: []
    });
  }
  return {
    generatedAt: formatJstIso(now),
    cards,
    lowCards: getFallbackLowCards()
  };
}

/**
 * コード側担当の確定アンカーカード（朝の細分化身支度・勤務ブロック・日跨ぎ就寝）を生成
 */
export function buildRoutineAnchorCards(workMode: WorkMode, now: Date, fastState: FastState): DeckCard[] {
  const { minsOfDay } = getJstClock(now);
  const completed = (fastState && fastState.completedToday) || {};
  const dismissed = (fastState && fastState.dismissedToday) || {};
  const avail = (id: string) => !completed[id] && !dismissed[id];
  const cards: DeckCard[] = [];

  // 1. 朝の身支度（午前中 04:00〜12:59 の間、未完分を順次表示）
  if (minsOfDay >= 4 * 60 && minsOfDay < 13 * 60) {
    if (avail('anchor_breakfast')) {
      cards.push({ id: 'anchor_breakfast', icon: 'coffee', title: '朝食', sub: 'まずは食べて体を起こす', mins: 20, linkedType: 'none', linkedId: '', isAnchor: true });
    }
    if (avail('anchor_dress')) {
      cards.push({ id: 'anchor_dress', icon: 'shirt', title: '着替え', sub: '今日の服に着替える', mins: 10, linkedType: 'none', linkedId: '', isAnchor: true });
    }
    if (avail('anchor_makeup')) {
      cards.push({ id: 'anchor_makeup', icon: 'sparkles', title: 'メイク', sub: 'ベースから仕上げまで', mins: 15, linkedType: 'none', linkedId: '', isAnchor: true });
    }
    if (avail('anchor_hair')) {
      cards.push({ id: 'anchor_hair', icon: 'wind', title: 'ヘアセット', sub: '髪を整えて身支度を仕上げる', mins: 10, linkedType: 'none', linkedId: '', isAnchor: true });
    }
    if (workMode === 'commute' && avail('anchor_commute')) {
      cards.push({ id: 'anchor_commute', icon: 'train', title: '出社（移動）', sub: '最寄り駅まで歩き、渋谷へ', mins: 90, linkedType: 'none', linkedId: '', isAnchor: true, cycleStampLabel: '外歩き・散歩' });
    }
  }

  // 2. 平日勤務ブロック（10:00〜19:00）
  if (workMode !== 'holiday') {
    if (minsOfDay >= 9 * 60 + 30 && minsOfDay < 12 * 60 && avail('anchor_work_am')) {
      cards.push({ id: 'anchor_work_am', icon: 'laptop', title: '本業（午前）', sub: '12:00の昼休憩まで集中', mins: 120, linkedType: 'none', linkedId: '', isWorkBlock: true, isAnchor: true });
    }
    if (minsOfDay >= 12 * 60 + 45 && minsOfDay < 18 * 60 + 30 && avail('anchor_work_pm')) {
      cards.push({ id: 'anchor_work_pm', icon: 'laptop', title: '本業（午後）', sub: '19:00の終業まで進める', mins: 240, linkedType: 'none', linkedId: '', isWorkBlock: true, isAnchor: true });
    }
    if (workMode === 'commute' && minsOfDay >= 18 * 60 && minsOfDay < 22 * 60 && avail('anchor_return')) {
      cards.push({ id: 'anchor_return', icon: 'train', title: '帰路（帰宅移動）', sub: '業務終了、自宅へ帰る', mins: 90, linkedType: 'none', linkedId: '', isAnchor: true, cycleStampLabel: '外歩き・散歩' });
    }
  }

  // 2.2 昼食アンカー（11:30以降、平日・休日問わず未完了・未非表示なら生成）
  if (minsOfDay >= 11 * 60 + 30 && avail('anchor_lunch')) {
    cards.push({
      id: 'anchor_lunch',
      icon: 'utensils',
      title: workMode === 'holiday' ? '昼食' : '昼食・昼休憩',
      sub: workMode === 'holiday' ? 'しっかり食べて午後に備える' : 'しっかり休んで午後に備える',
      mins: workMode === 'holiday' ? 45 : 60,
      linkedType: 'none',
      linkedId: '',
      isAnchor: true
    });
  }

  const rawAiCards = (fastState.aiDeck && Array.isArray(fastState.aiDeck.cards)) ? fastState.aiDeck.cards : [];
  const hasAiAnchor = (id: string) => rawAiCards.some(c => c && c.id === id);

  // 2.5 夕方以降の生活アンカー（AIが既に配置していればAIの順番を尊重、未配置時のみ補完）
  if (minsOfDay >= 17 * 60) {
    if (avail('anchor_dinner') && !hasAiAnchor('anchor_dinner')) {
      cards.push({ id: 'anchor_dinner', icon: 'utensils', title: '夕食', sub: '一息ついてしっかり食べる', mins: 45, linkedType: 'none', linkedId: '', isAnchor: true });
    }
    if (avail('anchor_bath') && !hasAiAnchor('anchor_bath')) {
      cards.push({ id: 'anchor_bath', icon: 'droplet', title: '入浴・スキンケア', sub: '湯船からスキンケアまで一式', mins: 60, linkedType: 'none', linkedId: '', isAnchor: true });
    }
  }

  // 3. 日跨ぎ「就寝」カード（21:30以降〜翌04:00前まで保証。completedToday には依存しない）
  if ((minsOfDay >= 21 * 60 + 30 || minsOfDay < 4 * 60) && !dismissed['anchor_sleep']) {
    cards.push({
      id: 'anchor_sleep',
      icon: 'bed',
      title: '就寝',
      sub: 'おやすみなさい · 朝まで記録',
      mins: 420,
      linkedType: 'none',
      linkedId: '',
      isSleepCard: true,
      isAnchor: true
    });
  }

  return cards;
}

/**
 * アンカーカードと AI デッキを統合し、Home 表示候補リストを組み立てる
 */
export function composeHomeDeck(
  workMode: WorkMode,
  now: Date,
  fastState: FastState
): { cards: DeckCard[]; lowCards: DeckCard[] } {
  const completed = (fastState && fastState.completedToday) || {};
  const dismissed = (fastState && fastState.dismissedToday) || {};
  const isAvail = (c: DeckCard): boolean => Boolean(
    c && c.id && !completed[c.id] && !(c.linkedId && completed[c.linkedId]) && !dismissed[c.id]
  );

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

  const triageCards = aiCards.filter(c => c.isTriage);
  const normalAiCards = aiCards.filter(c => !c.isTriage);

  const seen: Record<string, boolean> = {};
  const merged: DeckCard[] = [];
  const pushUnique = (arr: DeckCard[]) => {
    for (const item of arr) {
      if (!seen[item.id]) {
        seen[item.id] = true;
        merged.push(item);
      }
    }
  };

  pushUnique(triageCards);
  pushUnique(anchors);
  pushUnique(normalAiCards);

  const lowCards = aiLowRaw.filter(isAvail);
  return {
    cards: merged,
    lowCards: lowCards.length > 0 ? lowCards : getFallbackLowCards().filter(isAvail)
  };
}

/**
 * 直前行動からの経過時間（Δt）テキストを生成
 */
export function buildDeltaText(lastAction: FastState['lastAction'], now: Date = new Date()): string {
  if (!lastAction || !lastAction.completedAt) return '';
  const prevMs = new Date(lastAction.completedAt).getTime();
  if (Number.isNaN(prevMs)) return '';
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
 * 朝ブリーフィングオブジェクトを構築
 */
export function buildDailyBriefingObj(
  weatherInfo: string,
  pressureAlert: string,
  workMode: WorkMode,
  todayEvents: string[],
  uncompletedTasks: TaskSnapshotItem[],
  todayStr: string,
  now: Date = new Date()
): DailyBriefing {
  const weatherLine = formatWeatherLineForHome(weatherInfo, pressureAlert, workMode);
  const pressureTxt = pressureAlert === 'TRUE' ? '⚠️ 気圧急降下注意' : '気圧は安定';

  let scheduleTxt = '本日の固定予定なし';
  if (todayEvents && todayEvents.length > 0) {
    scheduleTxt = '予定: ' + todayEvents.slice(0, 3).join(' / ');
  } else if (workMode === 'commute') {
    scheduleTxt = '予定: 10:00〜19:00 出社';
  } else if (workMode === 'remote') {
    scheduleTxt = '予定: 10:00〜19:00 リモートワーク';
  }

  const urgent = (uncompletedTasks || []).filter(t => t.dueDate && t.dueDate <= todayStr);
  const prio = (uncompletedTasks || []).filter(
    t => (!t.dueDate || t.dueDate > todayStr) && /最優先|優先/.test((t.remindContext || '') + (t.memo || ''))
  );
  const pick = urgent.concat(prio).slice(0, 2);

  const lines = [`${pressureTxt} · ${scheduleTxt}`];
  if (pick.length > 0) {
    const names = pick.map(t => String(t.title || '').replace(/^\[[^\]]+\]\s*/, '')).join(' / ');
    lines.push((urgent.length > 0 ? '期限: ' : '優先: ') + names);
  } else if (weatherLine) {
    lines.push(weatherLine);
  }

  return {
    dateKey: getLogicalDayKey(now),
    kicker: '今朝のブリーフィング',
    lines,
    dismissed: false
  };
}

/**
 * Gemini を使って現在の状況・終了見込み時刻に適応した aiDeck (cards + lowCards) を生成
 */
export async function generateAiDeck(
  env: Env,
  opts: {
    reason: string;
    now: Date;
    memory: MemoryMap;
    fastState: FastState;
    workMode: WorkMode;
    todayEvents: string[];
    boundaryInfo: BoundaryInfo;
    tasks: TaskSnapshotItem[];
    stock: StockSnapshotItem[];
    todayLogsText: string;
    startedCard?: ActiveSession | null;
    excludeTitles?: string[];
    useFlashModel?: boolean;
  }
): Promise<FastState['aiDeck']> {
  const now = opts.now || new Date();
  const memory = opts.memory || {};
  const fastState = opts.fastState;
  const workMode = opts.workMode || 'remote';
  const todayEvents = opts.todayEvents || [];
  const boundaryInfo = opts.boundaryInfo;

  const todayStr = formatJstYmd(now);
  const nowStr = formatJstNowWithDay(now);
  const uncompletedTasks = sortTasksByUrgency(
    (opts.tasks || []).filter(t => !t.done && t.status !== '完了'),
    todayStr
  );
  const pendingInput = (opts.stock || []).filter(s => !s.done && s.status !== '完');
  const habits = parseCycleStamps(memory.cycle_stamps || '', now);

  // 基準時刻の決定: 行動中なら終了見込み時刻、midnight_initなら翌朝08:00頃、それ以外は現在時刻
  let targetTimeContext = `現在時刻: ${nowStr}`;
  let anchorTargetTime = now;
  const activeCard = (opts.startedCard && !opts.startedCard.isSleepCard)
    ? opts.startedCard
    : (fastState && fastState.activeSession && !fastState.activeSession.isSleepCard ? fastState.activeSession : null);

  if (opts.reason === 'midnight_init') {
    const morningTarget = buildJstMorningDate(now);
    anchorTargetTime = morningTarget;
    const morningStr = formatJstNowWithDay(morningTarget);
    targetTimeContext =
      `実行時刻: ${nowStr}（深夜バッチ）\n` +
      `【想定基準時刻】: ${morningStr} 頃（翌朝・起床後〜午前の初期デッキ）\n` +
      `※ユーザーが朝起きた直後（08:00頃〜午前中）に適した手札を編成してください。深夜・就寝前のカードは出さないでください。`;
  } else if (activeCard) {
    const estMins = parsePositiveEstimatedMins(activeCard.mins) || 30;
    const baseStartMs = activeCard.startedAtMs || (activeCard.startedAtIso ? new Date(activeCard.startedAtIso).getTime() : now.getTime());
    const expectedEndMs = Math.max(now.getTime(), baseStartMs + estMins * 60000);
    const expectedEnd = new Date(expectedEndMs);
    anchorTargetTime = expectedEnd;
    const endStr = formatJstHm(expectedEnd);
    targetTimeContext =
      `現在時刻: ${nowStr}\n` +
      `【行動中】: 「${activeCard.title}」（見込み${estMins}分 → 終了見込み時刻 ${endStr} 頃）\n` +
      `※ユーザーがこの行動を終えた「${endStr} 頃」の状況・残り時間に適した次の手札を編成してください。`;
  }

  const promptDeck = (memory.prompt_deck && memory.prompt_deck.trim() !== '')
    ? memory.prompt_deck.trim()
    : getDefaultPromptDeck();

  const completedKeys = Object.keys((fastState && fastState.completedToday) || {});
  const dismissedKeys = Object.entries((fastState && fastState.dismissedToday) || {})
    .filter(([k, v]) => k !== '__briefing__' && Boolean(v))
    .map(([k, v]) => (typeof v === 'string' && v.trim()) ? v.trim() : k);
  const excludeList = (opts.excludeTitles || []).concat(completedKeys, dismissedKeys);

  const stampsFormatted = formatCycleStampsWithElapsed(habits, memory.cycle_stamps || '');
  const anchorCards = buildRoutineAnchorCards(workMode, anchorTargetTime, fastState);
  const anchorPrompts = anchorCards.map(c => `id:"${c.id}" ${c.title}(${c.mins}分)`).filter(Boolean);

  const userPrompt = [
    `【プロファイル】: ${memory.profile || ''}`,
    `【ありたい人間像】: ${memory.ideal_self || ''}`,
    `【生活習慣 (lifestyle_habits)】:\n${memory.lifestyle_habits || ''}`,
    `【スキルアップ選択肢 (skill_options)】:\n${memory.skill_options || ''}`,
    `【生成理由】: ${opts.reason || 'auto'}`,
    `【時間軸】:\n${targetTimeContext}`,
    `【勤務モード】: ${workMode}（commute=出社, remote=在宅リモート, holiday=休日）`,
    anchorPrompts.length > 0 ? `【現在時間帯の生活・勤務アンカー（状況に合う順で cards に配置可）】: ${anchorPrompts.join(' / ')}` : '',
    `【次の予定境界】: ${boundaryInfo ? boundaryInfo.summaryText : 'なし'}`,
    `【本日の予定】: ${todayEvents.length > 0 ? todayEvents.join(' / ') : '登録なし'}`,
    `【天気・気圧】: ${memory.weather_info || '情報なし'} / 気圧急降下: ${memory.pressure_alert === 'TRUE' ? 'TRUE（注意）' : 'FALSE'}`,
    `【直前完了】: ${fastState && fastState.lastAction ? `${fastState.lastAction.title} (${fastState.lastAction.completedAt})` : 'なし'}`,
    `【活動・メンテナンス記録 (cycle_stamps)】:\n${stampsFormatted || 'なし'}`,
    `【未完了タスク】:\n${formatUncompletedTasksForContext(uncompletedTasks, todayStr)}`,
    `【インプットストック(未消化)】:\n${pendingInput.map(i => `[INPUT_${i.rowIndex}][${i.type}] ${i.title} (${i.estimatedMins}分)${i.memo ? ' - ' + i.memo : ''}`).join(' / ') || 'なし'}`,
    `【直近メモリ (rolling_memory)】:\n${String(memory.rolling_memory || '').slice(-1500) || 'なし'}`,
    opts.todayLogsText ? `【本日のログ要約】:\n${opts.todayLogsText.slice(-1000)}` : '',
    excludeList.length > 0 ? `【除外・既出（本日完了/非表示/重複回避対象）】: ${excludeList.join(', ')}` : ''
  ].filter(Boolean).join('\n\n');

  const modelName = opts.useFlashModel ? GEMINI_FLASH_MODEL : GEMINI_35_LITE_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const payload = {
    systemInstruction: { parts: [{ text: promptDeck }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      responseSchema: DECK_RESPONSE_SCHEMA
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini APIエラー [${response.status}]: ${errText}`);
    }

    const json = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; thought?: boolean }>;
        };
      }>;
    };

    const parts = json.candidates?.[0]?.content?.parts || [];
    let contentText = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        contentText += part.text;
      }
    }
    if (!contentText) {
      throw new Error('Gemini API レスポンスが空です');
    }

    const parsed = JSON.parse(contentText) as {
      cards?: Array<Record<string, unknown>>;
      low_cards?: Array<Record<string, unknown>>;
    };

    const sanitizeCard = (c: Record<string, unknown>, idx: number, isLow: boolean): DeckCard => {
      const isTriage = Boolean(c.isTriage);
      return {
        id: String(c.id || `${isLow ? 'low_' : 'ai_'}${Date.now()}_${idx}`),
        title: String(c.title || '').trim(),
        sub: String(c.sub || '').trim(),
        mins: parsePositiveEstimatedMins(c.mins) || (isLow ? 5 : 20),
        icon: String(c.icon || 'compass'),
        linkedType: String(c.linkedType || 'none'),
        linkedId: String(c.linkedId || ''),
        cycleStampLabel: String(c.cycleStampLabel || ''),
        isTriage,
        rightLabel: isTriage ? String(c.rightLabel || '引き算') : '',
        triageTaskIds: Array.isArray(c.triageTaskIds) ? c.triageTaskIds.map(String) : []
      };
    };

    const cards = Array.isArray(parsed.cards)
      ? parsed.cards.map((c, i) => sanitizeCard(c, i, false)).filter(c => c.title)
      : [];
    const lowCards = Array.isArray(parsed.low_cards)
      ? parsed.low_cards.map((c, i) => sanitizeCard(c, i, true)).filter(c => c.title)
      : [];

    if (cards.length === 0) {
      return buildFallbackAiDeck(uncompletedTasks, pendingInput, habits, todayStr, now);
    }

    return {
      generatedAt: formatJstIso(now),
      cards,
      lowCards: lowCards.length > 0 ? lowCards : getFallbackLowCards()
    };
  } catch (err) {
    console.error('generateAiDeck エラー (フォールバック使用):', err instanceof Error ? err.message : String(err));
    if (fastState && fastState.aiDeck && Array.isArray(fastState.aiDeck.cards) && fastState.aiDeck.cards.length > 0 && opts.reason !== 'refresh') {
      return fastState.aiDeck;
    }
    return buildFallbackAiDeck(uncompletedTasks, pendingInput, habits, todayStr, now);
  }
}
