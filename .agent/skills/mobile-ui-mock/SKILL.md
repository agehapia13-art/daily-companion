---
name: mobile-ui-mock
description: 実際のアプリ（docs/index.html）をベースに、認証バイパス・完全ドライラン・トンマナ準拠のスマホ実機確認用UIモックを scratch/mock-app.html に作成し、ローカルサーバーで配信する。UI変更の事前確認やモック作成を依頼されたときに使用する。
---

# Mobile UI Mock Skill (`mobile-ui-mock`)

本リポジトリ（Companion Cockpit v2）において、本番コードを変更せずにスマホ実機でUI・操作感を確認するためのモック作成手順。

## 必須ルール（鉄則）

1. **本番ファイル非破壊**: `web/`・`docs/`・`src/` は一切変更せず、必ず `scratch/mock-app.html` に生成する。
2. **実アプリベース**: ゼロから別HTMLを作らず、必ず `docs/index.html` をベースにコピーし、必要なフックと末尾（`</body>` 直前）のモック用 `<style>`・`<script>` を差し込む。
3. **内部スコープへのフック注入（最重要）**:
   - `docs/index.html` の `state`・`renderHome`・`callServerApi` は内部スコープに閉じており、外部 `<script>` から `window.*` を上書き・参照しても効かない。
   - 生成時に `docs/index.html` のコピー側へ直接以下のフックを差し込むこと：
     - `function renderHome() {` の直前に `window.__mockState = state; window.__mockRenderHome = renderHome;`
     - `function callServerApi(funcName) {` の先頭に `if (window.__mockCallServerApi) return window.__mockCallServerApi.apply(this, arguments);`
4. **正確な `state` / APIレスポンス構造の参照**:
   - アクティブタイマーは `state.fastState.activeSession`（`state.session` ではない）。
   - デッキカード一覧は `state.composedDeck.cards` / `state.composedDeck.lowCards`（`state.deck` ではない）。
   - 完了・非表示は `state.fastState.completedToday` / `state.fastState.dismissedToday`。
   - `window.__mockCallServerApi` のダミーレスポンスも `{ ok: true, authorized: true, composedDeck: { cards: [...], lowCards: [...] }, fastState: { completedToday: {}, dismissedToday: {}, activeSession: null, isLowMode: false }, ... }` の形式で返すこと。
5. **完全ドライラン＆認証バイパス**:
   - `localStorage.setItem("companion_auth_key", "mock-dry-run")` をセットし、`window.openSettingsModal = function() {};` で認証モーダルを抑止する。
   - `window.saveLocalSnapshot = function() {};` でローカル永続化を無効化する（または起動時に `completedToday` / `dismissedToday` をリセットする）。
6. **トンマナ（デザインシステム）厳守**:
   - 色・角丸・影をインラインで直書きせず、`web/styles.css` の既存クラス（`glass-surface`、`btn-soft`、`btn-solid`、`feeling-chip` 等）と CSS変数（`--dc-text-sub`、`--dc-btn-soft-glass`、`--dc-glass-border`、`--dc-glass-inset` 等）を必ず使用する。
   - 既存のボタングループ（`.focus-actions` 等）へボタンを追加する場合は、そのエリアで使われている既存クラス（`.btn-pause-soft` 等）にサイズ・余白を揃える。
   - トグル要素は単なるテキストリンクにせず、ピル型ガラスボタン＋アイコン（`✎` 等）でタップ可能であることを明示する。
   - 時刻・数値の調整UIなど、確定が必要なパネルには「キャンセル」「適用」ボタンを設け、適用時は `startedAtMs` 等の内部状態も漏れなく同期更新する。

## 実行手順

1. `scratch/gen-mock.js` に生成スクリプトを書き出し、`node scratch/gen-mock.js` で `docs/index.html` から `scratch/mock-app.html` を生成する（シェルワンライナーでのクォート崩れやサンドボックスの `python3` 制限を回避するため）。
2. MacのローカルIPアドレスを取得する（`ipconfig getifaddr en0 || ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1`）。
3. `scratch/` ディレクトリでローカルHTTPサーバーを起動する（`python3 -m http.server 8765 --directory scratch`、バックグラウンド実行）。
4. ユーザーにスマホ実機確認用のURL（`http://<ローカルIP>:8765/mock-app.html`）を案内する。
