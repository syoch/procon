# ページ状態と URL クエリ

始点・終点・画面・地図の viewport を URL クエリで管理する設計。

## 採用ライブラリ

**sveltekit-search-params v4**（2026-09 時点の判断）。

SvelteKit メンテナーが公式 issue `sveltejs/kit#13746` で名指し推奨している
唯一の runes ネイティブ実装。
依存ゼロ。

### 却下した候補

| ライブラリ | 理由 |
|---|---|
| `nuqs-svelte` | 非公式 nuqs ポート。1 年更新なし |
| `runed` | zod peer 必須・巨大・用途に過剰 |
| `kit-query-params` | 0.0.x。2 年放置 |

### 決定的な理由

**オブジェクト等価判定が `JSON.stringify` ベースがデフォルト。**
これが `$state` ⇄ URL の双方向ループを防ぐ中核で、自作すると必ず破綻する。

なお SvelteKit メンテナーは `page.url.searchParams` の書き込み対応は
**明確に拒否**している。`goto` を使うのが公式方針。

## 状態の分類

| 分類 | 値 |
|---|---|
| セッション専用（`$state`） | `begin` / `end` の `state`・`query`、`locationSelection`、`locationCandidates`、`parameterVariants`、`selectedVariantIndex`、`booted` |
| URL 専用（getter/setter） | `appState`（`b`=begin, `e`=end, `v`=screen）、viewport（`z`=zoom, `c`=center） |

座標は `37.43915,138.87876` 形式に自作 encode する。

### 履歴ポリシー

`queryParameters()` を 2 つに分ける。

| 名前 | 対象 | `pushHistory` |
|---|---|---|
| `share` | `b` / `e` / `v` | `true` —「戻る」で操作を巻き戻せる |
| `viewport` | `z` / `c` | `false`, `debounceHistory: 400` — 地図ドラッグで履歴を汚さない |

`boot`（起動演出 1.5s）は URL に**載せない。**

## `AppState` は `$state` オブジェクトではなく getter 付きクラス

URL 由来の値（`appState` / 座標 / viewport）を `$state` オブジェクトに同居させることはできない。

代わりに `AppState` をクラスにして、session 状態だけ `$state` フィールド、
URL 由来の値だけ getter/setter で公開する。

**そうすると `ctx.state.begin.query` / `ctx.state.locationSelection = x` /
`ctx.state.appState` が一切変えずに動く**ので、呼び出し側やテンプレートの差分がゼロになる。

- `get appState()` は `booted` が false の間 `"boot"` を返す。
  テンプレートの分岐順（app → menu-detail | result → boot）を従来どおり保てる。
  boot 演出を別フラグで持つと分岐を入れ替える羽目になるので不可。
- `Screen` 型は `"boot" | (typeof SHARED_SCREENS)[number]`。`boot` だけが URL に載らない値。
- `queryParameters()` は `$effect.pre` を使うため、**モジュールトップレベルでは呼べない。**
  `AppState` のコンストラクタ（＝コンポーネント初期化時）で呼ぶ。

## 落とし穴

1. **`defaultValue` を渡すと絶対に使わない。**
   `$effect.pre` が absent なパラメータを `overrides[key]` に固定し、
   以後 popstate で URL が変わっても `overrides[key] ?? decode(url)` の `??` 側で
   常に旧値が返る。
戻る／進むが壊れる。
default は消費側（getter）で適用する。

2. **`queryParameters()` は `$effect.pre` を内部で使うので、モジュールトップレベルでは呼べない**
   （`effect_orphan` エラー）。
   `AppState` のコンストラクタで呼ぶ。

3. **`pushHistory` のデフォルトは `true`。**
   README は false と書いているがコードは true。
   viewport 側は明示指定が必須。

4. ブラウザ履歴 API のレート制限（Safari は約 340ms）のため `debounceHistory` を使う。
   state 自体は即時更新され、URL だけが遅延する。

5. **`batched_updates` と `batch_timeout` はモジュール共有。**
   2 つの store が同一 tick に navigate すると、後から呼ばれた側の
   `pushHistory` / `debounce` が勝つ。

6. **`null` を代入するとクエリキーごと削除される。**
   `value == undefined` が真になるため `encode` は呼ばれない。

7. **`z` / `c` を書き戻す際は Leaflet 側で同一値判定を挟む。**
   無いと `setView` → `moveend` → 書き戻しが回り続ける。

8. 座標だけ URL 由来・入力テキストはセッション由来なので、
   リロード／共有時は入力欄を座標文字列で埋めて表示を揃える
   （`+page.svelte` のマーカー effect で行う）。

## 共有結果リンク（`v=menu-result`）の挙動

経路そのものはサイズが大きいため URL に載せない。
`v=menu-result` で開かれた場合は起動演出と地図データの完了を待って
`/api/path-find` を実行し、経路を復元する。

- 実行済みフラグ `hasSearched` は `$state` ではない普通の `let`。
  `startSearch` の中で設定し、手動検索と自動検索の両方を 1 回に抑える。
  `pathResult.length > 0` 判定だけだと「経路が空の結果」のときに二重実行する。
- 検索に失敗したら `ctx.state.appState = "menu-detail"` に戻しエラーバナーを見せる。
  空の結果画面で立ち止まらないようにする。
- `startSearch` は `Promise<boolean>` を返す。失敗時は throw せず `error` を立てる。

## 最終構成: URL 状態は `app_state.svelte.ts` に閉じる

`page_state.svelte.ts` は作らない。URL クエリ定義（座標 codec・
`queryParameters` 呼び出し・`SHARED_SCREENS`）はすべて `app_state.svelte.ts` の
非公開モジュール扱い。

viewport 同期も `AppState.bindMap(map, onMoveEnd)` として同じファイルに置き、
`+page.svelte` は 1 行の呼び出しだけ。

**新規ファイルは 0 個。**

### `bindMap` の設計上の必須条件

- **復元（URL → 地図）は内部の `$effect` で行う。**
  同期的に読むと呼び出し元（map effect）が URL 状態に依存し、
  書き戻しで再実行して `moveend` を多重登録する。

- **`map.whenReady` には書き戻さない。`onMoveEnd` だけを渡す。**
  地図が既に ready なら `whenReady` のコールバックは**同期実行**され、
  復元 effect より先に URL を既定値で上書きし、さらに呼び出し元 effect に
  URL 状態を依存させてしまう（この 2 つは同時に発生する）。
  初期の書き戻しは復元 effect の `setView` / `setZoom` が `moveend` を発火して自然に起きる。

- Leaflet を `app_state.svelte.ts` に import している。状態モジュールが Leaflet に
  依存する形だが、差分を最小に保つという判断で受け入れた。

## 検証手順（Playwright）

以下を確認済み。

- 共有 URL から経路が復元される
- `.boot` / `.menu-button` / `.panel-layer` の出し分け
- `page.goBack()` / `goForward()`
- 地図 pan/zoom で `history.length` が増えない
- `/api/osm` が収束する（3 秒 idle で 0 件）
- `/api/path-find` が 1 回だけ呼ばれる