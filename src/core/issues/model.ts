// 論点の台帳(仕様 7.6)。分野の中身の問いを、読んだ論文ごとに更新していく。
// 論点 = 分野の問い(「〜か?」)と、それへの今の自分の理解。論文は論点に対して、提起・支持・反する・条件を付ける のどれかでつながる。
// 純粋な関数だけを置く。保存は store/issues.ts、LLM は issues/llm.ts

export type Stance = "raises" | "supports" | "challenges" | "refines";

export const STANCE_LABELS: Record<Stance, string> = { raises: "提起", supports: "支持", challenges: "反する", refines: "条件を付ける" };
export const STANCES: Stance[] = ["raises", "supports", "challenges", "refines"];

export interface IssueView {
  at: string;
  /** この理解に更新したきっかけの論文。手で書き直したときは null */
  paper_id: string | null;
  text: string;
}

export interface Issue {
  id: string;
  question: string;
  status: "open" | "settled";
  created_at: string;
  updated_at: string;
  /** 今の理解の移り変わり。最後が今の理解 */
  views: IssueView[];
}

export interface IssueLink {
  issue_id: string;
  paper_id: string;
  stance: Stance;
  /** この論文がその論点について何を言っているか(1〜2 文) */
  note: string;
  /** メモの中で自分から触れていたか。AI だけが見つけたつながりは false */
  in_memo: boolean;
  /** つないだときに、その論点がすでにあったか(新しく立てた論点なら false)。「過去の論点を踏まえて書けたか」はこれが true のものだけで数える */
  existed: boolean;
  at: string;
}

export interface IssuesFile {
  version: 1;
  issues: Issue[];
  links: IssueLink[];
}

export const emptyIssues = (): IssuesFile => ({ version: 1, issues: [], links: [] });

export function currentView(issue: Issue): string {
  return issue.views[issue.views.length - 1]?.text ?? "";
}

/** 壊れた・古いファイルでも読めるように整える */
export function normalizeIssues(raw: unknown): IssuesFile {
  const r = (raw ?? {}) as Partial<IssuesFile>;
  const issues = (Array.isArray(r.issues) ? r.issues : []).filter((i): i is Issue => !!i && typeof i.id === "string" && typeof i.question === "string").map((i) => ({
    ...i,
    status: i.status === "settled" ? ("settled" as const) : ("open" as const),
    views: Array.isArray(i.views) ? i.views.filter((v) => v && typeof v.text === "string") : [],
  }));
  const ids = new Set(issues.map((i) => i.id));
  const links = (Array.isArray(r.links) ? r.links : []).filter((l): l is IssueLink => !!l && ids.has(l.issue_id) && typeof l.paper_id === "string" && STANCES.includes(l.stance));
  return { version: 1, issues, links };
}

/** LLM に見せる論点。未解決を先に、最近触ったものから。多すぎるとプロンプトが長くなるので上限を切る */
export function issuesForPrompt(file: IssuesFile, max = 30): Issue[] {
  return [...file.issues].sort((a, b) => (a.status === b.status ? b.updated_at.localeCompare(a.updated_at) : a.status === "open" ? -1 : 1)).slice(0, max);
}

// ---- 提案(LLM が返したもの)と、その適用 ----

export interface LinkProposal {
  issue_id: string;
  stance: Stance;
  note: string;
  in_memo: boolean;
  /** 今の理解をこう書き換えたらどうか。変えなくてよければ空 */
  new_view: string;
}

export interface NewIssueProposal {
  question: string;
  stance: Stance;
  note: string;
  in_memo: boolean;
  view: string;
}

export interface IssueProposals {
  links: LinkProposal[];
  new_issues: NewIssueProposal[];
}

/** 画面で選んだもの。use = 取り入れる、useView = 理解の書き換えも取り入れる */
export interface AcceptedProposals {
  links: (LinkProposal & { use: boolean; useView: boolean })[];
  new_issues: (NewIssueProposal & { use: boolean })[];
}

/**
 * 選んだ提案を台帳に入れる。同じ論文と論点のつながりは置き換える(やり直したとき二重にしない)。
 * newId は論点の ID を作る(テストで差し替える)
 */
export function applyProposals(file: IssuesFile, paperId: string, accepted: AcceptedProposals, now: string, newId: () => string): IssuesFile {
  let issues = [...file.issues];
  const links = [...file.links];
  const putLink = (l: IssueLink) => {
    const i = links.findIndex((x) => x.issue_id === l.issue_id && x.paper_id === l.paper_id);
    if (i >= 0) links[i] = { ...l, existed: links[i].existed };
    else links.push(l);
  };
  for (const p of accepted.links) {
    if (!p.use || !issues.some((i) => i.id === p.issue_id)) continue;
    putLink({ issue_id: p.issue_id, paper_id: paperId, stance: p.stance, note: p.note, in_memo: p.in_memo, existed: true, at: now });
    issues = issues.map((i) =>
      i.id !== p.issue_id ? i : { ...i, updated_at: now, views: p.useView && p.new_view.trim() && p.new_view.trim() !== currentView(i) ? [...i.views, { at: now, paper_id: paperId, text: p.new_view.trim() }] : i.views },
    );
  }
  for (const n of accepted.new_issues) {
    if (!n.use || !n.question.trim()) continue;
    const id = newId();
    issues.push({ id, question: n.question.trim(), status: "open", created_at: now, updated_at: now, views: n.view.trim() ? [{ at: now, paper_id: paperId, text: n.view.trim() }] : [] });
    putLink({ issue_id: id, paper_id: paperId, stance: n.stance, note: n.note, in_memo: n.in_memo, existed: false, at: now });
  }
  return { version: 1, issues, links };
}

export function updateIssue(file: IssuesFile, id: string, patch: { question?: string; status?: Issue["status"]; view?: string }, now: string): IssuesFile {
  return {
    ...file,
    issues: file.issues.map((i) => {
      if (i.id !== id) return i;
      const views = patch.view !== undefined && patch.view.trim() !== currentView(i) ? [...i.views, { at: now, paper_id: null, text: patch.view.trim() }] : i.views;
      return { ...i, question: patch.question?.trim() || i.question, status: patch.status ?? i.status, views, updated_at: now };
    }),
  };
}

export function removeIssue(file: IssuesFile, id: string): IssuesFile {
  return { ...file, issues: file.issues.filter((i) => i.id !== id), links: file.links.filter((l) => l.issue_id !== id) };
}

export function removeLink(file: IssuesFile, issueId: string, paperId: string): IssuesFile {
  return { ...file, links: file.links.filter((l) => !(l.issue_id === issueId && l.paper_id === paperId)) };
}

// ---- 数える ----

export interface RecallPoint {
  paper_id: string;
  at: string;
  /** すでにあった論点へのつながりの数 */
  linked: number;
  /** そのうち、メモで自分から触れていた数 */
  noticed: number;
}

/**
 * 論文ごとの「過去の論点を踏まえて書けたか」。古い順。
 * 新しく立てた論点へのつながりは数えない(その論文で初めて出た問いなので、踏まえようがない)
 */
export function recallSeries(file: IssuesFile): RecallPoint[] {
  const by = new Map<string, RecallPoint>();
  for (const l of file.links) {
    if (!l.existed) continue;
    const p = by.get(l.paper_id) ?? { paper_id: l.paper_id, at: l.at, linked: 0, noticed: 0 };
    p.linked++;
    if (l.in_memo) p.noticed++;
    if (l.at < p.at) p.at = l.at;
    by.set(l.paper_id, p);
  }
  return [...by.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// ---- ネットワークの配置 ----

export interface GraphNode {
  id: string;
  kind: "issue" | "paper";
  /** 論点ならつながっている論文の数、論文なら論点の数 */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  link: IssueLink;
}

export const paperNodeId = (paperId: string) => `p:${paperId}`;
export const issueNodeId = (issueId: string) => `i:${issueId}`;

export function buildGraph(file: IssuesFile, opts: { includeSettled: boolean }): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const issues = file.issues.filter((i) => opts.includeSettled || i.status === "open");
  const shown = new Set(issues.map((i) => i.id));
  const links = file.links.filter((l) => shown.has(l.issue_id));
  const deg = new Map<string, number>();
  for (const l of links) {
    deg.set(issueNodeId(l.issue_id), (deg.get(issueNodeId(l.issue_id)) ?? 0) + 1);
    deg.set(paperNodeId(l.paper_id), (deg.get(paperNodeId(l.paper_id)) ?? 0) + 1);
  }
  const papers = [...new Set(links.map((l) => l.paper_id))];
  return {
    nodes: [
      ...issues.map((i) => ({ id: issueNodeId(i.id), kind: "issue" as const, degree: deg.get(issueNodeId(i.id)) ?? 0 })),
      ...papers.map((p) => ({ id: paperNodeId(p), kind: "paper" as const, degree: deg.get(paperNodeId(p)) ?? 0 })),
    ],
    edges: links.map((l) => ({ source: paperNodeId(l.paper_id), target: issueNodeId(l.issue_id), link: l })),
  };
}

/** 文字列から決まる疑似乱数。同じデータなら毎回同じ配置になる */
function seeded(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * 力学モデルで配置する(つながりはばね、ノード同士は反発、中心へ弱く引く)。
 * fixed に入っているノードは動かさない(ドラッグで置いた位置)。返す座標は width × height の中
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  fixed: Map<string, { x: number; y: number }> = new Map(),
  iterations = 300,
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const f = fixed.get(n.id);
    const a = seeded(n.id) * Math.PI * 2;
    const r = (0.15 + 0.3 * seeded(`${n.id}#r`)) * Math.min(width, height);
    pos.set(n.id, f ? { ...f } : { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.6;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    const disp = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!;
        const b = pos.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = seeded(nodes[i].id + nodes[j].id) - 0.5;
          dy = 0.5 - seeded(nodes[j].id + nodes[i].id);
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        const di = disp.get(nodes[i].id)!;
        const dj = disp.get(nodes[j].id)!;
        di.x += (dx / d) * f;
        di.y += (dy / d) * f;
        dj.x -= (dx / d) * f;
        dj.y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      const da = disp.get(e.source)!;
      const db = disp.get(e.target)!;
      da.x -= (dx / d) * f;
      da.y -= (dy / d) * f;
      db.x += (dx / d) * f;
      db.y += (dy / d) * f;
    }
    const step = Math.max(1, k * 0.5 * t);
    for (const n of nodes) {
      if (fixed.has(n.id)) continue;
      const p = pos.get(n.id)!;
      const d = disp.get(n.id)!;
      // 中心へ弱く引く。つながりの無い論点が端に飛ばないように
      d.x += (cx - p.x) * 0.05 * k * 0.1;
      d.y += (cy - p.y) * 0.05 * k * 0.1;
      const len = Math.max(0.01, Math.hypot(d.x, d.y));
      p.x += (d.x / len) * Math.min(len, step);
      p.y += (d.y / len) * Math.min(len, step);
    }
  }
  const margin = 24;
  for (const p of pos.values()) {
    p.x = Math.max(margin, Math.min(width - margin, p.x));
    p.y = Math.max(margin, Math.min(height - margin, p.y));
  }
  return pos;
}
