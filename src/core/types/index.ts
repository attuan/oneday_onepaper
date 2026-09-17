// 仕様書 4 章のデータ形式に対応する型

export type PaperStatus = "unread" | "read" | "skipped" | "removed";
export type PaperSource = "llm" | "manual" | "import";

/** コースの中での役割(仕様 8.1)。全体像 → 基礎 → 最近 の順に読む */
export type CourseStage = "survey" | "classic" | "recent";

export interface PaperCourse {
  id: string;
  title: string;
  /** コースの中での順番(1 始まり) */
  step: number;
  stage: CourseStage;
}

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdf_url: string | null;
  abstract: string | null;
  reason: string | null;
  source: PaperSource;
  status: PaperStatus;
  queue_order: number;
  added_at: string;
  read_at: string | null;
  skip_count: number;
  bibtex: string | null;
  fulltext_tokens: number | null;
  /** 無ければ paper。article は Web の記事(URL とタイトルだけ持つ) */
  kind?: "paper" | "article";
  /** 入っているコース。コースを入れる前の papers.json には列が無い */
  course?: PaperCourse | null;
}

export interface PapersFile {
  version: 1;
  papers: Paper[];
}

export type DayKind = "read" | "rest" | "grace" | "missed";

export interface DayLog {
  date: string; // YYYY-MM-DD (論理日)
  kind: DayKind;
  paper_ids: string[];
  streak: number;
}

export type SummaryInput = "abstract" | "fulltext" | "pasted" | "none";

/** 読了の段階(仕様 6)。0 = 未読了、1 = ひとこと、2 = 要点、3 = しっかり */
export type ReadLevel = 0 | 1 | 2 | 3;

export interface MemoFrontmatter {
  paper_id: string;
  date: string;
  chars: number;
  /** level >= 1 と同じ。連続記録はこれだけを見る */
  completed: boolean;
  /** これまでに届いた一番上の段階。下がらない */
  level: ReadLevel;
  summary_input: SummaryInput;
  score_total: number | null;
}

export interface Memo {
  path: string;
  frontmatter: MemoFrontmatter;
  body: string;
}

/** openai は OpenAI 互換の行き先すべて(OpenAI / Gemini / OpenRouter / LM Studio など) */
export type LlmProviderName = "anthropic" | "ollama" | "openai";
/**
 * 要約と採点をどこで実行するか(仕様 7.4)。
 * api = 上のプロバイダ、shortcut = Apple のショートカット経由で Apple Intelligence、paste = プロンプトを好きな AI に貼る。
 * auto は、API が使えれば api、だめなら Apple の端末で shortcut、それ以外は paste
 */
export type AiVia = "auto" | "api" | "shortcut" | "paste";
/** 論文検索のソース。一覧と説明は core/scholar/sources.ts */
export type SourceId = "openalex" | "semanticscholar" | "crossref" | "arxiv" | "pubmed" | "cinii" | "jstage";
export type LlmTask = "recommend" | "rank" | "summary" | "grade";

export interface LlmUsageRow {
  at: string;
  provider: LlmProviderName;
  model: string;
  task: LlmTask;
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
}

export interface RestPeriod {
  from: string;
  to: string;
}

/** 通知の配信先。os はデスクトップ / ブラウザの通知、slack と line は Webhook / Messaging API */
export type NotifyChannel = "os" | "slack" | "line";

export interface Settings {
  data_dir: string;
  day_boundary_hour: number;
  rest_weekdays: number[]; // 0=日 … 6=土
  rest_periods: RestPeriod[];
  /** Lv1「ひとこと」の文字数。ここで読了が成立する */
  quick_memo_chars: number;
  /** Lv2「要点」の文字数 */
  standard_memo_chars: number;
  /** Lv3「しっかり」の文字数(段階を入れる前はこれが読了の条件だった) */
  min_memo_chars: number;
  extra_read_reward: "none" | "grace";
  language: "ja" | "en";
  llm: {
    provider: LlmProviderName;
    model: string;
    base_url: string | null; // ollama と openai 用
    summary_via: AiVia;
    /** shortcut で呼ぶショートカットの名前 */
    shortcut_name: string;
  };
  grace: { enabled: boolean; per_month: number };
  search: {
    /** 「論文を探す」で既定でオンにするソース */
    sources: SourceId[];
  };
  notifications: {
    morning: string;
    evening: string;
    last_call_minutes_before: number;
    channels: NotifyChannel[];
    /** LINE の送信先(ユーザー ID)。トークンは secret に置く */
    line_to: string;
  };
  /** 読了を研究室などの Slack に投稿する(仕様 10.1)。Webhook URL は secret に置く */
  share: {
    slack_on_complete: boolean;
    /** 投稿に出す名前。空なら名前なしで投稿する */
    display_name: string;
  };
  /** ポモドーロ(仕様 11 v2)。要るかどうか判断するため、まずは載せておく */
  pomodoro: {
    enabled: boolean;
    work_minutes: number;
    break_minutes: number;
  };
}

export const DEFAULT_SETTINGS: Omit<Settings, "data_dir"> = {
  day_boundary_hour: 4,
  rest_weekdays: [],
  rest_periods: [],
  quick_memo_chars: 20,
  standard_memo_chars: 80,
  min_memo_chars: 200,
  extra_read_reward: "none",
  language: "ja",
  llm: { provider: "anthropic", model: "claude-opus-5", base_url: null, summary_via: "auto", shortcut_name: "OneDayOnePaper" },
  grace: { enabled: false, per_month: 0 },
  search: { sources: ["openalex", "semanticscholar", "arxiv"] },
  notifications: {
    morning: "08:00",
    evening: "20:00",
    last_call_minutes_before: 60,
    channels: ["os"],
    line_to: "",
  },
  share: { slack_on_complete: false, display_name: "" },
  pomodoro: { enabled: true, work_minutes: 25, break_minutes: 5 },
};

export type SummaryField = "problem" | "method" | "results" | "limitations";

/** 要約の根拠(仕様 7.2)。quote は LLM が原文から抜き出したと言っている文、found はそれが渡したテキストに本当にあったか */
export interface SummaryEvidence {
  field: SummaryField;
  quote: string;
  found: boolean;
}

export interface SummaryOutput {
  problem: string;
  method: string;
  results: string;
  limitations: string;
  /** 入れる前の要約には無い */
  evidence?: SummaryEvidence[];
}

export interface GradeItem {
  name: string;
  score: number; // 1-5
  comment: string;
}

export interface GradeOutput {
  items: GradeItem[];
  total: number;
  overall_comment: string;
  /** 渡した論文情報にあってメモにない点 */
  missing_points?: string[];
  // 差分フィードバック(仕様 7.2)。点数より先に見せる。入れる前の採点には無い
  /** メモのうち、よく捉えている点 */
  good_points?: string[];
  /** メモが論文と食い違っているかもしれない点 */
  misreadings?: string[];
  /** 次に読む・書くときの一歩(1 文) */
  next_step?: string;
}
