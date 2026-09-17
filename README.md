# 1日1本論文
## One day, One paper

対象：学生、研究者

解決したい課題：論文を多読したいが、モチベが出ない(論文を探すのが面倒、論文を読むのが面倒、読んだ論文を記録するのが面倒)

ソリューション：1日1本、読むべき論文を提示し、メモを取らせる。(すぐにAIの要約は示さず、自分で読んでメモを取らせ、血肉にさせる)メモを取ったら、AIによる要約と、メモの採点をあげ、カレンダーに記録。(リンクや書誌情報も記録)

要するに論文レコメンドアプリ&論文メモアプリ。

## 各機能の関係(入力→出力)(LLMを使う場合は、apiキー、もしくはローカルにすでにある何か)
興味のあるキーワード→読むべき論文リストをLLMのdeepreserchとかの検索機能で出力(csvとかのデータ。題目、著者、出版年、可能であればPDF、リンク、書誌情報、(読むべき理由)、他にも必要があれば。) (読むべき論文の提示)

読むべき論文リスト(手入力でも加納)、設定→論文スケジュール (読むべき論文の提示)、「今日の論文」

ファーストビューの画面のボタン→「今日の論文」の提示、論文メモエディタ(md形式？)、カレンダー、apiキーでなんぼくらい使ったか(論文の読み方(多読、精読)講座)(ポモドーロタイマー)

論文メモ→(AIが論文を読めるなら、AI要約とメモの評価を付け足す)、カレンダー画面に写し、保存

色は青と白の二色。

## LLMにやらせるところ

読むべき論文リストの出力、論文の要約、論文メモの評価
---

## 開発

設計の経緯は [docs/design-questions.md](docs/design-questions.md)、仕様は [docs/spec.md](docs/spec.md)。

デスクトップ版(Tauri)とブラウザ版の 2 つがあり、`src/core` と `src/ui` は共通。
違うのはファイル・DB・通知などを受け持つ `src/core/store/backends/` だけで、起動時に自動で選ばれる。

### 必要なもの

- Node.js (LTS)
- Rust (rustup) — デスクトップ版だけ
- macOS: Xcode Command Line Tools — デスクトップ版だけ

この Mac では Node を `~/.local/node`、Rust を `~/.cargo` に入れてある。シェルで使うには PATH に追加する:

```sh
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
```

### 起動

```sh
npm install
npm run tauri dev      # デスクトップアプリとして起動
npm run dev            # ブラウザ版。http://localhost:1420 を開く
npm test               # ユニットテスト(src/ と proxy/)
npm run typecheck
```

初回の `tauri dev` は Rust の依存をビルドするため数分かかる。

## ブラウザ版

### 動く環境

- Chrome / Edge、Safari 17 以降、Firefox 111 以降(OPFS を使うため)
- HTTPS か localhost で開くこと。`file://` や素の HTTP では OPFS が使えない

### デスクトップ版との違い

| | デスクトップ版 | ブラウザ版 |
|---|---|---|
| データ | `~/Documents/OneDayOnePaper/` | ブラウザ内(OPFS)。**サイトデータを消すと消える** |
| API キー | OS のキーチェーン | localStorage(暗号化なし) |
| 通知 | 常駐して出す | **タブを開いている間だけ** |
| 学術 API | すべて直接 | 一部は CORS 中継が要る(下記) |
| PDF の本文抽出 | Rust(pdf-extract) | pdf.js |

ブラウザ版のデータは端末とブラウザごとに別になる。設定画面の「書き出す」で定期的に ZIP にしておくこと。

### CORS 中継(proxy/)

ブラウザからは CORS を許可していない API を呼べない。2026-09-16 に確認した状況:

| 行き先 | 中継なしで |
|---|---|
| OpenAlex / Crossref / PubMed / CiNii Research | 通る |
| arXiv の PDF(arxiv.org/pdf) | 通る |
| Anthropic API | 通る(SDK が `anthropic-dangerous-direct-browser-access` を付ける) |
| arXiv API(export.arxiv.org) / J-STAGE | **通らない** |
| Semantic Scholar | 未確認(キーなしでは 429 が返った) |
| 出版社・リポジトリの PDF | 行き先次第 |

`proxy/` の Cloudflare Worker を置き、ビルド時に `VITE_PROXY_BASE` を渡すと、
別オリジンへの GET がすべて中継経由になる(POST とローカルの Ollama は直接のまま。
例外として Slack / LINE への通知の POST だけは中継に回す)。
中継は学術 API のほかは PDF しか通さず、Origin が `ALLOWED_ORIGINS` に無いリクエストは断る。

```sh
cd proxy
# wrangler.toml の ALLOWED_ORIGINS に、ブラウザ版を置く URL を足す
npx wrangler@4 login
npx wrangler@4 deploy          # https://oneday-onepaper-proxy.<アカウント>.workers.dev が出る
cd ..
echo 'VITE_PROXY_BASE=https://oneday-onepaper-proxy.<アカウント>.workers.dev' > .env.local
```

Ollama をブラウザ版から使うときは、Ollama 側で `OLLAMA_ORIGINS` にブラウザ版の URL を入れておく。

### 公開(GitHub Pages)

`.github/workflows/pages.yml` が、`main` に push するたびにビルドして GitHub Pages に置く。
公開先は `https://<ユーザー名>.github.io/<リポジトリ名>/`。サーバーは要らない。

初回だけリポジトリ側で設定する:

1. Settings → Pages → Build and deployment → Source を **GitHub Actions** にする
2. (任意)CORS 中継を使うなら、Settings → Secrets and variables → Actions → **Variables** に
   `VITE_PROXY_BASE` = `https://oneday-onepaper-proxy.<アカウント>.workers.dev` を足す。
   無ければ中継なしで公開される(arXiv API / J-STAGE / LINE 通知が使えない)
3. `proxy/wrangler.toml` の `ALLOWED_ORIGINS` に `https://<ユーザー名>.github.io` を足して `npx wrangler@4 deploy` し直す

フォークして自分用に公開するときも同じ手順。サブパスはリポジトリ名から自動で決まる。

手元でビルドだけするなら:

```sh
npm run build                                   # dist/ に静的ファイルができる(ルート配信用)
BASE_PATH=/リポジトリ名/ npm run build            # サブパスに置くとき
```

`dist/` は Cloudflare Pages / Netlify / Vercel などに置いてもよい。

### デスクトップ版からの移行

1. デスクトップ版の 設定 → データ → 「書き出す」で ZIP を作る(`~/Downloads` に保存される)
2. ブラウザ版の 設定 → データ → 「取り込む」でその ZIP を選ぶ
3. API キーは移らないので、ブラウザ版の設定画面で入れ直す

データフォルダを手で圧縮しても取り込めるが、その場合は**先にデスクトップ版を終了する**こと。
起動中は最近の記録が `state.sqlite-wal` に残っていて、`state.sqlite` だけでは欠けるため。
逆向き(ブラウザ版 → デスクトップ版)も同じ手順で、書き出した ZIP をデスクトップ版で取り込む。

取り込むと今のデータは置き換わる。置き換える前の状態はデータフォルダの `backups/` に自動で書き出される。

### 通知を Slack / LINE に送る

設定 → 通知 → 配信先で有効にする。文面はデスクトップの通知と同じ(朝・夜・最終通知)。

- **Slack**: Slack の「アプリ」→「Incoming Webhooks」でチャンネルを選び、発行された URL を入れる。
  ブラウザ版は中継が無くても送れる(送信の成否は分からない)。
- **LINE**: [LINE Developers](https://developers.line.biz/) で Messaging API のチャネルを作り、
  長期のチャネルアクセストークンと、自分のユーザー ID(チャネル基本設定の「あなたのユーザー ID」)を入れる。
  ボットを友だち追加しておくこと。ブラウザ版から送るには CORS 中継が要る(中継は POST をこの 2 ホストにだけ通す)。

どちらも「テスト送信」で確かめられる。URL とトークンはキーチェーン(ブラウザ版は localStorage)に置かれ、書き出す ZIP には入らない。

### BibTeX

論文リスト → BibTeX。Zotero / Mendeley / Paperpile などから書き出した `.bib` を読み込むか、エントリを貼り付ける。
取り込んだエントリは論文ごとに残り、書き出すときにそのまま使われる。取り込み元が無い論文は書誌情報から生成する。
書き出しは「すべて」「キューだけ」「読了だけ」を選べる。

### モバイル(iOS / Android)

コードはモバイルでも動く構成にしてあるが、この Mac には Xcode 本体と Android SDK が無いため**実機ビルドは未検証**。

- 必要なもの: iOS は Xcode(Command Line Tools だけでは不可)と `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`、
  Android は Android Studio(SDK / NDK)と `rustup target add aarch64-linux-android` ほか
- 初期化と起動(`src-tauri/gen/` は .gitignore 済み):

```sh
npm run tauri ios init && npm run tauri ios dev
npm run tauri android init && npm run tauri android dev
```

- デスクトップとの違い: トレイ常駐と「閉じても隠す」は無い(`cfg(desktop)`)。通知はアプリを開いている間のタイマーで出す。
  既定のデータフォルダはアプリのサンドボックス内。Android は keyring のネイティブ保管が無いので API キーの保存は動かない(要対応)。
- ブラウザ版も 720px 以下ではナビが上のバーになり、スマートフォンで使える。

### 構成

```
src/core/     本体ロジック(Tauri 非依存。テスト可能)
  schedule/   論理日・休み・前日判定
  papers/     キュー操作・CSV・BibTeX
  memo/       メモ形式・読了判定
  notify.ts   通知の文面と配信(notifyChannels.ts が Slack / LINE)
  pomodoro.ts ポモドーロの状態遷移
  markdown.ts 講座用の Markdown レンダラ
  llm/        プロバイダ抽象層(Anthropic / Ollama)・要約・採点
  usage/      単価表・概算
  store/      データの保存
    backend.ts   OS 境界の interface(ファイル・SQLite・キーチェーン・通知・fetch・PDF)
    backends/    その実装。@tauri-apps を import するのは tauri.ts だけ
      tauri.ts   デスクトップ版
      web/       ブラウザ版(OPFS・sql.js・pdf.js)
      memory.ts  テスト用
    install.ts   起動時にどの実装を使うか決める
  archive.ts  データの書き出し・取り込み(ZIP)
  app.ts      UI から呼ぶ操作
src/content/  講座(静的 Markdown)
src/ui/       React 画面
src-tauri/    Rust(ファイル、SQLite、キーチェーンのみ)
proxy/        ブラウザ版の CORS 中継(Cloudflare Workers)
```

デスクトップ版のデータは `~/Documents/OneDayOnePaper/` に置かれる(設定で変更可)。ブラウザ版は OPFS の中に同じ並びで置く。
メモは `memos/*.md`、論文リストは `papers.json`、記録は `state.sqlite`、保存した PDF は `pdfs/`。

### 実装状況

- MVP: 論文リスト、今日の論文、メモと読了判定、AI 要約・採点、カレンダー、使用量、設定
- v1: 論文を探す(OpenAlex / Semantic Scholar / Crossref / arXiv / PubMed / CiNii Research / J-STAGE から選んで検索し、
  LLM がクエリ生成と順位付け)、DOI / arXiv ID 取り込み、OA PDF の保存と全文抽出、
  LLM によるキュー並べ替え、メニューバー常駐と macOS 通知
- Web: ブラウザ版(OPFS + sql.js + pdf.js)、CORS 中継、データの書き出し・取り込み
- v2: Slack / LINE 配信、BibTeX の取り込み・書き出し、講座(4 本)、ポモドーロ、狭い画面(モバイル)向けの画面。
  iOS / Android の実機ビルドは未検証(下の「モバイル」)

デスクトップ版はウィンドウを閉じても終了せず、メニューバーのアイコンから「開く」「終了」を選べる。
