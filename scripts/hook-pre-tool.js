#!/usr/bin/env node
/**
 * hook-pre-tool.js - Antigravity PreToolUse フック
 * 1. .gitignore 対象の機密ファイル読み込み・編集・コマンド参照をブロック（node_modules, .DS_Store は除外）
 * 2. git commit / clasp push 実行前に scripts/verify-release.js を強制実行
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function isIgnoredSecret(targetPath, cwd) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const normalized = targetPath.replace(/\\/g, '/');
  const base = path.basename(normalized);
  if (
    base === '.DS_Store' ||
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/')
  ) {
    return false;
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;

  const lines = fs
    .readFileSync(gitignorePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));

  for (const rawPattern of lines) {
    const pattern = rawPattern.replace(/\/+$/, '');
    if (!pattern || pattern === 'node_modules' || pattern === '.DS_Store') continue;
    const regex = globToRegex(pattern);
    if (regex.test(base) || regex.test(normalized)) {
      return true;
    }
  }
  return false;
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }) + '\n');
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  process.exit(0);
}

function main() {
  let payload = {};
  try {
    const raw = readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    allow();
  }

  const cwd = payload.cwd || process.cwd();
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  // 1. ファイル操作系ツールの機密保護
  if (['read_file', 'edit_file', 'write_file'].includes(toolName)) {
    const targetPath = args.Path || args.path || '';
    if (isIgnoredSecret(targetPath, cwd)) {
      deny(
        `[hook-pre-tool] .gitignore 対象の機密ファイル (${targetPath}) へのアクセスは AGENTS.md 第9条により禁止されています。`
      );
    }
    allow();
  }

  // 2. run_command の機密保護 & リリース検証ゲート
  if (toolName === 'run_command') {
    const cmd = args.CommandLine || '';

    // コマンド内のトークンに対して .gitignore 対象ファイル参照をチェック
    const tokens = cmd.split(/[\s;|&><"'`()]+/).filter(Boolean);
    for (const token of tokens) {
      if (token.startsWith('-')) continue;
      if (isIgnoredSecret(token, cwd)) {
        deny(
          `[hook-pre-tool] コマンド内で .gitignore 対象の機密ファイル (${token}) を参照することは AGENTS.md 第9条により禁止されています。`
        );
      }
    }

    // git commit / clasp push 前のリリース検証
    if (/\bgit\s+commit\b/.test(cmd) || /\bclasp\s+push\b/.test(cmd)) {
      const verifyScript = path.join(cwd, 'scripts', 'verify-release.js');
      if (fs.existsSync(verifyScript)) {
        try {
          execSync(`node "${verifyScript}"`, { cwd, encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
          const detail = (err.stderr || err.stdout || err.message || '').trim();
          deny(
            `[hook-pre-tool] コミット/プッシュ前検証 (verify-release.js) に失敗しました:\n${detail}`
          );
        }
      }
    }

    allow();
  }

  allow();
}

main();
