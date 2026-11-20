/**
 * GeminiClient.js - Gemini REST API 通信・リトライ・モデル解決・JSONパース共通クライアント
 */

/**
 * Gemini API への共通リクエスト＆自動リトライ関数（503/429対策・思考パート除外・usageMetadata取得・エンドポイント指定対応）
 * @param {Object} requestPayload
 * @param {string=} customEndpointBase オプション: Lite等の別モデルエンドポイントベースURL
 * @return {{text: string, usage: Object|null, groundingQueries: Array<string>, groundingChunksCount: number, groundingMetaKeys: Array<string>, groundingSources: Array<{title: string, uri: string}>, finishReason: string, candidateKeys: Array<string>, partKeys: Array<string>}} 抽出されたテキスト・使用量・グラウンディング情報
 */
function fetchGeminiResultWithRetry(requestPayload, customEndpointBase) {
  const config = getConfig();
  let endpointBase = customEndpointBase || SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE;
  let url = `${endpointBase}?key=${config.geminiApiKey}`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestPayload),
    muteHttpExceptions: true
  };

  let response;
  let statusCode = 0;
  let responseText = '';
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
      statusCode = response.getResponseCode();
      responseText = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        break;
      }

      // もしカスタムエンドポイント（Lite等）が404だった場合、標準Flashエンドポイントへ自動フォールバック
      if (statusCode === 404 && endpointBase !== SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE) {
        Logger.log(`[Gemini API フォールバック] 指定モデルが404のため標準モデルへフォールバックします`);
        endpointBase = SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE;
        url = `${endpointBase}?key=${config.geminiApiKey}`;
        continue;
      }

      if ((statusCode === 503 || statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
        const delayMs = (attempt + 1) * 1200;
        Logger.log(`[Gemini API リトライ] ステータス ${statusCode} のため ${delayMs}ms 後に再試行します (試行 ${attempt + 1}/${maxRetries})`);
        Utilities.sleep(delayMs);
        continue;
      }

      throw new Error(`Gemini APIエラー [${statusCode}]: ${responseText}`);
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delayMs = (attempt + 1) * 1200;
      Logger.log(`[Gemini API ネットワークエラー] ${err.message} のため ${delayMs}ms 後に再試行します`);
      Utilities.sleep(delayMs);
    }
  }

  return extractGeminiCandidateResult_(responseText);
}

/**
 * Gemini API レスポンス文字列からテキスト・usageMetadata・グラウンディング情報を抽出する共通ヘルパー
 * @param {string} responseText
 * @return {{text: string, usage: Object|null, groundingQueries: Array<string>, groundingChunksCount: number, groundingMetaKeys: Array<string>, groundingSources: Array<{title: string, uri: string}>, finishReason: string, candidateKeys: Array<string>, partKeys: Array<string>}}
 * @private
 */
function extractGeminiCandidateResult_(responseText) {
  const jsonResponse = JSON.parse(responseText);

  if (jsonResponse.usageMetadata) {
    const u = jsonResponse.usageMetadata;
    const cached = u.cachedContentTokenCount || 0;
    const toolUseTok = u.toolUsePromptTokenCount || 0;
    const toolLog = toolUseTok > 0 ? `, ToolUse: ${toolUseTok}` : '';
    Logger.log(`[Gemini Token Usage] Prompt: ${u.promptTokenCount}, Candidates: ${u.candidatesTokenCount}, Cached: ${cached}${toolLog}, Total: ${u.totalTokenCount}`);
  }

  let contentText = '';
  let groundingQueries = [];
  let groundingChunksCount = 0;
  let groundingMetaKeys = [];
  const groundingSources = [];
  let finishReason = '';
  let candidateKeys = [];
  const partKeysSet = {};
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0) {
    const cand = jsonResponse.candidates[0];
    candidateKeys = Object.keys(cand);
    finishReason = cand.finishReason || '';
    if (cand.content && cand.content.parts) {
      const parts = cand.content.parts;
      for (let i = 0; i < parts.length; i++) {
        Object.keys(parts[i] || {}).forEach(k => { partKeysSet[k] = true; });
        if (parts[i].text && !parts[i].thought) {
          contentText += parts[i].text;
        }
      }
    }
    if (cand.groundingMetadata) {
      groundingMetaKeys = Object.keys(cand.groundingMetadata);
      if (Array.isArray(cand.groundingMetadata.webSearchQueries)) {
        groundingQueries = cand.groundingMetadata.webSearchQueries.map(q => String(q || '').trim()).filter(Boolean);
      }
      if (Array.isArray(cand.groundingMetadata.groundingChunks)) {
        groundingChunksCount = cand.groundingMetadata.groundingChunks.length;
        const seenUris = {};
        for (let j = 0; j < cand.groundingMetadata.groundingChunks.length; j++) {
          const web = cand.groundingMetadata.groundingChunks[j] && cand.groundingMetadata.groundingChunks[j].web;
          if (!web || !web.uri) continue;
          const uri = String(web.uri).trim();
          if (!uri || seenUris[uri]) continue;
          seenUris[uri] = true;
          groundingSources.push({
            title: String(web.title || '').trim(),
            uri: uri
          });
          if (groundingSources.length >= 5) break;
        }
      }
    }
  }

  if (!contentText) {
    throw new Error('Gemini APIからテキスト返答が得られませんでした。');
  }

  return {
    text: contentText.trim(),
    usage: jsonResponse.usageMetadata || null,
    groundingQueries: groundingQueries,
    groundingChunksCount: groundingChunksCount,
    groundingMetaKeys: groundingMetaKeys,
    groundingSources: groundingSources,
    finishReason: finishReason,
    candidateKeys: candidateKeys,
    partKeys: Object.keys(partKeysSet)
  };
}

/**
 * Gemini usageMetadata からトークン内訳を一貫抽出するヘルパー
 * @param {Object=} usage
 * @return {{prompt: number, cand: number, cached: number, toolUse: number, thinking: number, total: number}}
 * @private
 */
function extractTokenStats_(usage) {
  const u = usage || {};
  const prompt = u.promptTokenCount || 0;
  const cand = u.candidatesTokenCount || 0;
  const cached = u.cachedContentTokenCount || 0;
  const toolUse = u.toolUsePromptTokenCount || 0;
  const total = u.totalTokenCount || (prompt + cand);
  const thinking = (typeof u.thoughtsTokenCount === 'number')
    ? u.thoughtsTokenCount
    : Math.max(0, total - prompt - cand - toolUse);
  return {
    prompt: prompt,
    cand: cand,
    cached: cached,
    toolUse: toolUse,
    thinking: thinking,
    total: total
  };
}

/**
 * JSON文字列を安全にパースしてアクションオブジェクトへ変換するヘルパー
 * - 思考メモやプロンプト要件が前置されている場合でも、末尾の完全なJSONオブジェクトを正確に抽出
 * - パース失敗時のサニタイズ（思考メモ・生プロンプト指示の漏洩遮断）
 * @param {string} rawText
 * @param {Object|null} usage
 * @return {Object}
/**
 * シングルクォート文字列リテラルや文字列内の生改行を含む準JSONテキストを標準JSONへ正規化する
 * @param {string} raw
 * @return {string}
 * @private
 */
function normalizeRelaxedJsonStrings_(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let out = '';
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inDouble) {
      if (ch === '\\' && i + 1 < raw.length) {
        const next = raw[i + 1];
        out += (next === "'") ? "'" : ('\\' + next);
        i++;
      } else if (ch === '"') {
        inDouble = false;
        out += '"';
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch !== '\r') {
        out += ch;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\' && i + 1 < raw.length) {
        const next = raw[i + 1];
        out += (next === "'") ? "'" : ('\\' + next);
        i++;
      } else if (ch === "'") {
        inSingle = false;
        out += '"';
      } else if (ch === '"') {
        out += '\\"';
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch !== '\r') {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += '"';
    } else if (ch === "'") {
      inSingle = true;
      out += '"';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * JSON文字列を通常パース・準JSON正規化の両面から安全にパースする
 * @param {string} candidate
 * @param {Object=} usage
 * @return {Object|null}
 * @private
 */
function tryParseActionObject_(candidate, usage) {
  if (!candidate) return null;
  const attempts = [candidate, normalizeRelaxedJsonStrings_(candidate)];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const parsed = JSON.parse(attempts[i]);
      if (parsed && typeof parsed === 'object') {
        parsed._usage = usage;
        return parsed;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * 行動・DB操作をJSON構造化出力で受け取るヘルパー
 * @param {string} rawText
 * @param {Object=} usage
 * @return {Object}
 * @private
 */
function parseGeminiActionJson_(rawText, usage) {
  let cleaned = String(rawText || '').trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  // 1. 直接パース試行（シングルクォート文字列等の準JSON正規化リトライ含む）
  const directParsed = tryParseActionObject_(cleaned, usage);
  if (directParsed) {
    return directParsed;
  }

  // 2. 救済抽出: 末尾の '}' から逆順にバランスする開始 '{' を探索して完全なJSONオブジェクトを抽出
  // （思考メモやフォーマット要件の復唱テキストが前置されていても安全に救済）
  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace !== -1) {
    let depth = 0;
    let targetStart = -1;
    for (let i = lastBrace; i >= 0; i--) {
      if (cleaned[i] === '}') depth++;
      else if (cleaned[i] === '{') {
        depth--;
        if (depth === 0) {
          targetStart = i;
          break;
        }
      }
    }
    if (targetStart !== -1) {
      const candidate = cleaned.substring(targetStart, lastBrace + 1);
      const subParsed = tryParseActionObject_(candidate, usage);
      if (subParsed) {
        return subParsed;
      }
    }
  }

  Logger.log('JSONパース失敗 (サニタイズ適用): ' + cleaned);

  // 3. 安全サニタイズフォールバック（思考メモ・プロンプト指示・生JSON構文をユーザーに見せない）
  let safeReply = cleaned
    .replace(/^[\s\S]*?(フォーマット要件|返信内容[：:]|純粋なJSON出力)[\s\S]*?(?=\n\n|$)/g, '')
    .replace(/\{[\s\S]*\}/g, '')
    .replace(/^(\s*[-・*]\s*)+/gm, '')
    .trim();

  if (!safeReply) {
    safeReply = '承知いたしました。';
  }

  return {
    reply_text: safeReply,
    task_actions: [],
    calendar_actions: [],
    shopping_actions: [],
    input_stock_actions: [],
    routine_actions: [],
    project_actions: [],
    _usage: usage
  };
}

/**
 * テキストのみを取得するレガシー互換ラッパー
 * @param {Object} requestPayload
 * @return {string}
 */
function fetchGeminiTextWithRetry(requestPayload) {
  return fetchGeminiResultWithRetry(requestPayload).text;
}


/**
 * memoryシートの backend_model 設定（またはテストフラグ）から後段生成モデル＆エンドポイントを解決
 * @param {Object=} memory
 * @return {{model: string, shortLabel: string, endpoint: string}}
 */
function resolveBackendModel_(memory) {
  if (memory && memory._testUseLiteForBackend === true) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_LITE_MODEL,
      shortLabel: 'lite',
      endpoint: SYSTEM_CONSTANTS.GEMINI_LITE_ENDPOINT_BASE
    };
  }
  if (memory && memory._testUseLiteForBackend === false) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_MODEL,
      shortLabel: 'flash',
      endpoint: SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE
    };
  }

  const raw = String((memory && memory.backend_model) || '').trim();
  const normalized = raw.toLowerCase();

  if (normalized === 'lite' || normalized === 'flash-lite' || normalized === SYSTEM_CONSTANTS.GEMINI_LITE_MODEL.toLowerCase()) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_LITE_MODEL,
      shortLabel: 'lite',
      endpoint: SYSTEM_CONSTANTS.GEMINI_LITE_ENDPOINT_BASE
    };
  }
  if (!normalized || normalized === '3.5-lite' || normalized === 'flash-lite-3.5' || normalized === SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL.toLowerCase()) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL,
      shortLabel: '3.5-lite',
      endpoint: SYSTEM_CONSTANTS.GEMINI_35_LITE_ENDPOINT_BASE
    };
  }
  if (normalized === 'hydrogen' || normalized === '4-hydrogen' || normalized === SYSTEM_CONSTANTS.GEMINI_HYDROGEN_MODEL.toLowerCase()) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_HYDROGEN_MODEL,
      shortLabel: 'hydrogen',
      endpoint: SYSTEM_CONSTANTS.GEMINI_HYDROGEN_ENDPOINT_BASE
    };
  }
  if (normalized === 'flash' || normalized === SYSTEM_CONSTANTS.GEMINI_MODEL.toLowerCase()) {
    return {
      model: SYSTEM_CONSTANTS.GEMINI_MODEL,
      shortLabel: 'flash',
      endpoint: SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE
    };
  }
  if (normalized.indexOf('gemini-') === 0) {
    return {
      model: raw,
      shortLabel: raw,
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${raw}:generateContent`
    };
  }

  return {
    model: SYSTEM_CONSTANTS.GEMINI_35_LITE_MODEL,
    shortLabel: '3.5-lite',
    endpoint: SYSTEM_CONSTANTS.GEMINI_35_LITE_ENDPOINT_BASE
  };
}

/**
 * モデルと memory.thinking_level 設定から Gemini generationConfig.thinkingConfig を解決
 * - Gemini 3.5-lite / 3.6-flash 等: minimal / low / medium / high
 * - Gemini 3.8-flash / Gemini 4 Hydrogen 等（minimal非対応モデル）: minimal指定時は安全に low へフォールバック（Hydrogenは xhigh も可）
 * - レガシー Gemini 2.5系: thinkingBudget: 0
 * @param {string} modelName
 * @param {Object=} memory
 * @return {Object}
 */
function resolveThinkingConfig_(modelName, memory) {
  const m = String(modelName || '').toLowerCase();
  if (m.indexOf('gemini-2.5') === 0) {
    return { thinkingBudget: 0 };
  }
  const supportsMinimal = (
    m.indexOf('flash-lite') !== -1 ||
    m.indexOf('gemini-3.6-flash') !== -1 ||
    m.indexOf('gemini-3-flash') !== -1
  );
  const supportsXhigh = (m.indexOf('hydrogen') !== -1);
  const allowed = supportsXhigh
    ? ['low', 'medium', 'high', 'xhigh']
    : (supportsMinimal ? ['minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high']);
  const defaultLevel = supportsMinimal ? 'minimal' : 'low';
  const rawLevel = String((memory && (memory._testThinkingLevel || memory.thinking_level)) || defaultLevel).trim().toLowerCase();
  if (allowed.indexOf(rawLevel) !== -1) {
    return { thinkingLevel: rawLevel };
  }
  return { thinkingLevel: (rawLevel === 'minimal' && !supportsMinimal) ? 'low' : defaultLevel };
}

/**
 * 開発・デバッグ用: Gemini APIの接続テスト（Lite & Flash 疎通確認）
 * GASエディタでこの関数を選択して実行すると、APIキーやエンドポイントの疎通確認が可能です。
 */
function testGeminiConnection() {
  const config = getConfig();
  Logger.log('Gemini API Key 確認: ' + (config.geminiApiKey ? config.geminiApiKey.substring(0, 6) + '...' : '未設定'));

  const testPayload = {
    contents: [{ role: 'user', parts: [{ text: 'こんにちは！テストです。' }] }]
  };

  try {
    const liteRes = fetchGeminiResultWithRetry(testPayload, SYSTEM_CONSTANTS.GEMINI_35_LITE_ENDPOINT_BASE);
    Logger.log('✅ Gemini 3.5 Flash-Lite API 呼び出し成功: ' + liteRes.text);
  } catch (e) {
    Logger.log('❌ Gemini 3.5 Flash-Lite API 呼び出し失敗: ' + e.message);
  }

  try {
    const flashRes = fetchGeminiResultWithRetry(testPayload, SYSTEM_CONSTANTS.GEMINI_ENDPOINT_BASE);
    Logger.log('✅ Gemini Flash API 呼び出し成功: ' + flashRes.text);
  } catch (e) {
    Logger.log('❌ Gemini Flash API 呼び出し失敗: ' + e.message);
  }
}
