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
 * データベースのプロパティ定義から title型 および date型 のプロパティ名を動的特定
 * @param {string} databaseId
 * @return {Object} { titleKey: string, dateKey: string|null }
 */
function getDatabaseSchemaKeys(databaseId) {
  try {
    const dbInfo = callNotionApi(`/databases/${databaseId}`, 'get');
    let titleKey = 'Name';
    let dateKey = null;

    if (dbInfo && dbInfo.properties) {
      const propKeys = Object.keys(dbInfo.properties);
      for (let i = 0; i < propKeys.length; i++) {
        const k = propKeys[i];
        const prop = dbInfo.properties[k];
        if (prop.type === 'title') {
          titleKey = k;
        } else if (prop.type === 'date' && !dateKey) {
          dateKey = k;
        }
      }
    }
    return { titleKey, dateKey };
  } catch (e) {
    Logger.log(`DBスキーマ取得失敗 (${databaseId}): ${e.message}。デフォルトキーを使用します。`);
    return { titleKey: 'Name', dateKey: 'Date' };
  }
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
    const safeContent = line.length > 1900 ? line.substring(0, 1900) + '...' : line;

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
  const blocks = markdownToNotionBlocks(markdownContent);

  const titleText = `${dateStr} 日報・生活記録`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    properties[schema.dateKey] = {
      date: { start: dateStr }
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
        const blocksData = callNotionApi(`/blocks/${page.id}/children?page_size=50`, 'get');
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
          } else if (b[type] && b[type].rich_text) {
            const blockText = b[type].rich_text.map(rt => rt.plain_text).join('');
            if (blockText) {
              aggregatedText += `${blockText}\n`;
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
  const blocks = markdownToNotionBlocks(markdownContent);

  const titleText = `${monthStr} 月間ハイライト＆思い出ジャーナル`;
  const properties = {};

  properties[schema.titleKey] = {
    title: [{ text: { content: titleText } }]
  };

  if (schema.dateKey) {
    properties[schema.dateKey] = {
      date: { start: `${monthStr}-01` }
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
- LINEとの双方向連携およびGemini 3.8 Flashによる思考エンジンが正常に稼働しています。

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

