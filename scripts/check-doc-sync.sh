#!/usr/bin/env bash
set -euo pipefail

# git status --porcelain で src/ または web/ の変更と README.md / SPEC.md の更新状況を確認する
STATUS=$(git status --porcelain 2>/dev/null || true)

if [ -z "$STATUS" ]; then
  exit 0
fi

HAS_CODE_CHANGE=0
HAS_README_UPDATE=0
HAS_SPEC_UPDATE=0

while IFS= read -r line; do
  # git status --porcelain の先頭3文字（ステータス2文字 + スペース1文字）を除いたパスを取得
  file_path="${line:3}"
  # リネーム時は "old -> new" 形式になるため、矢印以降を優先して取得
  if [[ "$file_path" == *" -> "* ]]; then
    file_path="${file_path##* -> }"
  fi
  # 引用符が付いている場合は除去
  file_path="${file_path%\"}"
  file_path="${file_path#\"}"

  if [[ "$file_path" == src/* || "$file_path" == web/* ]]; then
    HAS_CODE_CHANGE=1
  fi
  if [[ "$file_path" == "README.md" ]]; then
    HAS_README_UPDATE=1
  fi
  if [[ "$file_path" == "SPEC.md" ]]; then
    HAS_SPEC_UPDATE=1
  fi
done <<< "$STATUS"

if [ "$HAS_CODE_CHANGE" -eq 1 ]; then
  MISSING=()
  if [ "$HAS_README_UPDATE" -eq 0 ]; then
    MISSING+=("README.md")
  fi
  if [ "$HAS_SPEC_UPDATE" -eq 0 ]; then
    MISSING+=("SPEC.md")
  fi

  if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "⚠️ [doc-sync] src/ または web/ に変更がありますが、以下のドキュメントの更新が検出されていません: ${MISSING[*]}"
    echo "完了前に README.md と SPEC.md の両方を照合し、必要に応じて更新してください。"
  fi
fi

exit 0
