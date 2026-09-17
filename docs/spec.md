# 仕様書 v0.2

実装状況は [README](../README.md) の「実装状況」を参照。

[design-questions.md](design-questions.md) の決定事項を、実装に着手できる粒度まで展開したもの。
UI の細部は対話しながら変える前提なので、ここでは「変えると高くつくもの」(データ形式・境界・LLM 抽象化・読了定義)を優先して固める。

---

## 1. 原則

1. **AI 要約はメモを書く前に見せない。** 要約と採点は読了判定が成立した後にだけ生成・表示する。
2. **メモはユーザーのもの。** アプリを捨てても残る Markdown ファイルとして保存する。
3. **記録は本体が持つ。** 読了ログと連続記録は `day_log` にあり、画面や通知はそれを読むだけ。(かつてこの上に「死刑機能」というゲーミフィケーション層を載せていたが 2026-09-15 に取り下げた。)
4. **LLM はプロバイダ非依存。** 呼び出しは 1 つのインターフェースを通す。
5. **論文の存在は LLM に保証させない。** 書誌情報は学術 API から取り、LLM は順位付けと説明だけ担う。

## 2. 用語

| 用語 | 意味 |
|---|---|
| 論文リスト | 読む候補の論文の集合。状態を持つ |
| キュー | 論文リストのうち `unread` のものを、ユーザーが決めた順に並べたもの |
| 今日の論文 | キューの先頭。日付境界で確定する |
| 読了 | メモが保存され、最低文字数を満たした状態 |
| 連続記録 | 読了(または休み)が途切れずに続いた日数 |
| 猶予日 | 読まなくても連続記録が途切れない日。既定では存在しない |

## 3. アーキテクチャ

- **Tauri 2** + **React / TypeScript**。メニューバー(トレイ)常駐。
- 役割分担
  - TypeScript: UI、アプリロジック(スケジューリング、読了判定)、LLM 呼び出し、学術 API 呼び出し
  - Rust(Tauri コマンド): ファイル読み書き、SQLite、OS 通知、PDF テキスト抽出、トレイ常駐、スケジュール起動
- 将来のモバイル化のため、Rust 側は「OS の代わりに何かをする」ものに限定する。
- その境界は `src/core/store/backend.ts` の `Backend` interface に置く。Tauri 実装のほかにブラウザ実装
  (OPFS・sql.js・pdf.js・localStorage・Web Notifications)があり、起動時に選ぶ(2026-09-16 追加)。
  ブラウザ版は常駐できないので、通知はタブを開いている間だけ出る(10.4 の常駐はデスクトップ版のみ)。
- データの書き出し・取り込みは 4.1 のフォルダをそのまま ZIP にしたもの(`src/core/archive.ts`)。
  API キーは含めない。取り込みは置き換えで、置き換える前の状態を `backups/` に書き出す。
- モバイル(Tauri 2 の iOS / Android)は同じ Rust コマンドと同じ画面を使う。トレイと「閉じても隠す」だけ
  `cfg(desktop)` で外し、既定のデータフォルダはアプリのサンドボックス内(`app.path().document_dir()`)にする。
  画面は 720px 以下でナビを上のバーにし、2 列のものを 1 列にする(2026-09-16 追加、実機ビルドは未検証)。

```
src/
  core/          本体
    papers/      論文リスト・キュー
    schedule/    日付境界・休み・今日の論文
    memo/        メモの読み書き・読了判定
    llm/         プロバイダ抽象層と 4 つのタスク
    scholar/     学術 API
    usage/       トークン記録と概算
    notify.ts    通知の文面と配信。notifyChannels.ts が Slack / LINE
    pomodoro.ts  ポモドーロの状態遷移
    markdown.ts  講座用の小さな Markdown レンダラ
  content/lessons/  講座(静的 Markdown。ビルド時に同梱)
  ui/            画面。core だけを使う
src-tauri/       Rust
```

## 4. データ

### 4.1 ディレクトリ

ユーザーが指定した 1 つのフォルダ(既定: `~/Documents/OneDayOnePaper/`)に全部置く。

```
OneDayOnePaper/
  papers.json          論文リスト
  memos/
    2026-09-07_<paper-id>.md
  pdfs/
    <paper-id>.pdf      OA で取れたもののみ
  state.sqlite         読了ログ、使用量ログ、キャッシュ
  settings.json
```

Markdown と JSON は人が読める。SQLite は集計と検索のためのインデックスで、`papers.json` と `memos/` から再構築できるようにする。

### 4.2 論文(`papers.json`)

```jsonc
{
  "version": 1,
  "papers": [
    {
      "id": "10.48550/arXiv.2301.00001",   // DOI。なければ "local:<ulid>"
      "title": "...",
      "authors": ["A. Author", "B. Author"],
      "year": 2023,
      "venue": "NeurIPS",
      "doi": "10.48550/arXiv.2301.00001",
      "url": "https://...",
      "pdf_url": "https://arxiv.org/pdf/...",
      "abstract": "...",
      "reason": "...",                      // 読むべき理由(LLM 生成、手入力可)
      "source": "llm" | "manual" | "import",
      "status": "unread" | "read" | "skipped" | "removed",
      "queue_order": 3,                     // unread のみ意味を持つ
      "added_at": "2026-09-07T10:00:00+09:00",
      "read_at": null,
      "skip_count": 0,
      "bibtex": null,                       // v1 で埋める
      "fulltext_tokens": null,              // 全文抽出済みなら概算トークン数
      "course": null,                       // { id, title, step, stage: 'survey'|'classic'|'recent' }。8.1
      "kind": "paper"                       // 'paper'(無ければこれ)| 'article'。記事は id が "url:<URL>"
    }
  ]
}
```

- 手入力の最低必須は `title` のみ。
- インポート: CSV(上記の列名に対応)、DOI の羅列(1 行 1 DOI。書誌情報は Crossref / OpenAlex から補完)、
  BibTeX(ファイルか貼り付け。`src/core/papers/bibtex.ts`)。
- BibTeX の取り込みでは元のエントリを `bibtex` に残す。書き出し(`papersToBibtex`)は `bibtex` があればそのまま、
  無ければ書誌情報から生成する。引用キーは「筆頭著者の姓 + 年 + タイトルの最初の語」を ASCII に落としたもので、
  重なれば a, b, … を付ける。arXiv の DOI は `eprint` / `archiveprefix` にする。

### 4.3 メモ(`memos/<date>_<paper-id>.md`)

frontmatter + 本文。テンプレートは初期値で、消してよい。

```markdown
---
paper_id: "10.48550/arXiv.2301.00001"
date: 2026-09-07
chars: 812
completed: true
level: 3                       # 0 未読了 | 1 ひとこと | 2 要点 | 3 しっかり(6 章)
summary_input: "abstract"      # abstract | fulltext | pasted | none
score_total: 16
---

# <論文タイトル>

## ひとこと(まずここだけでよい)

## 何を解いた / 論じた問題か

## 手法の要点

## 結果・主張

## 自分の言葉で言うと / 自分の研究との関係

## 疑問・批判
```

- `chars` は見出し行とテンプレートの空見出しを除いた本文の文字数。
- `level` の無いメモ(段階を入れる前のもの)は、`completed: true` なら `level: 3` として読む。当時の読了条件が今の Lv3 と同じため。
- AI 要約と採点コメントはメモ本文には混ぜず、`state.sqlite` に保存して UI で並べて表示する。メモに残したければユーザーがコピーする。理由: メモを「自分の血肉」だけにしておくため。

### 4.4 読了ログ(`state.sqlite`)

```sql
-- 1 日 1 行。休みの日も行を作る
CREATE TABLE day_log (
  date        TEXT PRIMARY KEY,           -- 論理日(境界時刻で切った日付)
  kind        TEXT NOT NULL,              -- 'read' | 'rest' | 'grace' | 'missed'
  paper_ids   TEXT NOT NULL DEFAULT '[]', -- その日に読了した論文(複数可)
  streak      INTEGER NOT NULL            -- その日終了時点の連続記録
);

CREATE TABLE ai_output (
  paper_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- 'summary' | 'grade'
  input_kind  TEXT NOT NULL,              -- 'abstract' | 'fulltext' | 'pasted'
  content     TEXT NOT NULL,              -- JSON
  created_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, kind)
);

CREATE TABLE llm_usage (
  id            INTEGER PRIMARY KEY,
  at            TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  task          TEXT NOT NULL,            -- 'recommend' | 'rank' | 'summary' | 'grade'
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  est_cost_usd  REAL NOT NULL
);
```

### 4.5 設定(`settings.json`)

```jsonc
{
  "data_dir": "~/Documents/OneDayOnePaper",
  "day_boundary_hour": 4,
  "rest_weekdays": [0, 6],                // 0=日, 6=土。既定は空 []
  "rest_periods": [{ "from": "2026-12-28", "to": "2027-01-03" }],
  "quick_memo_chars": 20,                 // Lv1 ひとこと。ここで読了が成立
  "standard_memo_chars": 80,              // Lv2 要点
  "min_memo_chars": 200,                  // Lv3 しっかり(段階を入れる前の読了条件)
  "extra_read_reward": "none",            // 'none' | 'grace'。既定 none
  "forgive_single_miss": true,            // 1 日だけの未読では連続記録を切らない(5.4)
  "language": "ja",
  "llm": {
    "provider": "anthropic",              // 'anthropic' | 'ollama' | 'openai'(OpenAI 互換)
    "model": "...",
    "api_key_ref": "keychain:onedayonepaper/anthropic",  // 平文は置かない
    "base_url": null,                     // ollama と openai 用
    "summary_via": "auto",                // 'auto' | 'api' | 'shortcut' | 'paste'(7.4)
    "shortcut_name": "OneDayOnePaper"
  },
  "grace": { "enabled": false, "per_month": 0 },
  "notifications": {
    "morning": "08:00",
    "evening": "20:00",
    "last_call_minutes_before": 60,
    "channels": ["os"],                   // "os" | "slack" | "line" の組み合わせ
    "line_to": ""                         // LINE の送信先ユーザー ID
  },
  "advanced": false,                      // 詳しい機能を出す(9 章)
  "share": { "slack_on_complete": false, "display_name": "" },   // 10.1
  "pomodoro": { "enabled": true, "work_minutes": 25, "break_minutes": 5 }
}
```

API キーは OS のキーチェーンに置き、`settings.json` には参照だけ書く。Slack の Webhook URL と
LINE のチャネルアクセストークン、読了を共有する Slack の Webhook URL も同じ場所(secret 層。ブラウザ版は localStorage)に置く。

## 5. スケジューリング

### 5.1 論理日

- `day_boundary_hour`(既定 4)で日付を切る。9/8 の 3:59 は論理日 9/7。
- 日付境界を跨いだ瞬間に「前日の判定」と「今日の論文の確定」を行う。アプリが起動していなければ次回起動時にまとめて実行する(複数日分を順に処理)。

### 5.2 休み

- `rest_weekdays` と `rest_periods` に該当する論理日は `day_log.kind = 'rest'`。連続記録は維持され、増えもしない。
- 休みの日でも読める。読んだら `kind = 'read'` にして連続記録を増やす。

### 5.3 今日の論文

- キュー(`status = 'unread'` を `queue_order` 昇順)の先頭。
- キューが空なら「今日の論文なし」。この状態で日を越えても `missed` にはしない(読むものがないのはユーザーの責任ではない)。ただし UI で強く促す。
- **スキップ**: 今日の論文を `queue_order` を末尾にして次の論文を出す。`skip_count` を +1。猶予は消費しない。
- **持ち越し**: 読まずに日を越えたら、その論文は翌日もキュー先頭のまま。
- **LLM 並べ替え**: ユーザーが明示的に実行したときだけ。基準(難易度順・関連順・年代順など)を選ばせ、結果を `queue_order` に書き戻す。実行前に確認を出す。

### 5.4 前日の判定(日付境界で実行)

```
if 前日が rest        → kind = 'rest'
elif 前日に読了あり    → kind = 'read',   streak += 1
elif grace 有効 かつ grace_days > 0 → kind = 'grace', grace_days -= 1, streak 維持
else                  → kind = 'missed'
                        forgive_single_miss かつ 直前(休みを除く)が未読でない → streak 維持(大目に見る)
                        それ以外 → streak = 0
```

**1 日だけの未読は大目に見る**(2026-09-18、既定でオン)。2 日続けて休んだら切れる。休みの日は数えない(未読・休み・未読 は 2 日連続)。
理由: 習慣の弱い人には、罰が重いとアプリごとやめる原因になる。「2 日続けては休まない」だけを守らせる。
大目に見た日は `kind = 'missed'` のまま `streak > 0` で記録される(カレンダーでは「未読(記録は継続)」)。
翌日のホームには「今日 1 行でも書けば連続記録は続きます」と出す。猶予(`grace`)が残っていればそちらを先に使う。

### 5.5 複数本

- 同じ論理日に 2 本目以降を読了したとき、警告(「毎日の習慣にすることを勧める」)を表示する。
- `extra_read_reward = 'grace'` かつ `grace.enabled` のときだけ `grace_days += 1`。既定では記録に残るだけ。

## 6. 読了判定

読了は 3 段階(2026-09-17、design-questions Q25)。対象は「読まなきゃと思いながら始められない人」なので、始めるハードルを下げる。

| 段階 | 名前 | 本文の文字数(既定) | 想定 |
|---|---|---|---|
| Lv1 | ひとこと | `quick_memo_chars`(20) | アブストと図を見て 1 行 |
| Lv2 | 要点 | `standard_memo_chars`(80) | 問題・手法・結果を 1 行ずつ |
| Lv3 | しっかり | `min_memo_chars`(200) | テンプレートを埋める |

- メモ保存時に Lv1 に届いたら `completed: true` にし、`papers.json` の `status = 'read'`, `read_at` を書く。連続記録は `completed` だけを見る。
- `level` は届いた一番上の段階。あとから書き足せば上がり、消しても下がらない。読了日(`date`)は Lv1 が成立した日のまま。
- 閾値は Lv1 <= Lv2 <= Lv3 になるように揃える(Lv3 を小さくした設定では Lv1・Lv2 もそこまで下げる)。
- 判定が成立した瞬間に、AI 要約と採点の生成を**提案**する(自動実行はしない。コストが発生するため)。
- 判定成立後もメモは編集できる。文字数が下回っても読了は取り消さない(取り消すと連続記録の意味が壊れる)。

## 7. LLM

### 7.1 抽象層

```ts
interface LlmProvider {
  name: 'anthropic' | 'ollama' | 'openai';
  complete(req: { system: string; user: string; json?: boolean; maxTokens: number })
    : Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  countTokens(text: string): Promise<number>;   // 概算でよい
}
```

全呼び出しは `llm_usage` に記録する。単価表は `src/core/usage/prices.json` に持ち、手で更新できる。Ollama は 0 円。

`openai` は OpenAI 互換の `/chat/completions` を話す行き先すべて(OpenAI / Gemini の互換エンドポイント / OpenRouter / Groq / LM Studio など)。
違いは `llm.base_url`・キー(secret の `openai_compat_api_key`。ローカルなら空)・モデル名だけ。スキーマ指定は行き先で通り方が違うので、
スキーマは文面で伝えて JSON モード(`response_format: json_object`)だけ頼み、400 が返ったら JSON モードも外してもう一度送る。
単価表に無いモデルは $0 と出る。ブラウザ版では行き先が CORS を許可していないと届かない。
デスクトップ版は HTTP の許可リスト(`src-tauri/capabilities/default.json`)にある行き先だけ届く(プリセットの 4 つと localhost)。

### 7.2 タスク

| task | 入力 | 出力(JSON) | 呼ばれるタイミング |
|---|---|---|---|
| `recommend` | キーワード、件数 | 検索クエリの配列(学術 API に投げる用) | ユーザーが「論文を探す」を実行 |
| `rank` | 候補論文の書誌 + アブスト(最大 30 件)、キーワード、並べ替え基準 | `[{ id, rank, reason }]` | recommend の後、または LLM 並べ替え |
| `summary` | タイトル + アブスト、または全文 | `{ problem, method, results, limitations, evidence: [{ field, quote }] }` | 読了後、ユーザーが実行 |
| `grade` | メモ本文 + summary と同じ入力 | `{ items: [{ name, score(1-5), comment }], total, overall_comment, good_points, missing_points, misreadings, next_step }` | summary と同時 |

採点項目(固定 4 つ):
1. 問題設定を把握しているか
2. 手法を自分の言葉で説明できているか
3. 結果を正しく捉えているか
4. 自分の視点(疑問・応用)があるか

**要約の根拠**(2026-09-18): `evidence` は、各項目の根拠として LLM が原文から一字一句抜き出した文。LLM の申告は信じず、
渡したテキストに本当にあるかをアプリが照合して `found` を付ける(空白・改行・引用符の違いは無視。8 文字未満は根拠にしない)。
画面では各項目の下に引用を出し、見つからなかったものは「原文に見つかりません」と示す。アブストだけから作った要約にはその旨のバッジを出す。
ページ番号は出さない(抽出した本文にページの情報が無いため)。

`grade` は「メモに書いてあること」を評価する。メモが短いこと自体は責めない(Lv1 の日があるため)。

画面では点数より**差分フィードバック**を先に見せる(2026-09-18)。点数は折りたたみの中。習慣が弱い人には、20 点満点の点より次の一歩のほうが効くため。
- `good_points`: メモがよく捉えている点 / `missing_points`: 渡した論文情報にあってメモにない点 /
  `misreadings`: メモが論文と食い違っているかもしれない点 / `next_step`: 次の一歩(1 文)。各 3 つまで。
- 入れる前の採点にはこれらが無いので、無ければ出さない。

### 7.3 全文を使う流れ(コスト提示)

1. `pdfs/<id>.pdf` があれば Rust でテキスト抽出 → `countTokens` → `fulltext_tokens` に保存
2. UI に「アブストのみ(約 N トークン・$X)」「全文(約 M トークン・$Y)」を並べて表示
3. 既定の選択はアブストのみ。ユーザーが全文を選んだときだけ全文を送る

### 7.4 API を通さない道(2026-09-18、design-questions Q27)

対象の人は API キーを取らない。キーが無くても要約と採点までたどり着けるように、道を広く残す。

| `llm.summary_via` | 何をするか | 使える場所 |
|---|---|---|
| `api` | 7.1 のプロバイダを呼ぶ | どこでも |
| `shortcut` | Apple のショートカット経由で Apple Intelligence(オンデバイスか Private Cloud Compute) | ブラウザ版。iPadOS / iOS / macOS 26 以降 |
| `paste` | プロンプトをコピーして好きなチャット AI に貼り、回答を貼り戻す | どこでも |
| `auto`(既定) | API が使えれば `api`、だめなら Apple の端末で `shortcut`、それ以外は `paste` | |

- `shortcut` と `paste` は同じ仕組み。要約と採点を 1 往復で頼むプロンプト(`llm/handoff.ts`)をクリップボードに置き、回答もクリップボードから読む。
  URL に本文を載せないのは長さの上限のため(行きはショートカットの URL、帰りは配信サーバーの URL 長)。
- `shortcut` は `shortcuts://x-callback-url/run-shortcut?name=<llm.shortcut_name>&x-success=<戻り先>` を開く。戻り先は今のページに `?ai_return=<論文 ID>` を付けたもの。
  戻ると、その論文のメモが開き、「結果を貼り付ける」を押すと読み込む。出かけている間のことは localStorage の `ai_handoff_pending` に残す。
- ユーザーが作るショートカットは 3 アクション: クリップボードを取得 → モデルを使用 → クリップボードにコピー。
- 回答は緩く読む: コードフェンスや前置きがあってもよい。`summary` に包まれていなくてもよい。欠けた項目は「不明」。採点が無ければ要約だけ保存する。点は 1〜5 に丸め、合計は数え直す。
- 使用量には数えない。`recommend` / `rank` には使えない(検索はキーワード直接 + 被引用数順になる)。
- デスクトップ版は戻り先の https ページが無いので `shortcut` は出さない。macOS の `shortcuts run` コマンドを Rust から呼べば実現できる(未実装)。

## 8. 学術 API

- 検索ソースは複数から選ぶ。一覧は `core/scholar/sources.ts` が持ち、既定は設定 `search.sources`(初期値は OpenAlex + Semantic Scholar + arXiv)。検索画面でその都度変えられる。

  | ソース | キー | 言語 | 備考 |
  |---|---|---|---|
  | OpenAlex | 不要 | en | 主。被引用数と OA の PDF リンク |
  | Semantic Scholar | 任意(キーチェーン `semanticscholar_api_key`) | en | CS 系。キーなしは 429 になりやすい |
  | Crossref | 不要 | en | DOI 登録元。抄録は少ない |
  | arXiv | 不要 | en | 各語を `all:` で AND 結合。PDF は常にある |
  | PubMed | 不要 | en | esearch → efetch の 2 段。抄録あり |
  | CiNii Research | 不要 | ja | OpenSearch の JSON-LD。DOI があれば `dc:identifier` から |
  | J-STAGE | 不要 | ja | Atom。`_article` → `_pdf` で本文 PDF。抄録なし |

- 流れ: キーワード → `recommend` で英語クエリ(日本語ソースを選んでいれば日本語クエリも)生成 → 各ソースを並列に検索(同じソースへのクエリは順番に)→ ソースごとに交互に並べて DOI かタイトルで統合(欠けた項目は他ソースから補完、被引用数は最大値)→ 最大 40 件を `rank` で順位付けと理由生成 → ユーザーが選んでリストに追加。
- 429 は 3 秒待って 1 回だけ再試行。それでも失敗したソースは警告を出して他のソースの結果だけ返す。
- OA の PDF リンクは各ソースから取る(OpenAlex `best_oa_location.pdf_url` / `open_access.oa_url`、Semantic Scholar `openAccessPdf`、Crossref `link` の PDF、arXiv、J-STAGE)。取れないものは `pdf_url = null`。
- 学術 API の応答は `state.sqlite` に 7 日キャッシュ。

### 8.0 記事(2026-09-18)

技術ブログや解説記事も「今日の 1 本」にできる(論文が重い日の逃げ道)。入れるのは URL とタイトルだけで、本文は取りに行かない。
理由: CORS 中継は HTML を通さない方針で、デスクトップ版も HTTP の行き先を絞っている。どちらも意図した制限なので広げない。
id は `url:<計測用パラメータと # を落とした URL>`(同じ記事は重複になる)。掲載(`venue`)はホスト名。AI 要約は「本文を貼り付ける」が既定になる。

### 8.1 コース(2026-09-18、design-questions 8 章)

対象の人は分野の地図を持っていないので、キーワード検索の結果を並べられても選べない。無限のキューではなく、
終わりの見える「このテーマの入門 N 本(5 / 10 / 15)」を順番つきで渡す。「論文を探す」の既定はこちら。

- 順番は 全体像(サーベイ・解説)→ 基礎(古典)→ 最近の研究。
- LLM が使えるときは、この基準で `rank` させた上位 N 本をその順で使う。
- LLM が無くても組める: 題名(survey / review / 解説 など)で全体像、年(直近 2 年)で最近、ほかを基礎に分け、
  全体像 2 本まで・残りの半分を基礎(古い順)・あとを最近、足りない枠は順位の高い残りで埋める(`papers/course.ts`)。
- コースは別ファイルにせず、論文の `course` 列だけで表す。進捗(読了数 / 本数、次の 1 本)はそこから数える。ホームに進捗バーを出す。
- コースの論文はキューの末尾にこの順で入る。並べ替えやスキップは普通の論文と同じ。
- API キーが無いときは「LLM でクエリ生成と順位付け」を既定でオフにする(毎回の失敗表示を避ける)。

## 9. 画面

UI の細部は変える前提。ここでは画面の**存在と責務**だけ決める。

| 画面 | 責務 |
|---|---|
| ホーム(ファーストビュー) | 今日の論文、連続記録、各画面へのボタン |
| 今日の論文 | 書誌・理由・リンク・PDF、メモを書き始めるボタン、スキップ |
| メモエディタ | Markdown 編集、文字数、読了までの残り文字数、保存 |
| 読了後 | 要約・採点の実行提案(コスト提示)、結果表示、メモと並べて表示 |
| カレンダー | 月表示。日ごとに read / rest / grace / missed、論文タイトル、合計点 |
| 論文リスト | 一覧、キュー並べ替え、追加(手入力 / CSV / DOI)、検索、LLM 並べ替え |
| 論文を探す | キーワード入力 → 候補 → 追加 |
| 使用量 | 月次・累計のトークンと概算金額、task 別内訳 |
| 設定 | 4.5 の項目 |
| 講座 | 静的 Markdown |

配色は青と白の 2 色を基本。

**詳しい機能は既定で隠す**(`advanced`、既定 false。2026-09-18)。入ったばかりの人に選ぶものを増やさないため。隠すもの:
BibTeX と CSV の取り込み、検索ソースの選択(論文を探す・設定)、API 使用量の画面、ポモドーロ、日付の切り替え時刻、猶予。
設定画面の一番上の「詳しい設定と機能を出す」で戻せる。機能そのものは消していない。

## 10. 通知

- 朝(`morning`): 「今日の論文はこれ」タイトル付き。
- 夜(`evening`): 未読なら「まだ読んでいない」。
- 境界の `last_call_minutes_before` 分前: 未読なら「締切まで N 分」。
- 通知はトレイ常駐プロセスが出す。休みの日は出さない。
- 配信先(`notifications.channels`)は複数選べる。文面は共通。
  - `os`: デスクトップ / ブラウザの通知
  - `slack`: Incoming Webhook に `{ text }` を POST
  - `line`: Messaging API の push(`/v2/bot/message/push`)。チャネルアクセストークンと送信先ユーザー ID が要る。
    LINE Notify は終了しているので使わない
- 1 通につき 1 回だけ送る(`meta` の `notified:<key>`)。どの配信先にも送れなかったときは記録せず次の tick で再試行する。
- ブラウザ版: Slack は中継が無くても no-cors のフォーム送信(`payload=`)で送れる(成否は見えない)。
  LINE は `Authorization` ヘッダが要るので CORS 中継が必要。中継は POST をこの 2 ホストにだけ通す。
- ポモドーロの終了も `os` の通知で知らせる(Slack / LINE には送らない)。

### 10.1 読了を Slack に共有(2026-09-17、design-questions Q26)

- 読了(Lv1)が成立した保存の直後に、`share.slack_on_complete` が有効なら Slack に 1 通投稿する。編集画面から手で送り直せる。
- Webhook は通知のものとは別(secret の `share_slack_webhook_url`)。研究室のチャンネルに「まだ読んでいません」を流さないため。
- 文面: `📖 <名前> が今日の 1 本を読みました(連続 N 日)` / `*タイトル*(第一著者 ほか, 年)` / `> メモの最初の 1 行(140 字まで)` / リンク。
  メモ全体は送らない。`&` `<` `>` は逃がす(`<!channel>` などが効かないように)。
- 送り方は通知の Slack と同じ(ブラウザ版は中継が無ければ no-cors のフォーム送信)。

## 11. ビルド順序

MVP は「作る順番」。UI は各段階で対話しながら変える。

### MVP
1. データ層: `papers.json` / `memos/` / `state.sqlite` の読み書き(Rust コマンド + TS ラッパ)
2. 論文リスト画面: 手入力、CSV インポート、キュー並べ替え
3. スケジューリング: 論理日、休み、今日の論文、スキップ、前日判定、連続記録
4. メモエディタと読了判定
5. LLM 抽象層 + Anthropic + Ollama、`summary` と `grade`、コスト提示、使用量記録
6. カレンダー
7. ホーム画面(シンプル機能として完成させる)

### v1
8. 学術 API + `recommend` / `rank`、論文を探す画面
9. DOI 羅列インポート、OA PDF 自動保存、全文抽出
10. 使用量画面
11. トレイ常駐 + OS 通知

### v2(2026-09-16 実装)
12. Slack / LINE 配信(10 章)
13. BibTeX インポート・エクスポート(4.2)
14. 講座(静的 Markdown。`src/content/lessons/`)、ポモドーロ(メモエディタの側面。設定でオフにできる。要否は使って判断)
15. モバイル(Tauri 2 の iOS / Android)。コードと画面は対応済み。実機ビルドは Xcode / Android SDK のある環境で行う(README 参照)

### v3(2026-09-17〜。ターゲットの絞り込み。design-questions 8 章)
16. 読了の段階(6 章)
17. 読了を Slack に共有(10.1)
18. LLM の道を広げる: OpenAI 互換プロバイダ(7.1)、Apple Intelligence(ショートカット経由)と貼り付け(7.4)
19. 差分フィードバック、要約の根拠(7.2)、コース(8.1)

## 12. 仮置き・要確認

- LLM の初期プロバイダを **Anthropic API** にしている(未指定のため)。OpenAI 等に変える場合は 7.1 の `name` と単価表を直すだけ。
- 通知の既定時刻(8:00 / 20:00 / 60 分前)も同様。
- 学術 API を OpenAlex 主にしたのはキー不要のため。Semantic Scholar はキーがあると制限が緩くなる。
