/**
 * Notion.js - Notion API連携モジュール
 * 日報ページ作成、月報ページ作成、前月日報データクエリ
 */

/**
 * Notion APIリクエスト実行共通関数
 * @param {string} endpoint
 * @param {string} method GET / POST / PATCH
 * @param {Object} payload リクエストボディ
 * @return {Object} レスポンスJSON
 */
function callNotionApi(endpoint, method, payload) {
  const config = getConfig();
  const options = {
    method: method || 'get',
    headers: {
      'Authorization': `Bearer ${config.notionApiKey}`,
      'Notion-Version': SYSTEM_CONSTANTS.NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (payload && (method === 'post' || method === 'patch')) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(`${SYSTEM_CONSTANTS.NOTION_API_BASE}${endpoint}`, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Notion APIエラー [${code}] ${endpoint}: ${text}`);
  }

  return JSON.parse(text);
}

/**
 * データベースのプロパティ定義から title型、date型、rich_text型、multi_select型、select型のプロパティ名を動的特定
 * @param {string} databaseId
 * @return {Object} { titleKey: string, dateKey: string|null, summaryKey: string|null, areasKey: string|null, toneKey: string|null, workStyleKey: string|null }
 */
function getDatabaseSchemaKeys(databaseId) {
  try {
    const dbInfo = callNotionApi(`/databases/${databaseId}`, 'get');
    let titleKey = '名前';
    let dateKey = null;
    let summaryKey = null;
    let areasKey = null;
    let toneKey = null;
    let workStyleKey = null;

    if (dbInfo && dbInfo.properties) {
      const propKeys = Object.keys(dbInfo.properties);
      for (let i = 0; i < propKeys.length; i++) {
        const k = propKeys[i];
        const prop = dbInfo.properties[k];
        if (prop.type === 'title') {
          titleKey = k;
        } else if (prop.type === 'date' && !dateKey) {
          dateKey = k;
        } else if (prop.type === 'rich_text') {
          if (!summaryKey || k.includes('サマリー') || k.includes('概要')) {
            summaryKey = k;
          }
        } else if (prop.type === 'multi_select') {
          if (!areasKey || k.includes('領域')) {
            areasKey = k;
          }
        } else if (prop.type === 'select') {
          if (k.includes('形態') || k.includes('スタイル') || k.includes('出社')) {
            workStyleKey = k;
          } else if (k.includes('トーン') || k.includes('リズム') || k.includes('調子')) {
            toneKey = k;
          } else if (!toneKey) {
            toneKey = k;
          } else if (!workStyleKey) {
            workStyleKey = k;
          }
        }
      }
    }
    return { titleKey, dateKey, summaryKey, areasKey, toneKey, workStyleKey };
  } catch (e) {
    Logger.log(`DBスキーマ取得失敗 (${databaseId}): ${e.message}。デフォルトキーを使用します。`);
    return { titleKey: '名前', dateKey: '日付', summaryKey: '概要', areasKey: '主な領域', toneKey: 'トーン', workStyleKey: '形態' };
  }
}

/**
 * 生成テキストの冒頭からメタデータJSONブロックとMarkdown本文を分離
 * @param {string} text
 * @return {Object} { metadata: Object, markdown: string }
 */
function extractReportMetadata_(text) {
  if (!text) return { metadata: {}, markdown: '' };

  const trimmed = text.trim();
  const match = trimmed.match(/^```json\s*([\s\S]*?)\s*```\s*([\s\S]*)$/i);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      return {
        metadata: parsed || {},
        markdown: (match[2] || '').trim()
      };
    } catch (e) {
      Logger.log(`メタデータJSONパース失敗: ${e.message}`);
    }
  }

  return { metadata: {}, markdown: trimmed };
}

/**
 * インラインMarkdown（**太字**など）をNotionのrich_text配列に変換
 * @param {string} text
 * @return {Array<Object>} Notion rich_text array
 */
function parseRichTextWithAnnotations(text) {
  if (!text) return [];
  const richText = [];
  // **太字** パターンを分割抽出
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const normalPart = text.substring(lastIndex, match.index);
      if (normalPart) {
        richText.push({
          type: 'text',
          text: { content: normalPart }
        });
      }
    }
    const boldPart = match[1];
    if (boldPart) {
      richText.push({
        type: 'text',
        text: { content: boldPart },
        annotations: { bold: true }
      });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex);
    if (remaining) {
      richText.push({
        type: 'text',
        text: { content: remaining }
      });
    }
  }

  if (richText.length === 0) {
    richText.push({
      type: 'text',
      text: { content: text }
    });
  }

  return richText;
}

/**
 * Google Driveの閲覧URL等をNotion埋め込み可能な直接画像URLに変換し、必要に応じて共有権限を付与
 * @param {string} rawUrl
 * @return {string}
 */
function normalizeImageUrlForNotion(rawUrl) {
  if (!rawUrl) return '';
  let url = rawUrl.trim();

  // Google DriveのファイルID抽出（/file/d/<ID>/view または /d/<ID> または id=<ID>）
  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                       url.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/) ||
                       url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1]) {
    const fileId = driveIdMatch[1];
    try {
      const file = DriveApp.getFileById(fileId);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      // 既に共有済みまたは権限外の場合は無視
    }
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  return url;
}

/**
 * MarkdownテキストをNotionブロック配列に変換（太字、区切り線、画像埋め込み対応）
 * @param {string} markdown
 * @return {Array<Object>} Notion blocks
 */
function markdownToNotionBlocks(markdown) {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    // 1. 区切り線 (---, ***, ___)
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {}
      });
      if (blocks.length >= 95) break;
      continue;
    }

    // 2. 画像ブロック (![キャプション](https://...))
    const imgMatch = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (imgMatch) {
      const captionText = (imgMatch[1] || '').trim();
      const imageUrl = normalizeImageUrlForNotion(imgMatch[2]);
      if (imageUrl) {
        const imageBlock = {
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url: imageUrl }
          }
        };
        if (captionText) {
          imageBlock.image.caption = [{ type: 'text', text: { content: captionText } }];
        }
        blocks.push(imageBlock);
        if (blocks.length >= 95) break;
        continue;
      }
    }

    // 2000文字上限ガード
    let safeContent = line.length > 1900 ? line.substring(0, 1900) + '...' : line;

    // ハイフン結合見出し（- ## 見出し）の自動救済
    if (/^[-*]\s+###\s+/.test(safeContent)) {
      safeContent = safeContent.replace(/^[-*]\s+/, '');
    } else if (/^[-*]\s+##\s+/.test(safeContent)) {
      safeContent = safeContent.replace(/^[-*]\s+/, '');
    } else if (/^[-*]\s+#\s+/.test(safeContent)) {
      safeContent = safeContent.replace(/^[-*]\s+/, '');
    }

    // チェックボックス (- [x] または - [ ]) の Notion to_do ブロック変換
    const todoMatch = safeContent.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (todoMatch) {
      const isChecked = todoMatch[1].toLowerCase() === 'x';
      const todoText = todoMatch[2].trim();
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: parseRichTextWithAnnotations(todoText),
          checked: isChecked
        }
      });
      if (blocks.length >= 95) break;
      continue;
    }

    if (safeContent.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^###\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^##\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^#\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('- ') || safeContent.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^[-*]\s+/, ''))
        }
      });
    } else if (/^\d+\.\s+/.test(safeContent)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^\d+\.\s+/, ''))
        }
      });
    } else if (safeContent.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: parseRichTextWithAnnotations(safeContent.replace(/^>\s+/, ''))
        }
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseRichTextWithAnnotations(safeContent)
        }
      });
    }

    if (blocks.length >= 95) break;
  }

  return blocks;
}

/**
 * 日報をNotion日報データベースに作成
 * @param {string} markdownContent 生成されたMarkdown日報
 * @param {string} dateStr YYYY-MM-DD
 * @return {Object} 作成されたページ情報
 */
function createDailyReport(markdownContent, dateStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionDailyDbId);
  const { metadata, markdown } = extractReportMetadata_(markdownContent);
  const blocks = markdownToNotionBlocks(markdown);

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  let dayOfWeek = '';
  if (dateStr) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      dayOfWeek = dayNames[d.getDay()] || '';
    }
  }
  const titleText = dayOfWeek ? `${dateStr}(${dayOfWeek}) 日報・生活記録` : `${dateStr} 日報・生活記録`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    properties[schema.dateKey] = {
      date: { start: dateStr }
    };
  }

  // 概要プロパティ (rich_text: プレフィックスなし・改行なしの1文ストレート要約)
  if (schema.summaryKey && metadata.summary) {
    properties[schema.summaryKey] = {
      rich_text: [{ text: { content: String(metadata.summary).trim() } }]
    };
  }

  // 主な領域プロパティ (multi_select: 8大領域)
  if (schema.areasKey && Array.isArray(metadata.areas) && metadata.areas.length > 0) {
    properties[schema.areasKey] = {
      multi_select: metadata.areas.map(a => ({ name: String(a).trim() }))
    };
  }

  // トーンプロパティ (select: 心身の調子・活動ペース)
  if (schema.toneKey && metadata.tone) {
    properties[schema.toneKey] = {
      select: { name: String(metadata.tone).trim() }
    };
  }

  // 形態プロパティ (select: 🏢 出社, 🏠 リモート, 🌿 休日)
  if (schema.workStyleKey && metadata.work_style) {
    properties[schema.workStyleKey] = {
      select: { name: String(metadata.work_style).trim() }
    };
  }

  const payload = {
    parent: { database_id: config.notionDailyDbId },
    properties: properties,
    children: blocks
  };

  return callNotionApi('/pages', 'post', payload);
}

/**
 * 前月の日報一覧を取得してテキストとして要約（埋め込み画像URLも保持）
 * @param {string} startDateStr YYYY-MM-DD (前月初日)
 * @param {string} endDateStr YYYY-MM-DD (前月末日)
 * @return {string} 前月日報の集約テキスト
 */
function queryMonthlyReports(startDateStr, endDateStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionDailyDbId);

  const queryPayload = {
    page_size: 50
  };

  if (schema.dateKey) {
    queryPayload.filter = {
      and: [
        {
          property: schema.dateKey,
          date: { on_or_after: startDateStr }
        },
        {
          property: schema.dateKey,
          date: { on_or_before: endDateStr }
        }
      ]
    };
    queryPayload.sorts = [
      {
        property: schema.dateKey,
        direction: 'ascending'
      }
    ];
  }

  let aggregatedText = '';

  try {
    const result = callNotionApi(`/databases/${config.notionDailyDbId}/query`, 'post', queryPayload);
    const pages = result.results || [];

    if (pages.length === 0) {
      return '（前月の日報データは見つかりませんでした）';
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let pageTitle = '無題';
      const titleProp = page.properties[schema.titleKey];
      if (titleProp && titleProp.title && titleProp.title.length > 0) {
        pageTitle = titleProp.title.map(t => t.plain_text).join('');
      }

      aggregatedText += `\n=== [${pageTitle}] ===\n`;

      try {
        const blocksData = callNotionApi(`/blocks/${page.id}/children?page_size=100`, 'get');
        const childBlocks = blocksData.results || [];
        childBlocks.forEach(b => {
          const type = b.type;
          if (type === 'image' && b.image) {
            const imgUrl = (b.image.external && b.image.external.url)
              ? b.image.external.url
              : (b.image.file && b.image.file.url ? b.image.file.url : '');
            const caption = (b.image.caption && b.image.caption.length > 0)
              ? b.image.caption.map(c => c.plain_text).join('')
              : '思い出の写真';
            if (imgUrl) {
              aggregatedText += `![${caption}](${imgUrl})\n`;
            }
          } else if (type === 'divider') {
            aggregatedText += `---\n`;
          } else if (b[type] && b[type].rich_text) {
            const blockText = b[type].rich_text.map(rt => rt.plain_text).join('');
            if (blockText) {
              if (type === 'heading_1') {
                aggregatedText += `# ${blockText}\n`;
              } else if (type === 'heading_2') {
                aggregatedText += `## ${blockText}\n`;
              } else if (type === 'heading_3') {
                aggregatedText += `### ${blockText}\n`;
              } else if (type === 'bulleted_list_item') {
                aggregatedText += `- ${blockText}\n`;
              } else if (type === 'numbered_list_item') {
                aggregatedText += `1. ${blockText}\n`;
              } else if (type === 'quote') {
                aggregatedText += `> ${blockText}\n`;
              } else {
                aggregatedText += `${blockText}\n`;
              }
            }
          }
        });
      } catch (blockErr) {
        Logger.log(`ブロック取得スキップ: ${blockErr.message}`);
      }
    }
  } catch (e) {
    Logger.log(`前月日報クエリエラー: ${e.message}`);
    aggregatedText = '（日報クエリ中にエラーが発生しました）';
  }

  return aggregatedText;
}

/**
 * 月報カードをNotion月報データベースに作成
 * @param {string} markdownContent 生成されたMarkdown月報
 * @param {string} monthStr YYYY-MM
 * @return {Object} 作成されたページ情報
 */
function createMonthlyReport(markdownContent, monthStr) {
  const config = getConfig();
  const schema = getDatabaseSchemaKeys(config.notionMonthlyDbId);
  const { metadata, markdown } = extractReportMetadata_(markdownContent);
  const blocks = markdownToNotionBlocks(markdown);

  const titleText = `${monthStr} 月間ハイライト＆思い出ジャーナル`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    // 月報の日付は「月末（例: 2026-10-31）」に設定（カレンダー等で月末の締めくくりとして表示）
    const [yearStr, monthNumStr] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthNumStr, 10);
    const lastDay = new Date(year, month, 0).getDate();
    const lastDateStr = `${monthStr}-${('0' + lastDay).slice(-2)}`;
    properties[schema.dateKey] = {
      date: { start: lastDateStr }
    };
  }

  // 月間サマリー (rich_text: カテゴリプレフィックス+改行区切りの複数行サマリー)
  if (schema.summaryKey && metadata.summary) {
    properties[schema.summaryKey] = {
      rich_text: [{ text: { content: String(metadata.summary).trim() } }]
    };
  }

  // 注力領域 (multi_select: グランドデザイン5領域)
  if (schema.areasKey && Array.isArray(metadata.areas) && metadata.areas.length > 0) {
    properties[schema.areasKey] = {
      multi_select: metadata.areas.map(a => ({ name: String(a).trim() }))
    };
  }

  // 月間リズム (select)
  const rhythmValue = metadata.rhythm || metadata.tone;
  if (schema.toneKey && rhythmValue) {
    properties[schema.toneKey] = {
      select: { name: String(rhythmValue).trim() }
    };
  }

  const payload = {
    parent: { database_id: config.notionMonthlyDbId },
    properties: properties,
    children: blocks
  };

  return callNotionApi('/pages', 'post', payload);
}

/**
 * 開発・動作確認用: Notion日報データベースへのテスト投稿
 * GASエディタでこの関数を選択して実行すると、ダミーの日報ページをNotionに即時作成します。
 */
function testDailyReportNotion() {
  const config = getConfig();
  Logger.log('Notion API Key 確認: ' + (config.notionApiKey ? config.notionApiKey.substring(0, 8) + '...' : '未設定'));
  Logger.log('日報DB ID 確認: ' + config.notionDailyDbId);

  const testDateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const dummyMarkdown = `# ${testDateStr} デイリージャーナル（動作テスト）
## 今日のハイライト・総括
- 生活管理秘書システムの初期セットアップが完了しました！
- LINEとの双方向連携およびGemini 3.1 Flash-Lite ＆ 3.8 Flashによる2段階思考エンジンが正常に稼働しています。

## 完了タスク
- [x] LINE Bot チャンネル作成 & Webhook設定
- [x] GASプロジェクト作成 & スクリプトプロパティ設定
- [x] Notion API連携テスト

## 秘書からのひとこと
セットアップ大変お疲れ様でした！明日からの毎日の制作・生活管理をしっかり伴走させていただきます。`;

  try {
    const res = createDailyReport(dummyMarkdown, testDateStr);
    Logger.log('✅ Notion日報DBへの作成に成功しました！');
    Logger.log('作成ページURL: ' + (res.url || 'Notion側で確認してください'));
  } catch (err) {
    Logger.log('❌ Notion日報DBへの作成に失敗しました: ' + err.message);
  }
}

