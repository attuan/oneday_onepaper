// 仕様書 4 章のデータ形式に対応する型

export type PaperStatus = "unread" | "read" | "skipped" | "removed";
export type PaperSource = "llm" | "manual" | "import";

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

export interface MemoFrontmatter {
  paper_id: string;
  date: string;
  chars: number;
  completed: boolean;
  summary_input: SummaryInput;
  score_total: number | null;
}

export interface Memo {
  path: string;
  frontmatter: MemoFrontmatter;
  body: string;
}

export type LlmProviderName = "anthropic" | "ollama";
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
  min_memo_chars: number;
  extra_read_reward: "none" | "grace";
  language: "ja" | "en";
  llm: {
    provider: LlmProviderName;
    model: string;
    base_url: string | null; // ollama 用
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
  min_memo_chars: 200,
  extra_read_reward: "none",
  language: "ja",
  llm: { provider: "anthropic", model: "claude-opus-5", base_url: null },
  grace: { enabled: false, per_month: 0 },
  search: { sources: ["openalex", "semanticscholar", "arxiv"] },
  notifications: {
    morning: "08:00",
    evening: "20:00",
    last_call_minutes_before: 60,
    channels: ["os"],
    line_to: "",
  },
  pomodoro: { enabled: true, work_minutes: 25, break_minutes: 5 },
};

export interface SummaryOutput {
  problem: string;
  method: string;
  results: string;
  limitations: string;
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
  missing_points?: string[]; // 全文入力のときだけ
}
