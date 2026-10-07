# 議事録アプリ（minutes）実装仕様

元仕様：`SPEC_議事録アプリ.md`（v0.1）。本書はその実装方針とモジュール契約。構成は taskapp（`../3.タスク管理`）を踏襲する。

## 1. 決定事項

- 配置：`C:\dev\ClaudeCode\5.議事録`（git リポジトリ、将来 `logiaxis-yanagida/minutes` → `https://logiaxis-yanagida.github.io/minutes/`）
- アイコン：背景 `#0f766e`（ティール）の角丸正方形＋白い書類（横線3本）
- taskapp 連携：端末内 inbox（localStorage）＋ Drive appDataFolder の受け渡しファイル（1タスク1ファイル）の二重書き。taskapp が取り込み、Drive ファイルは取り込み後に削除
- taskapp 側にタスクの任意フィールド `memo` を新設し、元会議名・担当を記録

## 2. 規約（taskapp と同一）

- ビルドなし。ES モジュールを `index.html` から `<script type="module">` で読む
- セマンティック HTML、インラインスタイル禁止、`console.log` 禁止（`console.error` は可）、UI 文言は日本語、絵文字なし、不要なコメントなし
- テスト：`node --test`（`node:test` ＋ `node:assert/strict`、依存なし）
- ローカル起動：`起動.bat` → `python -m http.server 8788 --bind 127.0.0.1`、`http://localhost:8788/`

## 3. ファイル構成

```
index.html  manifest.webmanifest  sw.js  起動.bat  README.md  SPEC.md  .gitignore
css/style.css
icons/icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png
scripts/make_icons.py
js/config.js        DEFAULT_GCAL_CLIENT_ID（taskapp と同値）, DEFAULT_GCAL_CALENDAR_ID='primary'
js/pwa.js           SW 登録（taskapp と同一）
js/util.js          共通ユーティリティ
js/store.js         端末内保存・マージ
js/minutes.js       議事録化テキスト生成（純関数）
js/voice.js         音声入力コントローラ
js/google.js        OAuth（GIS ポップアップ＋リダイレクト）と authorizedFetch
js/calendar.js      Google カレンダー読込
js/drive.js         Drive appDataFolder 入出力
js/sync.js          Drive 同期オーケストレーション
js/taskbridge.js    taskapp への送信
js/app.js           画面・イベント（エントリポイント）
tests/*.test.mjs
```

## 4. データモデル

localStorage キー `minutes.v1`：

```
State { version: 1, meetings: Meeting[], settings: Settings, deleted: { [id]: ISO } }

Meeting {
  id, title, start: ISO|null, end: ISO|null, location: string,
  attendees: string[], description: string,          // description はカレンダー説明文（参考表示）
  calendarEventId: string|null,
  preChecks: [{ id, text, checked: bool, note }],   // 画面・議事録化から外した（データ互換のため保持）
  agenda: [{ id, title, detail, memo }],             // detail＝アジェンダタブで入力する詳細
  freeMemo: string,
  decisions: [{ id, text }],
  tasks: [{ id, title, assignee, due: 'YYYY-MM-DD'|null, done: bool,
            sentToTaskapp: bool, taskappId: string|null }],
  minutes: string,
  status: '準備中' | '実施済' | '議事録完了',
  createdAt: ISO, updatedAt: ISO
}

Settings {
  template: { preChecks: string[], agenda: string[] },
  summaryRule: string,
  oauthClientId: string, calendarId: string,
  taskappIntegration: { enabled: bool, defaultCategoryId: string|null }
}
```

- id は `crypto.randomUUID()`（フォールバックあり）
- マージ単位は Meeting（`updatedAt` 新しい方が勝ち、同値は local）。削除はトゥームストーン `deleted[id]`（90日で破棄）。アルゴリズムは taskapp `store.js` の `mergeCollection` / `mergeDeletedMaps` / `isTombstoned` と同一
- 設定のうち `template` と `summaryRule` は同期対象（`settingsUpdatedAt` で新しい方を採用）。`oauthClientId` / `calendarId` / `taskappIntegration` は端末ローカル
- 要約ルールの初期値は元仕様 7 章の通り。アジェンダのテンプレ初期値は空で、空なら項目名が空のアジェンダを3つ作る（旧既定値が保存済みの端末は空に置き換える）

## 5. モジュール契約

### util.js
`newId()`, `nowISO()`, `todayYMD(date?)`, `toYMD(date)`, `addDays(ymd, n)`, `debounce(fn, ms)`（戻り値に `.flush()` と `.cancel()`）, `formatDateTimeRange(startISO, endISO)` → 例「2026/10/07(水) 10:00–11:00」（終日は日付のみ）, `escapeHTML(s)`

### store.js
`export const store` ：（ほか `MEETING_STATUSES`, `DEFAULT_TEMPLATE`, `DEFAULT_SUMMARY_RULE` を export）
- `getState()`, `getMeetings()`, `getMeeting(id)`, `getSettings()`
- `createMeeting(partial)` → Meeting。テンプレを `preChecks` / `agenda` に展開。`partial` で title/start/end/location/attendees/description/calendarEventId を受ける
- `findByCalendarEventId(eventId)` → Meeting|null
- `updateMeeting(id, patch)` → Meeting（`updatedAt` 更新。patch は浅いマージ）
- `deleteMeeting(id)`（トゥームストーン記録）, `restoreMeeting(meeting)`（元に戻す用）
- `updateSettings(patch)`
- `exportJSON()` → string, `importJSON(text, { mode: 'replace'|'merge' })` → `{ count }`
- `getSyncPayload()` → `{ version:1, meetings, deleted, shared: { template, summaryRule, settingsUpdatedAt }, savedAt }`
- `mergeRemote(remote)` → `{ changed: bool }`
- `subscribe(fn)` → unsubscribe。`commit()` ごとに `fn(state)`
- 読込時 `storage` イベントで他タブの変更を取り込む
- localStorage 不可時はメモリにフォールバック（Node テストで利用）

### minutes.js
`buildMinutesPrompt(meeting, settings)` → Markdown 文字列。構成：要約ルール → `# 会議メモ` → `## 会議情報`（タイトル・日時・場所・参加者）→ `## 事前確認事項`（`- [x] text — メモ: note`）→ `## アジェンダ別メモ`（`### 1. title` ＋ memo、空は「（メモなし）」）→ `## 自由メモ` → `## 決定事項` → `## タスク`（Markdown 表：タスク／担当／期限／状態）。空のセクションは「なし」と書く。

### voice.js
- `isVoiceSupported()` → bool
- `createDictation({ onInterim(text), onFinal(text), onStateChange(listening: bool), onError(code, message) })` → `{ start(), stop(), isListening() }`
  - `lang='ja-JP'`, `interimResults=true`, `continuous=true`（iOS は `false`）
  - `onend` 時、停止要求されていなければ自動再開（短い遅延、連続エラー時は打ち切り）
  - 致命的エラー（not-allowed / service-not-allowed / audio-capture）は再開しない
- `IS_IOS`, `ensureMicPermission()`（iOS 用、taskapp と同じ）
- 挿入は app.js 側：直近フォーカスの `textarea` / `input[type=text]` のカーソル位置に確定文字列を挿入し `input` イベントを発火（自動保存に乗せる）。interim は画面下部のバーに薄く表示

### google.js
taskapp `gcal.js` の認証部分を移植。SCOPE は `https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.appdata`。token は `sessionStorage['minutes.google.token']`、state は `sessionStorage['minutes.google.state']`。
`export const google = { configure({ clientId }), isConfigured(), isSignedIn(), signIn({ silent?, redirect? }), signOut(), onAuthChange(fn), handleRedirectResult() }`、`export { authorizedFetch, GoogleAuthError, GoogleApiError }`

### calendar.js
`listEvents({ calendarId, from: Date, to: Date })` → `[{ id, title, start: ISO, end: ISO, allDay,（終日は app.js で YYYY-MM-DD に変換して保存） location, attendees: string[], description }]`（`singleEvents=true`, `orderBy=startTime`, キャンセル除外。attendees は displayName || email、自分は除外しない）

### drive.js
- `drive.pull()` → `{ fileId, state }`|null、`drive.push(payload)`（ファイル `minutes-state.json`、taskapp drive.js と同方式）
- `drive.createFile(name, obj)`（multipart で appDataFolder に新規作成）

### sync.js
`createSync({ store, google, drive, onStatus })` → `{ start, pullNow, getStatus }`。taskapp `sync.js` と同じ挙動（起動時・サインイン時・変更2秒デバウンス・可視化時30秒経過・online 復帰）。

### taskbridge.js（taskapp 連携）
- localStorage キー `minutes.taskappInbox`：`InboxItem[]`
- Drive appDataFolder ファイル `taskapp-inbox-<id>.json`：`InboxItem` 1件
- `InboxItem { id, title, due: YMD|null, memo, categoryId: string|null, source: 'minutes', meetingId, createdAt }`
  - `id` は minutes 側タスク id をそのまま使う（taskapp 側のタスク id になる → 二重取り込み防止）
  - `memo` 例：`元会議：定例MTG（2026/10/07）／担当：田中`
- `sendTasks(meeting, tasks, settings, { google, drive, storage? })` → `{ sent: Task[], driveOk: bool }`。未送信のみ対象。端末内 inbox へ追記、サインイン済みなら Drive ファイルを作成。成功したら呼び出し側で `sentToTaskapp=true, taskappId=id` を保存
- `readTaskappCategories()` → taskapp の `localStorage['taskapp.v1'].categories`（読み取りのみ。設定のカテゴリ選択に使う）

## 6. taskapp 側の改修

- `normalizeTask` に `memo: string`（既定 `''`）を追加。タスク行に小さく表示、編集可
- `js/inbox.js` を新設：
  - `importLocalInbox(store)`：`minutes.taskappInbox` を読み、`store.getTasks()` に無く、`deleted` に無い id のみ `importJSON({version:1,tasks,categories:store.getCategories()},{merge:true})` で取り込み、キーを削除
  - `importDriveInbox(store)`：`name contains 'taskapp-inbox-'` を列挙→各ファイルを取得→同様に取り込み→ファイル削除
  - 呼び出し：起動時（sync 開始前）、`visibilitychange`、`storage` イベント（ローカル分）、同期実行前（Drive 分）
  - 取り込み件数をトーストで通知
- sw.js の VERSION を上げ、`inbox.js` をプリキャッシュに追加、SPEC.md 更新、テスト追加

## 7. 画面

- ヘッダ：アプリ名「議事録」、同期状態、設定ボタン
- 会議一覧：タブ「今日」「予定」「過去」「すべて」、検索、カード（タイトル・日時・場所・ステータスバッジ・未完了タスク数）、右下 FAB「＋ 新規会議」→「カレンダーから作成」／「手動で作成」
- 会議詳細：上部に会議情報（編集可）とステータス選択、タブ「アジェンダ」「会議中」「事後」
  - アジェンダ：各項目のタイトル＋詳細（複数行）の編集、追加・削除・上下移動、カレンダー説明文（参考）。タスクのクイック追加は出さない
  - 会議中：アジェンダごとにタイトル・詳細（読み取り表示）とメモ（大きな textarea、音声入力可）、自由メモ、決定事項、タスク
  - 事後：「議事録化用にコピー」、プレビュー、最終議事録の貼り戻し（保存でステータス「議事録完了」）、タスク一覧と taskapp 送信（個別・一括）
  - タスクのクイック追加は会議中・事後タブの下部
  - 幅 900px 以上：会議中タブは左にアジェンダ一覧、右に選択アジェンダのメモ＋自由メモ等。それ未満は縦1カラム
- マイクボタン：画面右下に浮遊（会議詳細で表示）。押すと直近フォーカス欄に挿入
- 設定（`<dialog>`）：テンプレ編集、要約ルール、Google（クライアントID・カレンダーID・サインイン・今すぐ同期）、taskapp 連携（有効・既定カテゴリ）、JSON エクスポート／インポート（置換・統合）
- 自動保存：入力 1.5 秒デバウンス、`pagehide` / `visibilitychange(hidden)` で flush
- ルーティング：`location.hash`（`#/`、`#/m/<id>/<tab>`）
