#!/usr/bin/env node
/**
 * hook-pre-invocation.js - Antigravity PreInvocation フック
 * 会話が長くなっても原則が薄れないよう、一定間隔で短いリマインダーを注入する。
 */

const fs = require('fs');

function main() {
  let payload = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    process.stdout.write('{}\n');
    return;
  }

  const invocationNum = Number(payload.invocationNum || 1);

  if (invocationNum % 4 === 1) {
    process.stdout.write(
      JSON.stringify({
        injectSteps: [
          {
            systemMessage: {
              systemMessage:
                '[原則リマインダー] 1) Plan→Approval→Implementation厳守 2) 対症療法禁止（Root-Cause First + 横展開テスト） 3) GRAND_DESIGN.md・prompt-architecture.md 準拠',
            },
          },
        ],
      }) + '\n'
    );
    return;
  }

  process.stdout.write('{}\n');
}

main();
