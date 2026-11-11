/**
 * DriveProject.js - Google Drive プロジェクトフォルダ・Google Docs連携モジュール
 * マイドライブ直下の7大生活領域フォルダ配下に「YYMM_プロジェクト名」構造で整理・保管し、
 * タスクシート（9列目: 関連URL）および memory.project_folders 台帳と双方向同期する。
 */

const MEMORY_KEY_PROJECT_ROOT_IDS = 'project_root_ids';
const MEMORY_KEY_PROJECT_FOLDERS = 'project_folders';
const PROJECT_ARCHIVE_FOLDER_NAME = '_completed';

/**
 * 完了アーカイブ専用フォルダ（_completed / completed 等）として進行中プロジェクト台帳の走査対象外にすべきか判定
 * @param {string} folderName
 * @return {boolean}
 * @private
 */
function isArchiveProjectFolderName_(folderName) {
  const normalized = String(folderName || '').trim().toLowerCase();
  return normalized === PROJECT_ARCHIVE_FOLDER_NAME || normalized === 'completed';
}

/**
 * カテゴリ文字列（「制作・創作」「02_制作・創作」「[制作・創作]」等）から公式7大親フォルダ情報を解決
 * @param {string} rawCategory
 * @return {{prefix: string, folderName: string}}
 * @private
 */
function resolveProjectRootCategory_(rawCategory) {
  const categories = SYSTEM_CONSTANTS.PROJECT_ROOT_CATEGORIES || [];
  const cleaned = String(rawCategory || '').replace(/[\[\]\s]/g, '').trim();

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (c.folderName === cleaned || c.prefix === cleaned) {
      return c;
    }
  }
  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (cleaned.includes(c.prefix) || c.prefix.includes(cleaned) && cleaned.length >= 2) {
      return c;
    }
  }
  // デフォルトフォールバック（実務・手続）
  return categories[3] || { prefix: '実務・手続', folderName: '04_実務・手続' };
}

/**
 * プロジェクト名に年月プリフィックス（YYMM_）を付与（既にあれば重複付与しない）
 * @param {string} rawName
 * @return {string}
 * @private
 */
function normalizeProjectFolderName_(rawName) {
  const name = String(rawName || '').trim().replace(/[\/\\:*?"<>|]/g, '_');
  if (!name) {
    const yymm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMM');
    return `${yymm}_新規プロジェクト`;
  }
  if (/^\d{4}_/.test(name)) {
    return name;
  }
  const yymm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyMM');
  return `${yymm}_${name}`;
}

/**
 * Google Docs / Drive URL からファイル・フォルダIDを抽出
 * @param {string} url
 * @return {{type: 'doc'|'folder'|'unknown', id: string}}
 */
function parseDriveResourceUrl(url) {
  const u = String(url || '').trim();
  if (!u) return { type: 'unknown', id: '' };

  const docMatch = u.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) return { type: 'doc', id: docMatch[1] };

  const folderMatch = u.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { type: 'folder', id: folderMatch[1] };

  return { type: 'unknown', id: '' };
}

/**
 * キャッシュまたはマイドライブ直下から7大カテゴリ親フォルダを取得（無ければ作成）
 * @param {string} folderName
 * @param {Object=} rootIdsMapOpt
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function getOrCreateRootCategoryFolder_(folderName, rootIdsMapOpt) {
  let rootIdsMap = rootIdsMapOpt;
  let shouldSaveCache = false;

  if (!rootIdsMap) {
    const memory = getMemory();
    try {
      rootIdsMap = memory[MEMORY_KEY_PROJECT_ROOT_IDS] ? JSON.parse(memory[MEMORY_KEY_PROJECT_ROOT_IDS]) : {};
    } catch (e) {
      rootIdsMap = {};
    }
  }

  // 1. キャッシュIDから O(1) 取得を試行
  if (rootIdsMap[folderName]) {
    try {
      const cachedFolder = DriveApp.getFolderById(rootIdsMap[folderName]);
      if (cachedFolder && !cachedFolder.isTrashed()) {
        return cachedFolder;
      }
    } catch (e) {
      // ID無効時は再探索へフォールバック
    }
  }

  // 2. マイドライブ直下から同名フォルダを探索
  const root = DriveApp.getRootFolder();
  const it = root.getFoldersByName(folderName);
  let targetFolder = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) {
      targetFolder = f;
      break;
    }
  }

  // 3. 無ければ新規作成
  if (!targetFolder) {
    targetFolder = root.createFolder(folderName);
  }

  rootIdsMap[folderName] = targetFolder.getId();
  shouldSaveCache = true;

  if (shouldSaveCache && !rootIdsMapOpt) {
    setMemoryValue(MEMORY_KEY_PROJECT_ROOT_IDS, JSON.stringify(rootIdsMap));
  }

  return targetFolder;
}

/**
 * マイドライブ直下に7大カテゴリ親フォルダを一括構築し、IDマップをキャッシュ保存
 * @return {Object} フォルダ名 -> フォルダID のマップ
 */
function ensureProjectRootFolders() {
  const categories = SYSTEM_CONSTANTS.PROJECT_ROOT_CATEGORIES || [];
  const memory = getMemory();
  let rootIdsMap = {};
  try {
    rootIdsMap = memory[MEMORY_KEY_PROJECT_ROOT_IDS] ? JSON.parse(memory[MEMORY_KEY_PROJECT_ROOT_IDS]) : {};
  } catch (e) {
    rootIdsMap = {};
  }

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const folder = getOrCreateRootCategoryFolder_(cat.folderName, rootIdsMap);
    rootIdsMap[cat.folderName] = folder.getId();
  }

  setMemoryValue(MEMORY_KEY_PROJECT_ROOT_IDS, JSON.stringify(rootIdsMap));
  return rootIdsMap;
}

/**
 * project_folders メモリー文字列を構造化配列にパース
 * フォーマット: [02_制作・創作] 2611_BFプラグイン購入検討 | folder:xxx | doc:yyy
 * @param {string} rawText
 * @return {Array<Object>}
 */
function parseProjectFoldersIndex(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\[([^\]]+)\]\s*([^|]+)(.*)$/);
    if (!m) continue;

    const categoryFolderName = m[1].trim();
    const projectName = m[2].trim();
    const rest = m[3] || '';

    const folderMatch = rest.match(/folder:([a-zA-Z0-9_-]+)/);
    const docMatch = rest.match(/doc:([a-zA-Z0-9_-]+)/);

    entries.push({
      categoryFolderName: categoryFolderName,
      projectName: projectName,
      folderId: folderMatch ? folderMatch[1] : '',
      docId: docMatch ? docMatch[1] : ''
    });
  }
  return entries;
}

/**
 * 構造化プロジェクト一覧を memory 保存用文字列にシリアライズ
 * @param {Array<Object>} entries
 * @return {string}
 */
function serializeProjectFoldersIndex(entries) {
  if (!entries || !Array.isArray(entries) || entries.length === 0) return '';
  return entries.map(e => {
    let line = `[${e.categoryFolderName}] ${e.projectName} | folder:${e.folderId}`;
    if (e.docId) {
      line += ` | doc:${e.docId}`;
    }
    return line;
  }).join('\n');
}

/**
 * AIコンテキスト注入用の軽量プロジェクト一覧テキストを生成（ID文字列を省いてトークン節約）
 * @param {string} rawProjectFolders
 * @return {string}
 */
function formatProjectsForAiPrompt(rawProjectFolders) {
  const entries = parseProjectFoldersIndex(rawProjectFolders);
  if (entries.length === 0) return 'なし';
  return entries.map(e => `- [${e.categoryFolderName}] ${e.projectName}${e.docId ? ' (📄Doc連携あり)' : ' (📁フォルダのみ)'}`).join('\n');
}

/**
 * プロジェクト名クエリから既存エントリを柔軟に検索
 * @param {Array<Object>} entries
 * @param {string} query
 * @return {Object|null}
 */
function findProjectEntry(entries, query) {
  if (!entries || entries.length === 0 || !query) return null;
  const q = String(query).trim();
  const qNoDate = q.replace(/^\d{4}_/, '').trim();

  // 1. 完全一致
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].projectName === q) return entries[i];
  }
  // 2. 年月プレフィックス除外での完全一致
  for (let i = 0; i < entries.length; i++) {
    const pNoDate = entries[i].projectName.replace(/^\d{4}_/, '').trim();
    if (pNoDate === qNoDate) return entries[i];
  }
  // 3. 部分一致（より長い一致を優先）
  let best = null;
  let bestScore = 0;
  for (let i = 0; i < entries.length; i++) {
    const pName = entries[i].projectName;
    const pNoDate = pName.replace(/^\d{4}_/, '').trim();
    if (pName.includes(q) || q.includes(pName) || pNoDate.includes(qNoDate) || qNoDate.includes(pNoDate)) {
      const score = Math.min(qNoDate.length, pNoDate.length);
      if (score > bestScore) {
        bestScore = score;
        best = entries[i];
      }
    }
  }
  return best;
}

/**
 * プロジェクトエントリから関連URL（Doc優先、無ければFolder）を解決
 * @param {Object} entry
 * @return {string}
 */
function getProjectEntryResourceUrl(entry) {
  if (!entry) return '';
  if (entry.docId) return `https://docs.google.com/document/d/${entry.docId}/edit`;
  if (entry.folderId) return `https://drive.google.com/drive/folders/${entry.folderId}`;
  return '';
}

/**
 * 7大親フォルダ直下（進行中プロジェクト階層のみ）をスキャンして memory.project_folders を最新同期
 * 手動でPC等から追加・リネーム・削除したプロジェクトフォルダも自動追従する
 * （各カテゴリ直下の _completed 等の完了アーカイブ専用フォルダは走査対象外）
 * @return {Array<Object>}
 */
function syncProjectFoldersIndex() {
  const rootIdsMap = ensureProjectRootFolders();
  const categories = SYSTEM_CONSTANTS.PROJECT_ROOT_CATEGORIES || [];
  const entries = [];

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const rootId = rootIdsMap[cat.folderName];
    if (!rootId) continue;

    let parentFolder;
    try {
      parentFolder = DriveApp.getFolderById(rootId);
      if (!parentFolder || parentFolder.isTrashed()) continue;
    } catch (e) {
      continue;
    }

    const subFolders = parentFolder.getFolders();
    const catEntries = [];
    while (subFolders.hasNext()) {
      const sub = subFolders.next();
      if (sub.isTrashed() || isArchiveProjectFolderName_(sub.getName())) continue;

      // フォルダ内のGoogle Docsを検索し、代表ドキュメント1件を選定（名前一致または最新更新順）
      const docs = sub.getFilesByType(MimeType.GOOGLE_DOCS);
      let bestDocId = '';
      let latestUpdated = 0;
      const subNameCore = sub.getName().replace(/^\d{4}_/, '');

      while (docs.hasNext()) {
        const d = docs.next();
        if (d.isTrashed()) continue;
        const dName = d.getName();
        const updatedTime = d.getLastUpdated().getTime();
        if (dName.includes(subNameCore) || dName.includes(sub.getName())) {
          bestDocId = d.getId();
          break;
        }
        if (updatedTime > latestUpdated) {
          latestUpdated = updatedTime;
          bestDocId = d.getId();
        }
      }

      catEntries.push({
        categoryFolderName: cat.folderName,
        projectName: sub.getName(),
        folderId: sub.getId(),
        docId: bestDocId
      });
    }

    // プロジェクト名の降順（新しいYYMMが上）でソート
    catEntries.sort((a, b) => b.projectName.localeCompare(a.projectName));
    entries.push.apply(entries, catEntries);
  }

  setMemoryValue(MEMORY_KEY_PROJECT_FOLDERS, serializeProjectFoldersIndex(entries));
  return entries;
}

/**
 * Google Docを新規作成し指定フォルダへ移動・初期テキストを書き込み
 * @param {GoogleAppsScript.Drive.Folder} targetFolder
 * @param {string} docTitle
 * @param {string=} initialContent
 * @return {{docId: string, docUrl: string}}
 * @private
 */
function createGoogleDocInFolder_(targetFolder, docTitle, initialContent) {
  const doc = DocumentApp.create(docTitle);
  const docId = doc.getId();
  const body = doc.getBody();

  body.appendParagraph(docTitle).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  body.appendParagraph(`作成日時: ${nowStr}`);
  body.appendHorizontalRule();

  if (initialContent && String(initialContent).trim() !== '') {
    const lines = String(initialContent).trim().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^[-・*]\s*/.test(line)) {
        body.appendListItem(line.replace(/^[-・*]\s*/, ''));
      } else {
        body.appendParagraph(line);
      }
    }
  }
  doc.saveAndClose();

  // ルートから対象フォルダへ移動
  const file = DriveApp.getFileById(docId);
  file.moveTo(targetFolder);

  return {
    docId: docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`
  };
}

/**
 * 既存Google Docの末尾にタイムスタンプ付きでテキスト・箇条書きを追記
 * @param {string} docId
 * @param {string} content
 * @return {{docTitle: string, docUrl: string}}
 */
function appendTextToGoogleDoc(docId, content) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const nowStamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  const lines = String(content || '').trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const cleanLine = lines[i].replace(/^[-・*]\s*/, '');
    body.appendListItem(`[${nowStamp}] ${cleanLine}`);
  }
  doc.saveAndClose();

  return {
    docTitle: doc.getName(),
    docUrl: `https://docs.google.com/document/d/${docId}/edit`
  };
}

/**
 * タスクシートの特定タスクの9列目（関連URL）を更新する内部ヘルパー
 * @param {string=} taskId
 * @param {string=} taskTitle
 * @param {string} resourceUrl
 * @return {string} 更新されたタスクタイトル（見つからない場合は空文字）
 * @private
 */
function linkResourceUrlToTask_(taskId, taskTitle, resourceUrl) {
  if (!resourceUrl || (!taskId && !taskTitle)) return '';
  const sheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  const tasks = getTasks();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.status !== '未完了') continue;
    const matchId = taskId && t.id === taskId;
    const matchTitle = taskTitle && (t.title.includes(taskTitle) || taskTitle.includes(t.title));
    if (matchId || matchTitle) {
      sheet.getRange(t.rowIndex, 9).setValue(resourceUrl);
      return t.title;
    }
  }
  return '';
}

/**
 * Geminiレスポンスに基づく Driveプロジェクト・Google Docs 操作を実行
 * @param {Array<Object>} actions
 * @return {{notices: Array<string>, createdUrlMap: Object}}
 */
function applyProjectActions(actions) {
  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    return { notices: [], createdUrlMap: {} };
  }

  const notices = [];
  const createdUrlMap = {};
  const memory = getMemory();
  let entries = parseProjectFoldersIndex(memory[MEMORY_KEY_PROJECT_FOLDERS] || '');
  let rootIdsMap = {};
  try {
    rootIdsMap = memory[MEMORY_KEY_PROJECT_ROOT_IDS] ? JSON.parse(memory[MEMORY_KEY_PROJECT_ROOT_IDS]) : {};
  } catch (e) {
    rootIdsMap = {};
  }
  let indexDirty = false;
  let rootCacheDirty = false;

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!act || !act.action) continue;

    if (act.action === 'create_project') {
      const catInfo = resolveProjectRootCategory_(act.category || '');
      const hadCached = Boolean(rootIdsMap[catInfo.folderName]);
      const parentFolder = getOrCreateRootCategoryFolder_(catInfo.folderName, rootIdsMap);
      if (!hadCached && rootIdsMap[catInfo.folderName]) rootCacheDirty = true;

      const projFolderName = normalizeProjectFolderName_(act.project_name || act.doc_title || '新規プロジェクト');
      // 親フォルダ内に同名プロジェクトが無いか確認
      let projFolder = null;
      const existingIt = parentFolder.getFoldersByName(projFolderName);
      while (existingIt.hasNext()) {
        const f = existingIt.next();
        if (!f.isTrashed()) {
          projFolder = f;
          break;
        }
      }
      if (!projFolder) {
        projFolder = parentFolder.createFolder(projFolderName);
      }

      const folderId = projFolder.getId();
      const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
      let docId = '';
      let docUrl = '';

      // 明示的に create_doc: false でない限り Google Doc を作成
      if (act.create_doc !== false) {
        const docTitle = String(act.doc_title || projFolderName.replace(/^\d{4}_/, '')).trim();
        const docRes = createGoogleDocInFolder_(projFolder, docTitle, act.initial_content || '');
        docId = docRes.docId;
        docUrl = docRes.docUrl;
      }

      // 台帳を更新・追加
      const existingEntry = findProjectEntry(entries, projFolderName);
      if (existingEntry) {
        existingEntry.categoryFolderName = catInfo.folderName;
        existingEntry.folderId = folderId;
        if (docId) existingEntry.docId = docId;
      } else {
        entries.unshift({
          categoryFolderName: catInfo.folderName,
          projectName: projFolderName,
          folderId: folderId,
          docId: docId
        });
      }
      indexDirty = true;

      const primaryUrl = docUrl || folderUrl;
      createdUrlMap[projFolderName] = primaryUrl;
      if (act.project_name) createdUrlMap[String(act.project_name).trim()] = primaryUrl;

      notices.push(`📁 フォルダ作成: [${catInfo.folderName}] ${projFolderName}`);
      if (docUrl) {
        notices.push(`📄 資料作成: ${act.doc_title || projFolderName.replace(/^\d{4}_/, '')} (${docUrl})`);
      }

      // 既存タスクへの直接紐付け指定がある場合
      if (act.task_id || act.target_task_title) {
        const linkedTitle = linkResourceUrlToTask_(act.task_id, act.target_task_title, primaryUrl);
        if (linkedTitle) {
          notices.push(`🔗 タスク紐付: ${formatTaskTitleWithBadge(linkedTitle)}`);
        }
      }
    } else if (act.action === 'add_doc') {
      let entry = findProjectEntry(entries, act.project_name || '');
      if (!entry && (act.task_id || act.target_task_title)) {
        // タスクの関連URLからフォルダ解決を試みる
        const tasks = getTasks();
        const t = tasks.find(tk => (act.task_id && tk.id === act.task_id) || (act.target_task_title && tk.title.includes(act.target_task_title)));
        if (t && t.docUrl) {
          const parsed = parseDriveResourceUrl(t.docUrl);
          if (parsed.type === 'folder') {
            entry = entries.find(e => e.folderId === parsed.id) || { folderId: parsed.id, projectName: t.title, categoryFolderName: '' };
          } else if (parsed.type === 'doc') {
            entry = entries.find(e => e.docId === parsed.id);
          }
        }
      }

      if (entry && entry.folderId) {
        const projFolder = DriveApp.getFolderById(entry.folderId);
        const docTitle = String(act.doc_title || 'メモ').trim();
        const docRes = createGoogleDocInFolder_(projFolder, docTitle, act.initial_content || '');
        entry.docId = docRes.docId;
        indexDirty = true;

        createdUrlMap[entry.projectName] = docRes.docUrl;
        notices.push(`📄 資料追加 (${entry.projectName}): ${docTitle} (${docRes.docUrl})`);

        if (act.task_id || act.target_task_title) {
          const linkedTitle = linkResourceUrlToTask_(act.task_id, act.target_task_title, docRes.docUrl);
          if (linkedTitle) {
            notices.push(`🔗 タスク紐付: ${formatTaskTitleWithBadge(linkedTitle)}`);
          }
        }
      }
    } else if (act.action === 'append_doc' && act.content) {
      let targetDocId = '';
      let fallbackEntry = null;

      // 1. タスク経由でDoc ID解決
      if (act.task_id || act.target_task_title) {
        const tasks = getTasks();
        const t = tasks.find(tk => tk.status === '未完了' && ((act.task_id && tk.id === act.task_id) || (act.target_task_title && tk.title.includes(act.target_task_title))));
        if (t && t.docUrl) {
          const parsed = parseDriveResourceUrl(t.docUrl);
          if (parsed.type === 'doc') {
            targetDocId = parsed.id;
          } else if (parsed.type === 'folder') {
            fallbackEntry = entries.find(e => e.folderId === parsed.id);
          }
        }
      }

      // 2. プロジェクト名経由でDoc ID解決
      if (!targetDocId && act.project_name) {
        const entry = findProjectEntry(entries, act.project_name);
        if (entry) {
          if (entry.docId) targetDocId = entry.docId;
          else fallbackEntry = entry;
        }
      }

      // 3. フォルダのみ存在してDocが未作成だった場合、フェイルセーフとしてDocを作成してから追記
      if (!targetDocId && fallbackEntry && fallbackEntry.folderId) {
        const projFolder = DriveApp.getFolderById(fallbackEntry.folderId);
        const docTitle = fallbackEntry.projectName.replace(/^\d{4}_/, '');
        const docRes = createGoogleDocInFolder_(projFolder, docTitle, act.content);
        targetDocId = docRes.docId;
        fallbackEntry.docId = targetDocId;
        indexDirty = true;
        notices.push(`📄 資料作成＆追記 (${docTitle}): ${docRes.docUrl}`);
        if (act.task_id || act.target_task_title) {
          linkResourceUrlToTask_(act.task_id, act.target_task_title, docRes.docUrl);
        }
        continue;
      }

      if (targetDocId) {
        const appRes = appendTextToGoogleDoc(targetDocId, act.content);
        notices.push(`📄 資料追記 (${appRes.docTitle}): ${String(act.content).trim().substring(0, 40)}`);
      }
    }
  }

  if (rootCacheDirty) {
    setMemoryValue(MEMORY_KEY_PROJECT_ROOT_IDS, JSON.stringify(rootIdsMap));
  }
  if (indexDirty) {
    setMemoryValue(MEMORY_KEY_PROJECT_FOLDERS, serializeProjectFoldersIndex(entries));
  }

  return { notices: notices, createdUrlMap: createdUrlMap };
}

/**
 * 【初回1回のみGASエディタから実行】
 * 1. Google Docs / Drive 権限承認とマイドライブ直下の7大カテゴリフォルダ構築
 * 2. 「2611_Google Drive整理」「2611_BFプラグイン購入検討」プロジェクトフォルダ＆Google Docs作成
 * 3. スプレッドシート上の既存未完了タスク2件へのDoc URL自動紐付け
 */
function setupInitialProjectSystem() {
  Logger.log('=== プロジェクトDrive/Docs連携 初期セットアップ開始 ===');
  const tasksSheet = getOrCreateSheet(SYSTEM_CONSTANTS.SHEET_NAMES.TASKS);
  if (tasksSheet.getLastRow() >= 1 && !String(tasksSheet.getRange(1, 9).getValue() || '').trim()) {
    tasksSheet.getRange(1, 9).setValue('関連URL');
    if (typeof formatHeaderRow_ === 'function') {
      formatHeaderRow_(tasksSheet);
    }
  }
  const rootIdsMap = ensureProjectRootFolders();
  Logger.log('✅ 7大カテゴリフォルダ構築完了: ' + JSON.stringify(rootIdsMap));

  const tasks = getTasks('未完了');
  const findTaskByKeyword = (kw) => tasks.find(t => t.title.includes(kw));

  // 1. 2611_Google Drive整理
  const driveTask = findTaskByKeyword('Googleドライブ');
  const res1 = applyProjectActions([{
    action: 'create_project',
    category: '家事・環境',
    project_name: '2611_Google Drive整理',
    doc_title: 'Google Driveフォルダ整理ルール・移行メモ',
    initial_content: [
      '・マイドライブ直下に7大生活領域フォルダ（01_仕事 〜 07_お出かけ）を配置する',
      '・プロジェクトフォルダは「YYMM_プロジェクト名」形式で作成し、直下にファイルを直置きしない',
      '・既存の雑多なファイルを順次各カテゴリ・プロジェクトフォルダへ整理移行していく'
    ].join('\n'),
    task_id: driveTask ? driveTask.id : ''
  }]);
  Logger.log('プロジェクト1結果: ' + res1.notices.join(' / '));

  // 2. 2611_BFプラグイン購入検討
  const bfTask = findTaskByKeyword('ブラックフライデー');
  const bfInitialLines = [
    'セール対象プラグインのリストアップ・検討用ドキュメント（外部AI比較相談の母艦）'
  ];
  if (bfTask && bfTask.memo) {
    bfInitialLines.push(bfTask.memo);
  }
  const res2 = applyProjectActions([{
    action: 'create_project',
    category: '制作・創作',
    project_name: '2611_BFプラグイン購入検討',
    doc_title: 'BF2026_プラグイン購入検討',
    initial_content: bfInitialLines.join('\n'),
    task_id: bfTask ? bfTask.id : ''
  }]);
  Logger.log('プロジェクト2結果: ' + res2.notices.join(' / '));

  const synced = syncProjectFoldersIndex();
  Logger.log(`🎉 初期セットアップ完了！ 認識されたプロジェクト数: ${synced.length}件`);
}
