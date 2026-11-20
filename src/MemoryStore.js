/**
 * MemoryStore.js - memory シートの読み書き・安全更新ガード・AI向けコンテキスト整形ヘルパー
 */

// ==========================================
// 6. memory (プロファイル・中長期記憶・システム制御) 操作
// ヘッダー: [キー, 値]
// 保持キー: profile, weather_info, pressure_alert, cycle_stamps, weekly_summary, briefing_delivered_date, monthly_report_ready
// ==========================================

/**
 * メモリテーブルをオブジェクト形式で全取得（ブール値およびDate型の正規化を含む）
 * @return {Object}
 */
function getMemory() {
  if (typeof _reqSheetCache === 'object' && _reqSheetCache.memory) {
    return Object.assign({}, _reqSheetCache.memory);
  }
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  const lastRow = sheet.getLastRow();
  const memoryObj = {
    profile: '',
    backend_model: '',
    weather_info: '',
    pressure_alert: 'FALSE',
    cycle_stamps: '',
    weekly_summary: '',
    briefing_delivered_date: '',
    monthly_report_ready: 'FALSE',
    custom_system_prompt: '',
    rolling_memory: '',
    dictionary: '',
    ideal_self: '',
    lifestyle_habits: '',
    skill_options: '',
    prompt_core: '',
    prompt_schedule: '',
    prompt_db: '',
    prompt_deck: '',
    V2_FAST_STATE: ''
  };

  if (lastRow <= 1) return memoryObj;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    const rawVal = values[i][1];
    let val = '';
    if (rawVal instanceof Date) {
      // スプレッドシートが YYYY-MM-DD を自動で Date 型に変換した場合でも正確に文字列へ戻す
      val = Utilities.formatDate(rawVal, 'Asia/Tokyo', 'yyyy-MM-dd');
    } else if (rawVal != null) {
      val = String(rawVal).trim();
    }

    if (key) {
      if (key === 'pressure_alert' || key === 'monthly_report_ready') {
        // 真偽値の文字列表現を大文字 'TRUE' / 'FALSE' に正規化
        memoryObj[key] = val.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
      } else {
        memoryObj[key] = val;
      }
    }
  }
  if (typeof _reqSheetCache === 'object') {
    _reqSheetCache.memory = Object.assign({}, memoryObj);
  }
  return memoryObj;
}

/**
 * 特定のメモリキーの値を更新（存在しなければ追加）
 * @param {string} key
 * @param {string} value
 */
function setMemoryValue(key, value) {
  if (typeof invalidateSheetCache_ === 'function') invalidateSheetCache_('memory');
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.MEMORY);
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const range = sheet.getRange(2, 1, lastRow - 1, 2);
    const rows = range.getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(String(value));
        return;
      }
    }
  }

  // 見つからなかった場合のみ新規行として追加
  appendRowSafely_(sheet, [key, String(value)]);
}

/**
 * プロファイルの安全な新陳代謝・更新（既存データの全消し・破壊的短縮を物理ガード）
 * @param {string} newProfileCandidate AIが提案した新しいプロファイル
 */
function updateProfileSafely(newProfileCandidate) {
  if (!newProfileCandidate || typeof newProfileCandidate !== 'string') return;
  const candidate = newProfileCandidate.trim();
  if (!candidate) return;

  const currentMemory = getMemory();
  const existingProfile = (currentMemory.profile || '').trim();

  if (!existingProfile) {
    setMemoryValue('profile', candidate);
    return;
  }

  // 1. もしAIの提案文の中にすでに既存のキーワード（ぽこあポケモン、サウンドディレクター等）が十分残っていれば、そのまま採用
  const hasKeyContext = candidate.includes('サウンドディレクター') || candidate.includes('ぽこあポケモン') || candidate.length >= existingProfile.length * 0.7;

  if (hasKeyContext) {
    setMemoryValue('profile', candidate);
    Logger.log('プロファイルを安全に新陳代謝・更新しました');
  } else {
    // 2. AIが差分だけを出力して既存を全消ししようとした場合：既存プロファイルの後ろに自然に結合（マージ）
    const mergedProfile = `${existingProfile}\n・${candidate.replace(/^[・\-\s]+/, '')}`;
    setMemoryValue('profile', mergedProfile);
    Logger.log('既存プロファイルを保護し、新しい情報を追記結合（マージ）しました');
  }
}

/**
 * 用語辞書の安全な追記・更新（既存定義の消失を防ぎ、重複なくマージ）
 * @param {string} newDictionaryCandidate AIが提案した新しい辞書テキストまたは単一エントリー
 */
function updateDictionarySafely(newDictionaryCandidate) {
  if (!newDictionaryCandidate || typeof newDictionaryCandidate !== 'string') return;
  const candidate = newDictionaryCandidate.trim();
  if (!candidate) return;

  const currentMemory = getMemory();
  const existingDictionary = (currentMemory.dictionary || '').trim();

  if (!existingDictionary) {
    setMemoryValue('dictionary', candidate);
    return;
  }

  // 1行ずつチェックして既存にない用語のみ末尾に結合
  const newLines = candidate.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let updated = existingDictionary;
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    const term = line.split(':')[0].replace(/^[・\-\s]+/, '').trim();
    if (term && !updated.includes(term)) {
      const cleanLine = line.replace(/^[・\-\s]+/, '');
      updated += `\n・${cleanLine}`;
    }
  }

  if (updated !== existingDictionary) {
    setMemoryValue('dictionary', updated);
    Logger.log('用語辞書に新しい前提知識を追記しました');
  }
}

/**
 * cycle_stamps の特定項目を既存の他のスタンプを破壊せずに安全にマージ更新
 * 変更がない場合（同日付への重複書き込みなど）はスプレッドシート書き込みをスキップする
 * @param {string} updatesText 例: "外歩き・散歩: 2026-10-29"
 * @return {Array<string>} 実際に新規追加または別日付へ更新されたエントリ一覧（例: ["音楽を聴く: 2026-11-13"]）
 */
function updateCycleStampsSafely(updatesText) {
  if (!updatesText || typeof updatesText !== 'string' || !updatesText.trim()) return [];
  const currentMemory = getMemory();
  const existingRaw = (currentMemory.cycle_stamps || '').trim();

  const parseEntries = (text) => {
    const map = {};
    const order = [];
    const lines = text.split(/[,\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([^:：]+)[：:]\s*(.+)$/);
      if (m) {
        const key = m[1].replace(/^[・\-\s]+/, '').trim();
        const val = m[2].trim();
        if (key) {
          if (!map.hasOwnProperty(key)) order.push(key);
          map[key] = val;
        }
      }
    }
    return { map: map, order: order };
  };

  const existing = parseEntries(existingRaw);
  const incoming = parseEntries(updatesText);

  const updatedEntries = [];
  for (let i = 0; i < incoming.order.length; i++) {
    const k = incoming.order[i];
    if (!existing.map.hasOwnProperty(k)) {
      existing.order.push(k);
      updatedEntries.push(`${k}: ${incoming.map[k]}`);
    } else if (existing.map[k] !== incoming.map[k]) {
      updatedEntries.push(`${k}: ${incoming.map[k]}`);
    }
    existing.map[k] = incoming.map[k];
  }

  if (updatedEntries.length === 0) {
    return [];
  }

  const mergedLines = existing.order.map(k => `${k}: ${existing.map[k]}`);
  setMemoryValue('cycle_stamps', mergedLines.join('\n'));
  return updatedEntries;
}

/**
 * lifestyle_habits の特定トピックを既存の他トピックを破壊せずに安全にマージ・更新
 * @param {string} candidate AIが提案した新しい生活習慣テキスト（単一または複数トピック）
 */
function updateLifestyleHabitsSafely(candidate) {
  if (!candidate || typeof candidate !== 'string' || !candidate.trim()) return;
  const currentMemory = getMemory();
  const existingRaw = (currentMemory.lifestyle_habits || '').trim();

  // 既存のトピックマップを構築
  const parseHabits = (text) => {
    const map = {};
    const order = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let currentTopic = null;
    let currentContent = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\[([^\]]+)\][:：\s]*(.*)$/);
      if (match) {
        if (currentTopic) {
          map[currentTopic] = currentContent.join(' ').trim();
        }
        currentTopic = match[1].trim();
        if (order.indexOf(currentTopic) === -1) {
          order.push(currentTopic);
        }
        currentContent = match[2] ? [match[2].trim()] : [];
      } else if (currentTopic) {
        currentContent.push(lines[i]);
      }
    }
    if (currentTopic) {
      map[currentTopic] = currentContent.join(' ').trim();
    }
    return { map: map, order: order };
  };

  const existing = parseHabits(existingRaw);
  const incoming = parseHabits(candidate);

  if (incoming.order.length === 0) {
    // もし [トピック名] の形式でなかった場合、既存末尾に追記
    const cleanCand = candidate.trim();
    const updated = existingRaw ? `${existingRaw}\n${cleanCand}` : cleanCand;
    setMemoryValue('lifestyle_habits', updated);
    Logger.log('lifestyle_habits に新規エントリーを追記しました');
    return;
  }

  for (let i = 0; i < incoming.order.length; i++) {
    const t = incoming.order[i];
    if (!existing.map.hasOwnProperty(t)) {
      existing.order.push(t);
    }
    existing.map[t] = incoming.map[t];
  }

  const mergedLines = existing.order.map(t => `[${t}]: ${existing.map[t]}`);
  const finalVal = mergedLines.join('\n');
  setMemoryValue('lifestyle_habits', finalVal);
  Logger.log('lifestyle_habits の該当トピックを安全にマージ更新しました: ' + incoming.order.join(', '));
}

/**
 * lifestyle_habits テキストから登録済みの見出しトピック一覧（例: ['入浴', '食事', '身支度', ...]）を動的に抽出
 * @param {string} lifestyleHabitsText
 * @return {Array<string>}
 */
function extractHabitTopicsList(lifestyleHabitsText) {
  if (!lifestyleHabitsText || typeof lifestyleHabitsText !== 'string') return [];
  const topics = [];
  const lines = lifestyleHabitsText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[([^\]]+)\]/);
    if (match && match[1]) {
      const topic = match[1].trim();
      if (topic && topics.indexOf(topic) === -1) {
        topics.push(topic);
      }
    }
  }
  return topics;
}

/**
 * lifestyle_habits テキストから指定されたトピック名に合致するエントリー行のみをピンポイント抽出
 * @param {string} lifestyleHabitsText
 * @param {string} matchedTopic 例: "入浴" または "[入浴]"
 * @return {string}
 */
function extractHabitEntryByTopic(lifestyleHabitsText, matchedTopic) {
  if (!lifestyleHabitsText || !matchedTopic || matchedTopic === 'none') return '';
  const cleanTarget = String(matchedTopic).replace(/[\[\]]/g, '').trim();
  if (!cleanTarget || cleanTarget === 'none') return '';

  const lines = lifestyleHabitsText.split('\n');
  const matchedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^\[([^\]]+)\]/);
    if (match && match[1].trim() === cleanTarget) {
      matchedLines.push(line);
    }
  }
  return matchedLines.join('\n');
}

/**
 * 未完了タスク配列をコンテキスト注入用の高密度文字列に整形（リマインド目安・7日超過警告付き）
 * @param {Array<Object>} uncompletedTasks
 * @param {Date} todayDate
 * @return {string}
 */
function formatUncompletedTasksForContext(uncompletedTasks, todayDate) {
  if (!uncompletedTasks || uncompletedTasks.length === 0) return 'なし';
  const todayStr = todayDate ? Utilities.formatDate(todayDate, 'Asia/Tokyo', 'yyyy-MM-dd') : Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  const taskLines = uncompletedTasks.map(t => {
    let warningTag = '';
    if (t.createdDate && todayDate) {
      const parts = t.createdDate.split('-');
      if (parts.length === 3) {
        const cDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const diffDays = Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 7) {
          warningTag = ' [⚠️登録後7日以上経過]';
        }
      }
    }
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
    const remindPart = (t.remindContext && t.remindContext.trim()) ? ` | remind_context:${t.remindContext.trim()}` : '';
    const minsPart = t.estimatedMins ? ` | estimated_mins:${t.estimatedMins}` : '';
    const docPart = (t.docUrl && t.docUrl.trim()) ? ' | 📄資料連携済' : '';
    const memoPart = (t.memo && t.memo.trim()) ? ` | memo:${t.memo.trim()}` : '';
    return `- [${t.id}] ${t.title}${duePart}${minsPart}${remindPart}${docPart}${memoPart}${warningTag}`;
  });
  return taskLines.join('\n');
}

/**
 * 本日のデイリーブリーフィングが配信済みかどうか判定
 * スクリプトプロパティとスプレッドシートmemoryの両方で二重判定し、Date型変換や連投による重複配信を完全遮断
 * @return {boolean}
 */
function isBriefingDeliveredToday() {
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const propDelivered = PropertiesService.getScriptProperties().getProperty('BRIEFING_DELIVERED_DATE');
  if (propDelivered === todayStr) {
    return true;
  }
  const memory = getMemory();
  return memory.briefing_delivered_date === todayStr;
}

/**
 * 本日のデイリーブリーフィング配信完了を記録
 */
function markBriefingDeliveredToday() {
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  PropertiesService.getScriptProperties().setProperty('BRIEFING_DELIVERED_DATE', todayStr);
  setMemoryValue('briefing_delivered_date', todayStr);
}

/**
 * 用語辞書から、指定されたテキスト（ユーザー発言等）に含まれるキーワードに関連するエントリーのみを抽出
 * @param {string} dictionaryText 辞書全体（改行区切り）
 * @param {string} queryText 判定対象のテキスト（ユーザー発言など）
 * @return {string} 関連する辞書エントリー（改行区切り）
 */
function filterRelevantDictionaryEntries(dictionaryText, queryText) {
  if (!dictionaryText || !queryText) return '';
  const lines = dictionaryText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const matched = [];
  const queryLower = queryText.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    // コロンより前の単語名・別名（例: "ぽこあポケモン（ぽこあ）"）を取り出し、キーワード配列化
    const rawTerm = line.substring(0, colonIndex).replace(/^[・\-\s]+/, '').trim().toLowerCase();
    const keywords = rawTerm.split(/[（\(\)）\/\,\s]+/).filter(k => k.length >= 2);

    // キーワードのいずれか、または単語名そのものが発言に含まれているかチェック
    const isHit = keywords.some(k => queryLower.includes(k)) || (rawTerm.length >= 2 && queryLower.includes(rawTerm));
    if (isHit) {
      matched.push(line);
    }
  }
  return matched.join('\n');
}

/**
 * 会話履歴テキストから直近のログ記録時刻（HH:mm）を抽出
 * @param {string} todayLogsText
 * @return {string|null}
 */
function extractLastLogTime(todayLogsText) {
  if (!todayLogsText || typeof todayLogsText !== 'string') return null;
  const lines = todayLogsText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^(\d{1,2}:\d{2})/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * 直前のやり取り時刻と現在日時の差分を計算し、経過時間テキストを生成
 * @param {string|null} lastTimeStr 'HH:mm'
 * @param {Date} nowDate
 * @return {string}
 */
function formatElapsedTime(lastTimeStr, nowDate) {
  if (!lastTimeStr) return 'なし（本日初回の発言）';
  const parts = lastTimeStr.split(':');
  const lastMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

  let diff = nowMinutes - lastMinutes;
  if (diff < 0) {
    diff += 24 * 60; // 日またぎ
  }

  if (diff < 1) {
    return '1分未満（直前のやり取り直後）';
  } else if (diff < 60) {
    return `${diff}分経過`;
  } else {
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}時間${mins > 0 ? mins + '分' : ''}経過（計${diff}分）`;
  }
}

/**
 * Geminiへ送信用にスプレッドシートの現在状態を高密度テキスト（トークン最小化）として抽出
 * @param {string=} queryText ユーザー発言等の判定対象テキスト
 * @param {string=} todayLogsText 本日の会話履歴テキスト（辞書抽出の対象に含める）
 * @param {Date=} simulatedNowDate シミュレーション用の現在日時（過去時点テスト用。省略時はnew Date()）
 * @return {string}
 */
function getSpreadsheetContext(queryText, todayLogsText, simulatedNowDate) {
  const now = simulatedNowDate || new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd(E) HH:mm');
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const memory = getMemory();
  const uncompletedTasks = getTasks('未完了');
  const unboughtShopping = getShoppingList('未買');
  const pendingInput = getInputStockList('未');

  let weatherDisplay = memory.weather_info || '情報なし';
  if (typeof hasOfficeEventToday === 'function' && !hasOfficeEventToday() && weatherDisplay.includes('｜')) {
    weatherDisplay = weatherDisplay.split('｜')[0].trim();
  }

  // --- 【静的・準静的コンテキスト（プレフィックス安定化・キャッシュ適合）】 ---
  // ※プロファイル・理念・用語辞書・記憶・タスク等を先頭に集約し、プレフィックス共通部分を4,096トークン以上に最大化する
  let context = `【プロファイル】: ${memory.profile || '未設定'}\n`;
  if (memory.ideal_self && memory.ideal_self.trim() !== '') {
    context += `【ありたい人間像・生活指針（判断の羅針盤）】: ${memory.ideal_self.trim()}\n`;
  }
  context += `【天気・気温】: ${weatherDisplay}\n`;
  context += `【気圧急降下】: ${memory.pressure_alert === 'TRUE' ? '急降下中(注意)' : '安定'}\n`;

  // 用語辞書: 今回の発言・当日ログ・プロファイル・直近バッファ・未完了タスク・未消化ストックに含まれる用語のみを
  // オンデマンド抽出して注入（無関係な辞書項目のトークン消費をカットしつつ誤認を防止）
  if (memory.dictionary && memory.dictionary.trim() !== '') {
    const taskTitlesText = uncompletedTasks.map(t => t.title).join(' ');
    const inputTitlesText = pendingInput.map(inp => inp.title).join(' ');
    const searchTarget = `${queryText || ''}\n${todayLogsText || ''}\n${memory.profile || ''}\n${memory.rolling_memory || ''}\n${taskTitlesText}\n${inputTitlesText}`;
    const relevantDict = filterRelevantDictionaryEntries(memory.dictionary, searchTarget);
    if (relevantDict) {
      context += `【用語辞書（客観的前提知識・誤認防止）】:\n${relevantDict}\n`;
    }
  }
  if (memory.rolling_memory) {
    context += `【直近活動・関心バッファ】:\n${memory.rolling_memory}\n`;
  }
  if (memory.weekly_summary) {
    context += `【直近1〜2週間の生活・活動サマリー】: ${memory.weekly_summary}\n`;
  }
  if (memory.monthly_report_ready === 'TRUE') {
    context += `【月報通知フラグ】: TRUE\n`;
  }
  if (memory.cycle_stamps && memory.cycle_stamps.trim() !== '') {
    context += `【活動・メンテナンス最終記録（cycle_stamps）】:\n${memory.cycle_stamps.trim()}\n`;
  }

  // 1. 未完了タスクのみを超圧縮 (完了・破棄は完全除外)
  if (uncompletedTasks.length > 0) {
    const taskLines = uncompletedTasks.map(t => {
      let warningTag = '';
      if (t.createdDate) {
        const parts = t.createdDate.split('-');
        if (parts.length === 3) {
          const cDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          const diffDays = Math.floor((todayDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 7) {
            warningTag = ' [⚠️登録後7日以上経過]';
          }
        }
      }
      const memoPart = (t.memo && t.memo.trim()) ? ` (メモ:${t.memo.trim()})` : '';
      return `[${t.id}] ${t.title}${t.dueDate ? ' (期限:' + t.dueDate + ')' : ''}${memoPart}${warningTag}`;
    });
    context += `未完了タスク: ${taskLines.join(' / ')}\n`;
  } else {
    context += `未完了タスク: なし\n`;
  }

  // 2. 買い物リストを1行に圧縮
  if (unboughtShopping.length > 0) {
    const shopItems = unboughtShopping.map(s => s.item);
    context += `買物(未買): ${shopItems.join(', ')}\n`;
  }

  // 3. インプットストックを1行に圧縮（未発売等のメモがあれば含める）
  if (pendingInput.length > 0) {
    const inputItems = pendingInput.map(inp => {
      const memoPart = inp.memo && inp.memo.trim() ? `(${inp.memo.trim()})` : '';
      return `[${inp.type}]${inp.title}${memoPart}`;
    });
    context += `インプット未消化: ${inputItems.join(', ')}\n`;
  }

  // 4. ルーティン設定マスタは「ルーティン」「定期」「習慣」が話題に出た時のみオンデマンド注入
  if (queryText && /(ルーティン|定期|習慣)/.test(queryText)) {
    const routines = getRoutines('有効');
    if (routines.length > 0) {
      const routineItems = routines.map(r => `${r.ruleName}(${r.type}:${r.value})`);
      context += `登録済み定期ルーティン: ${routineItems.join(', ')}\n`;
    }
  }

  // --- 【動的コンテキスト（毎分可変）】 ---
  // ※分単位で変化する現在日時・経過時間は末尾に配置し、先行する静的情報のプレフィックスキャッシュを保護する
  context += `【現在日時】: ${nowStr}\n`;
  const lastTimeStr = extractLastLogTime(todayLogsText);
  const elapsedStr = formatElapsedTime(lastTimeStr, now);
  context += `【直前のやり取りからの経過時間】: ${elapsedStr}\n`;

  return context.trim();
}

/**
 * 論理日（03:00〜翌02:59）における指定日時時点のログ配列を取得（v2 Chat / Bootstrap用）
 * @param {Date=} nowOpt
 * @return {Array<Object>}
 */
function getLogicalTodayLogs(nowOpt) {
  const now = nowOpt || new Date();
  const hour = parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'H'), 10);
  if (hour >= 3) {
    const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
    return getLogs(todayStr).filter(l => !isEarlyMorningTimestampStr_(l.timestampStr));
  }
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yStr = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy-MM-dd');
  const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const yDayLogs = getLogs(yStr).filter(l => !isEarlyMorningTimestampStr_(l.timestampStr));
  const tEarlyLogs = getLogs(todayStr).filter(l => isEarlyMorningTimestampStr_(l.timestampStr));
  return yDayLogs.concat(tEarlyLogs);
}
