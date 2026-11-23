#!/usr/bin/env node
/**
 * PostToolUse Hook: clasp push 実行後に本番デプロイ（clasp deploy）のリマインダーを注入する
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const toolName = data.tool_name || '';
    const args = data.tool_input || {};
    const cmd = args.CommandLine || '';

    if (toolName === 'run_command' && /\bclasp\s+push\b/.test(cmd) && !/\bclasp\s+deploy\b/.test(cmd)) {
      console.log(
        '[デプロイ確認] `clasp push` を実行しました。Webアプリ（/exec）の挙動を変更した場合は、続けて `npx clasp deploy -i AKfycbxk5S1ISzlMGNHmV09GhptgalE9LQ1scNXclXzIEkRSlw1e5eiXsI4VgK-LsDV-jCiGxg` で本番デプロイも更新してください（Batchトリガーのみ・/dev検証のみの場合は不要）。'
      );
    }
  } catch (_) {
    // パースエラー時は何もしない
  }
  process.exit(0);
});
