#!/usr/bin/env node
/**
 * verify-release.js - コミット前（pre-commit）検証スクリプト
 * 1. web/ 変更時の CACHE_NAME インクリメント & ビルド成果物（docs/, src/DashboardHtml.html）の同梱チェック
 * 2. src/ または web/ 変更時の SPEC.md / README.md 更新チェック（SKIP_DOC_CHECK=1 でスキップ可）
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getStagedFiles() {
  const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  const staged = getStagedFiles();
  if (staged.length === 0) return;

  const hasWebChange = staged.some((f) => f.startsWith('web/'));
  const hasSrcChange = staged.some((f) => f.startsWith('src/') && f !== 'src/DashboardHtml.html');
  const hasDocChange = staged.some((f) => f === 'SPEC.md' || f === 'README.md');

  const errors = [];

  if (hasWebChange) {
    const hasBuildHtml = staged.includes('src/DashboardHtml.html');
    const hasDocsAsset = staged.some((f) => f.startsWith('docs/'));
    if (!hasBuildHtml || !hasDocsAsset) {
      errors.push(
        '❌ web/ 配下に変更がありますが、ビルド成果物（src/DashboardHtml.html および docs/）がステージングされていません。\n' +
        '   → scripts/build-dashboard.js の CACHE_NAME をインクリメントし、`node scripts/build-dashboard.js` を実行してください。'
      );
    }

    // CACHE_NAME が HEAD から変更されているか確認
    try {
      const headBuildJs = execSync('git show HEAD:scripts/build-dashboard.js', { encoding: 'utf8' });
      const currBuildJs = fs.readFileSync(path.join(process.cwd(), 'scripts/build-dashboard.js'), 'utf8');
      const headMatch = headBuildJs.match(/CACHE_NAME\s*=\s*'([^']+)'/);
      const currMatch = currBuildJs.match(/CACHE_NAME\s*=\s*'([^']+)'/);
      if (headMatch && currMatch && headMatch[1] === currMatch[1]) {
        errors.push(
          `❌ web/ 配下に変更がありますが、scripts/build-dashboard.js の CACHE_NAME（現在: ${currMatch[1]}）が更新されていません。`
        );
      }
    } catch (e) {
      // 初回コミット等で HEAD がない場合はスキップ
    }
  }

  if ((hasWebChange || hasSrcChange) && !hasDocChange && process.env.SKIP_DOC_CHECK !== '1') {
    errors.push(
      '❌ src/ または web/ に変更がありますが、SPEC.md / README.md が更新されていません。\n' +
      '   → 仕様・実装の変更に合わせてドキュメントを更新してください（純粋なリファクタ等で不要な場合は SKIP_DOC_CHECK=1 でスキップ可能）。'
    );
  }

  if (errors.length > 0) {
    console.error('\n[verify-release] コミット前チェックに失敗しました:\n');
    console.error(errors.join('\n\n'));
    console.error('');
    process.exit(1);
  }
}

main();
