---
name: mobile-ui-mock
description: 実際のアプリ（docs/index.html）をベースに、認証バイパス・完全ドライラン・トンマナ準拠のスマホ実機確認用UIモックを scratch/mock-app.html に作成し、ローカルサーバーで配信する。UI変更の事前確認やモック作成を依頼されたときに使用する。
---

# Mobile UI Mock Skill (`mobile-ui-mock`)

本リポジトリ（Companion Cockpit v2）において、本番コードを変更せずにスマホ実機でUI・操作感を確認するためのモック作成手順。

## 必須ルール（鉄則）

1. **本番ファイル非破壊**: `web/`・`docs/`・`src/` は一切変更せず、必ず `scratch/mock-app.html` に生成する。
2. **実アプリベース**: ゼロから別HTMLを作らず、必ず `docs/index.html` をベースにコピーし、末尾（`</body>` 直前）にモック用 `<style>` と `<script>` を差し込む。
3. **完全ドライラン＆認証バイパス**:
   - `localStorage.setItem("companion_auth_key", "mock-dry-run")` をセットし、`window.openSettingsModal = function() {};` で認証モーダルを抑止する。
   - `window.callServerApi` をモック化し、サーバー通信なしでダミーレスポンス（`authorized: true`）を即座に返す。
4. **リロードで状態リセット（カード・タスク復活）**:
   - モックでカードを完了させた後、修正してリロードした際に完了済みカードが消えたままにならないよう、`window.saveLocalSnapshot = function() {};` でローカル永続化を無効化する（または起動時に `completedToday` / `dismissedToday` をリセットする）。
5. **トンマナ（デザインシステム）厳守**:
   - 色・角丸・影をインラインで直書きせず、`web/styles.css` の既存クラス（`glass-surface`、`btn-soft`、`btn-solid`、`feeling-chip` 等）と CSS変数（`--dc-text-sub`、`--dc-btn-soft-glass`、`--dc-glass-border`、`--dc-glass-inset` 等）を必ず使用する。
   - トグル要素は単なるテキストリンクにせず、ピル型ガラスボタン＋アイコン（`✎` 等）でタップ可能であることを明示する。
   - 時刻・数値の調整UIなど、確定が必要なパネルには「キャンセル」「適用」ボタンを設け、適用時は `startedAtMs` 等の内部状態も漏れなく同期更新する。

## 実行手順

1. `docs/index.html` を読み込み、上記ルールを満たすモックスクリプトを `</body>` 直前に注入して `scratch/mock-app.html` に書き出す。
2. MacのローカルIPアドレスを取得する（`ipconfig getifaddr en0 || ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1`）。
3. `scratch/` ディレクトリでローカルHTTPサーバーを起動する（`python3 -m http.server 8765 --directory scratch`、バックグラウンド実行）。
4. ユーザーにスマホ実機確認用のURL（`http://<ローカルIP>:8765/mock-app.html`）を案内する。
