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

    if (toolName === 'run_command' && /\bworkers\b/.test(cmd) && /\btypecheck\b/.test(cmd) && !/\bdeploy\b/.test(cmd)) {
      console.log(
        '[Workersデプロイ確認] `workers/` の型チェックを実行しました。Workers 側のコードを変更した場合は、完了前に `cd workers && npm run deploy` で本番反映も行ってください。'
      );
    }
  } catch (_) {
    // パースエラー時は何もしない
  }
  process.exit(0);
});
