#!/usr/bin/env bash
set -euo pipefail

node -e '
const fs = require("fs");
const { execSync } = require("child_process");

let payload = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim()) payload = JSON.parse(raw);
} catch {
  console.log("{}");
  process.exit(0);
}

// 無限ループ防止: すでに Stop フックで継続中、または 2回目以降の実行なら通過
if (payload.continuationActive === true || Number(payload.executionNum || 0) > 1) {
  console.log("{}");
  process.exit(0);
}

// この会話(transcriptPath)内で src/ または web/ を編集したツール呼び出しがあるか Path のみで厳密に確認
const tp = payload.transcriptPath;
if (!tp || !fs.existsSync(tp)) {
  console.log("{}");
  process.exit(0);
}

let editedCodeInThisChat = false;
try {
  const lines = fs.readFileSync(tp, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const step = JSON.parse(line);
      const calls = step.tool_calls || [];
      for (const tc of calls) {
        const name = tc.name || (tc.function && tc.function.name) || "";
        if (name === "edit_file" || name === "write_file") {
          const args = tc.args || tc.arguments || {};
          const targetPath = String(args.Path || args.path || "").replace(/\\/g, "/");
          if (/(^|\/)(src|web)\//.test(targetPath)) {
            editedCodeInThisChat = true;
            break;
          }
        }
      }
      if (editedCodeInThisChat) break;
    } catch {}
  }
} catch {}

if (!editedCodeInThisChat) {
  console.log("{}");
  process.exit(0);
}

// git status --porcelain で src/ または web/ の変更と README.md / SPEC.md の更新状況を確認
let status = "";
try {
  status = execSync("git status --porcelain", { encoding: "utf8" });
} catch {
  console.log("{}");
  process.exit(0);
}

let hasCode = false;
let hasReadme = false;
let hasSpec = false;

for (const line of status.split("\n")) {
  if (!line.trim()) continue;
  let filePath = line.slice(3).trim();
  if (filePath.includes(" -> ")) filePath = filePath.split(" -> ").pop().trim();
  filePath = filePath.replace(/^"|"$/g, "");
  if (filePath.startsWith("src/") || filePath.startsWith("web/")) hasCode = true;
  if (filePath === "README.md") hasReadme = true;
  if (filePath === "SPEC.md") hasSpec = true;
}

if (hasCode) {
  const missing = [];
  if (!hasReadme) missing.push("README.md");
  if (!hasSpec) missing.push("SPEC.md");
  if (missing.length > 0) {
    console.log(JSON.stringify({
      decision: "continue",
      reason: `⚠️ [doc-sync] src/ または web/ に変更がありますが、以下のドキュメントが未更新です: ${missing.join(" ")}。完了前に README.md と SPEC.md の両方を照合・更新してください。`
    }));
    process.exit(0);
  }
}

console.log("{}");
'
