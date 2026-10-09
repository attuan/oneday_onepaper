// 研究計画書(仕様 13)。書くのは本人。AI は節を読んでコメントし、引ける論文を論文リストから挙げるだけ

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "../App";
import type { Paper, Proposal, ProposalFeedback, ProposalSection } from "@/core/types";
import { acceptCoachAnswer, apiUsable, coachCostUsd, coachPrompt, coachSection, createProposal, deleteProposal, listProposals, saveProposal } from "@/core/app";
import { CITE_RE, PROPOSAL_TEMPLATES, citeKeys, insertCitationAfter, memoQuestions, newSection, papersByKey, parseCiteGroup, sectionChars, shortLabel } from "@/core/proposal/model";
import { MIN_COACH_CHARS } from "@/core/proposal/coach";
import { formatUsd } from "@/core/usage/cost";
import { ConfirmButton } from "../components/ConfirmButton";
import { copyText } from "../clipboard";
import { ProposalExport, ProposalFigures } from "../components/ProposalFigures";

type Via = "api" | "paste";

export function ProposalPage(props: PageProps) {
  const { state } = props;
  const [list, setList] = useState<Proposal[] | null>(null);
  const [open, setOpen] = useState<Proposal | null>(null);

  const reload = () => listProposals(state).then(setList);
  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) {
    return (
      <ProposalEditor
        {...props}
        initial={open}
        onBack={() => {
          setOpen(null);
          void reload();
        }}
      />
    );
  }
  if (!list) return <p className="muted">読み込み中…</p>;
  return <ProposalList {...props} list={list} onOpen={setOpen} onDeleted={reload} />;
}

function ProposalList({ state, go, list, onOpen, onDeleted }: PageProps & { list: Proposal[]; onOpen: (p: Proposal) => void; onDeleted: () => void }) {
  const [template, setTemplate] = useState(PROPOSAL_TEMPLATES[0].id);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [creating, setCreating] = useState(list.length === 0);
  const papers = state.papers.filter((p) => p.status !== "removed").length;

  const create = async () => onOpen(await createProposal(state, template, { title, purpose }));

  return (
    <>
      <h1>研究計画書</h1>
      <p className="muted">
        計画書は自分で書きます。書いた節を AI に見せると、足りない点・聞かれそうなこと・根拠が要る文・引ける論文(あなたの論文リストにあるものだけ)が返ってきます。
        書き終えたら Word で書き出せます(LaTeX と図は任意)。
      </p>
      {papers === 0 && (
        <p className="badge">
          論文リストが空なので、引用や「引ける論文」は出ません。先に <button className="link" onClick={() => go({ name: "explore" })}>論文を探す</button> で集めておくと役に立ちます
        </p>
      )}
      {list.map((p) => (
        <div className="card" key={p.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="title">{p.title || "(題目なし)"}</div>
              <div className="muted">
                {PROPOSAL_TEMPLATES.find((t) => t.id === p.template)?.label ?? "白紙"} ・ {p.sections.length} 節 ・ {p.sections.reduce((n, s) => n + sectionChars(s.body), 0).toLocaleString()} 字 ・ 更新 {p.updated_at.slice(0, 10)}
              </div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => onOpen(p)}>開く</button>
              <ConfirmButton label="消す" confirmLabel="本当に消す" onConfirm={async () => { await deleteProposal(state, p.id); onDeleted(); }} />
            </div>
          </div>
        </div>
      ))}
      {!creating ? (
        <button className="btn secondary" onClick={() => setCreating(true)}>新しく作る</button>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>新しく作る</h2>
          <div className="field">
            <label>ひな形(節の名前・数・字数はあとから変えられます)</label>
            <div className="row pick">
              {PROPOSAL_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="card pick-card" style={t.id === template ? { borderColor: "var(--blue)", background: "var(--blue-light)" } : undefined} onClick={() => setTemplate(t.id)}>
                  <strong>{t.label}</strong>
                  <div className="muted">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>研究題目(仮でよい・あとで変えられます)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>何のための計画書か(提出先・分量など。AI に伝わります)</label>
            <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 卒業研究の着手時に研究室に出す。A4 2 枚まで" />
          </div>
          <div className="row">
            <button className="btn" onClick={create}>作る</button>
            {list.length > 0 && <button className="btn secondary" onClick={() => setCreating(false)}>やめる</button>}
          </div>
        </div>
      )}
    </>
  );
}

function ProposalEditor({ state, go, initial, onBack }: PageProps & { initial: Proposal; onBack: () => void }) {
  const [p, setP] = useState(initial);
  const [saved, setSaved] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [via, setVia] = useState<Via>("paste");
  const [apiOk, setApiOk] = useState(false);
  const latest = useRef({ p, dirty: false });
  const byKey = useMemo(() => papersByKey(state.papers), [state.papers]);
  const keyOf = useMemo(() => citeKeys(state.papers), [state.papers]);

  useEffect(() => {
    apiUsable(state.settings).then((ok) => {
      setApiOk(ok);
      setVia(ok && state.settings.llm.summary_via !== "paste" ? "api" : "paste");
    });
  }, [state.settings]);

  const update = (fn: (prev: Proposal) => Proposal) => {
    setP((prev) => {
      const next = fn(prev);
      latest.current = { p: next, dirty: true };
      return next;
    });
    setSaved("dirty");
  };

  // 書くたびに少し待ってから保存する。画面を離れるときも保存する
  useEffect(() => {
    if (!latest.current.dirty) return;
    const id = setTimeout(async () => {
      setSaved("saving");
      try {
        await saveProposal(state, latest.current.p);
        latest.current.dirty = false;
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    }, 700);
    return () => clearTimeout(id);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (latest.current.dirty) void saveProposal(state, latest.current.p);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setSection = (id: string, patch: Partial<ProposalSection>) => update((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) =>
    update((prev) => {
      const xs = [...prev.sections];
      const j = i + d;
      if (j < 0 || j >= xs.length) return prev;
      [xs[i], xs[j]] = [xs[j], xs[i]];
      return { ...prev, sections: xs };
    });

  const questions = useMemo(() => memoQuestions(state.papers, state.memos), [state.papers, state.memos]);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="row">
          <button className="btn secondary small" onClick={onBack}>← 一覧へ</button>
          <span className="muted">{{ saved: "保存しました", dirty: "未保存", saving: "保存中…", error: "保存に失敗しました" }[saved]}</span>
        </div>
        <div className="row">
          <span className="muted">AI の使い方</span>
          <select value={via} onChange={(e) => setVia(e.target.value as Via)}>
            {apiOk && <option value="api">API({state.settings.llm.model})</option>}
            <option value="paste">好きな AI に貼り付ける(キー不要)</option>
          </select>
        </div>
      </div>
      <div className="proposal">
        <div>
          <div className="card">
            <div className="field">
              <label>研究題目</label>
              <input className="proposal-title" value={p.title} onChange={(e) => update((x) => ({ ...x, title: e.target.value }))} placeholder="研究題目" />
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>氏名(任意)</label>
                <input value={p.author} onChange={(e) => update((x) => ({ ...x, author: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>所属(任意)</label>
                <input value={p.affiliation} onChange={(e) => update((x) => ({ ...x, affiliation: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>何のための計画書か(提出先・分量など。書き出しには出ず、AI にだけ伝わります)</label>
              <textarea rows={2} value={p.purpose} onChange={(e) => update((x) => ({ ...x, purpose: e.target.value }))} placeholder="例: 大学院入試の出願書類。2000 字以内" />
            </div>
          </div>

          {p.sections.map((s, i) => (
            <SectionCard
              key={s.id}
              state={state}
              go={go}
              proposal={p}
              section={s}
              index={i}
              total={p.sections.length}
              via={via}
              byKey={byKey}
              keyOf={keyOf}
              onChange={(patch) => setSection(s.id, patch)}
              onMove={(d) => move(i, d)}
              onDelete={() => update((x) => ({ ...x, sections: x.sections.filter((y) => y.id !== s.id) }))}
            />
          ))}
          <button className="btn secondary" style={{ marginBottom: 16 }} onClick={() => update((x) => ({ ...x, sections: [...x.sections, newSection("新しい節")] }))}>節を足す</button>

          <ProposalFigures state={state} proposal={p} update={update} byKey={byKey} keyOf={keyOf} />
          <ProposalExport state={state} proposal={p} byKey={byKey} />
        </div>

        <aside className="side">
          <div className="card">
            <strong>書き方</strong>
            <ul className="muted" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
              <li>空行で段落が変わります</li>
              <li>行頭に「- 」で箇条書き</li>
              <li>**ここ** で太字</li>
              <li>引用は「引用を入れる」から。本文には [@キー] と入り、書き出すと [1] のような番号になります</li>
            </ul>
          </div>
          <div className="card">
            <strong>問いの種(メモの「疑問・批判」)</strong>
            {questions.length === 0 ? (
              <p className="muted">メモの「疑問・批判」に書いたことがここに集まります。研究の問いや「まだ分かっていないこと」の材料になります。</p>
            ) : (
              <>
                <p className="muted">読んだときに引っかかったことです。研究の問いや「まだ分かっていないこと」の材料に。</p>
                {questions.slice(0, 12).map((q) => (
                  <div key={q.paper.id} className="seed">
                    <div className="muted">{shortLabel(q.paper)}{keyOf.get(q.paper.id) && <> ・ <code>[@{keyOf.get(q.paper.id)}]</code></>}</div>
                    <div>{q.text.length > 160 ? `${q.text.slice(0, 160)}…` : q.text}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function SectionCard({
  state,
  go,
  proposal,
  section: s,
  index,
  total,
  via,
  byKey,
  keyOf,
  onChange,
  onMove,
  onDelete,
}: Pick<PageProps, "state" | "go"> & {
  proposal: Proposal;
  section: ProposalSection;
  index: number;
  total: number;
  via: Via;
  byKey: Map<string, Paper>;
  keyOf: Map<string, string>;
  onChange: (patch: Partial<ProposalSection>) => void;
  onMove: (d: number) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [picking, setPicking] = useState(false);
  const chars = sectionChars(s.body);
  const over = s.limit !== null && chars > s.limit;
  const cited = useMemo(() => {
    const keys = new Set<string>();
    for (const m of s.body.matchAll(CITE_RE)) for (const k of parseCiteGroup(m[1])) keys.add(k);
    return [...keys];
  }, [s.body]);

  /** 最後にカーソルがあった位置。まだ触っていなければ末尾に入れる */
  const caret = useRef<number | null>(null);
  const remember = () => (caret.current = ref.current?.selectionEnd ?? null);
  /** カーソルの位置に [@key] を入れる */
  const insertKey = (key: string) => {
    const pos = Math.min(caret.current ?? s.body.length, s.body.length);
    const tag = `[@${key}]`;
    onChange({ body: `${s.body.slice(0, pos)}${tag}${s.body.slice(pos)}` });
    caret.current = pos + tag.length;
    setPicking(false);
  };

  return (
    <div className="card proposal-section">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <input className="section-heading" value={s.heading} onChange={(e) => onChange({ heading: e.target.value })} placeholder="見出し" />
        <span className={over ? "error" : "muted"} style={{ whiteSpace: "nowrap" }}>
          {chars.toLocaleString()} 字{s.limit !== null && ` / ${s.limit.toLocaleString()} 字`}
        </span>
      </div>
      {s.hint && <p className="muted" style={{ margin: "2px 0 8px" }}>{s.hint}</p>}
      <textarea ref={ref} className="section-body" rows={Math.max(6, s.body.split("\n").length + 1)} value={s.body} onChange={(e) => { onChange({ body: e.target.value }); caret.current = e.target.selectionEnd; }} onSelect={remember} onClick={remember} placeholder="ここに自分で書きます" />
      {cited.length > 0 && (
        <div className="muted cites">
          {cited.map((k) => {
            const paper = byKey.get(k);
            return (
              <span key={k} className={paper ? "" : "error"}>
                [@{k}] {paper ? paper.title : "論文リストにありません(書き出すと [?] になります)"}
              </span>
            );
          })}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn secondary small" onClick={() => setPicking(!picking)}>引用を入れる</button>
        <details className="section-settings">
          <summary className="muted">節の設定</summary>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="muted">
              字数の上限{" "}
              <input type="number" min={0} style={{ width: 90 }} value={s.limit ?? ""} onChange={(e) => onChange({ limit: e.target.value ? Math.max(0, Number(e.target.value)) : null })} placeholder="なし" />
            </label>
            <button className="btn secondary small" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
            <button className="btn secondary small" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
            <ConfirmButton label="この節を消す" confirmLabel="本当に消す" onConfirm={onDelete} />
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>この節に書くこと(AI にこの節の役割として伝わります)</label>
            <input value={s.hint} onChange={(e) => onChange({ hint: e.target.value })} />
          </div>
        </details>
      </div>
      {picking && <CitePicker state={state} keyOf={keyOf} onPick={insertKey} onClose={() => setPicking(false)} go={go} />}
      <SectionCoach
        state={state}
        proposal={proposal}
        section={s}
        via={via}
        byKey={byKey}
        onFeedback={(feedback) => onChange({ feedback })}
        onInsertAfter={(sentence, key) => {
          const body = insertCitationAfter(s.body, sentence, key);
          if (body) onChange({ body });
        }}
        onInsertKey={insertKey}
      />
    </div>
  );
}

function CitePicker({ state, keyOf, onPick, onClose, go }: Pick<PageProps, "state" | "go"> & { keyOf: Map<string, string>; onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const read = new Set(state.memos.filter((m) => m.frontmatter.completed).map((m) => m.frontmatter.paper_id));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = state.papers
    .filter((p) => p.status !== "removed")
    .filter((p) => words.every((w) => `${p.title} ${p.authors.join(" ")} ${p.year ?? ""} ${keyOf.get(p.id)}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(read.has(b.id)) - Number(read.has(a.id)))
    .slice(0, 30);
  return (
    <div className="cite-picker">
      <div className="row">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトル・著者・年で絞り込む" style={{ flex: 1 }} />
        <button className="btn secondary small" onClick={onClose}>閉じる</button>
      </div>
      {hits.length === 0 ? (
        <p className="muted">
          論文リストに合うものがありません。<button className="link" onClick={() => go({ name: "explore" })}>論文を探す</button> で足せます。
        </p>
      ) : (
        <ul>
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" className="cal-entry" onClick={() => onPick(keyOf.get(p.id)!)}>
                <span className="t">{p.title}</span>
                <span className="muted"> {shortLabel(p)}{read.has(p.id) ? " ・ 読んだ" : " ・ 未読"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">読んでいない論文を引くときは、引用する前に中身を確かめてください。</p>
    </div>
  );
}

function SectionCoach({
  state,
  proposal,
  section,
  via,
  byKey,
  onFeedback,
  onInsertAfter,
  onInsertKey,
}: {
  state: PageProps["state"];
  proposal: Proposal;
  section: ProposalSection;
  via: Via;
  byKey: Map<string, Paper>;
  onFeedback: (fb: ProposalFeedback | null) => void;
  onInsertAfter: (sentence: string, key: string) => void;
  onInsertKey: (key: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [manual, setManual] = useState(false);
  const [answer, setAnswer] = useState("");
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fb = section.feedback;
  const enough = sectionChars(section.body) >= MIN_COACH_CHARS;

  const runApi = async () => {
    setRunning(true);
    setErr(null);
    try {
      onFeedback(await coachSection(state, proposal, section.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handOff = async () => {
    setErr(null);
    try {
      const text = coachPrompt(state, proposal, section.id);
      setPrompt(text);
      if (await copyText(text, promptRef.current)) {
        setHandedOff(true);
        setNote("頼む文面をコピーしました。ChatGPT や Claude などに貼り、返ってきた JSON をコピーして戻ってきてください。");
      } else {
        setManual(true);
        setErr("クリップボードに書き込めませんでした。下の欄から手でコピーしてください");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const accept = (raw: string) => {
    setErr(null);
    try {
      onFeedback(acceptCoachAnswer(state, proposal, section.id, raw));
      setNote(null);
      setAnswer("");
      setHandedOff(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setAnswer(raw);
      setManual(true);
    }
  };

  const pasteAnswer = async () => {
    try {
      accept(await navigator.clipboard.readText());
    } catch {
      setManual(true);
      setErr("クリップボードを読めませんでした。下の「AI の回答」欄に貼り付けて「読み込む」を押してください");
    }
  };

  const title = (k: string) => byKey.get(k)?.title ?? k;

  return (
    <div className="coach">
      {!enough && !fb && <p className="muted">{MIN_COACH_CHARS} 字以上書くと、AI に見てもらえます。</p>}
      {enough && (
        <div className="row">
          {via === "api" ? (
            <button className="btn small" disabled={running} onClick={runApi}>
              {running ? "読んでもらっています…" : `${fb ? "もう一度" : "AI に"}見てもらう(約 ${formatUsd(coachCostUsd(state, proposal, section.id))})`}
            </button>
          ) : (
            <>
              <button className={handedOff ? "btn secondary small" : "btn small"} onClick={handOff}>1. 頼む文面をコピー</button>
              <button className={handedOff ? "btn small" : "btn secondary small"} onClick={pasteAnswer}>2. 回答を貼り付ける</button>
            </>
          )}
        </div>
      )}
      {note && <p className="muted">{note}</p>}
      {via === "paste" && enough && (
        <details open={manual} onToggle={(e) => setManual(e.currentTarget.open)}>
          <summary className="muted">うまくいかないとき(手でコピー・貼り付け)</summary>
          <div className="field">
            <label>頼む文面</label>
            <textarea ref={promptRef} rows={3} readOnly value={prompt} placeholder="「1. 頼む文面をコピー」を押すとここに出ます" onClick={(e) => e.currentTarget.setSelectionRange(0, prompt.length)} />
          </div>
          <div className="field">
            <label>AI の回答</label>
            <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{"good_points": [...], ...}' />
          </div>
          <button className="btn secondary small" disabled={!answer.trim()} onClick={() => accept(answer)}>読み込む</button>
        </details>
      )}
      {err && <p className="error">{err}</p>}
      {fb && (
        <div className="feedback">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>AI のコメント</strong>
            <button className="link" onClick={() => onFeedback(null)}>閉じる</button>
          </div>
          {fb.body_seen !== section.body && <p className="muted">このあと書き直しています。直したら、もう一度見てもらえます。</p>}
          <List title="よく書けている点" items={fb.good_points} />
          <List title="足りない・曖昧なところ" items={fb.missing_points} />
          <List title="聞かれそうなこと(答えを本文に書けるか考えてみてください)" items={fb.questions} />
          {fb.needs_citation.length > 0 && (
            <>
              <div className="muted">根拠(引用)が要りそうな文</div>
              {fb.needs_citation.map((n, i) => (
                <div key={i} className="need-cite">
                  <blockquote className="evidence">{n.sentence}</blockquote>
                  {n.keys.length ? (
                    <div className="row">
                      {n.keys.map((k) => (
                        <button key={k} className="btn secondary small" disabled={!section.body.includes(n.sentence.trim())} onClick={() => onInsertAfter(n.sentence, k)} title="この文の後ろに引用を入れる">
                          {shortLabel(byKey.get(k)!)} を入れる
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">論文リストには合うものがなさそうです。論文を探すで探すか、根拠の要らない言い方にできるか考えてみてください。</p>
                  )}
                </div>
              ))}
            </>
          )}
          {fb.suggested.length > 0 && (
            <>
              <div className="muted">この節で引けそうな論文(論文リストから)</div>
              <ul>
                {fb.suggested.map((sg) => (
                  <li key={sg.key}>
                    <strong>{title(sg.key)}</strong> <span className="muted">{sg.reason}</span>{" "}
                    <button className="link" onClick={() => onInsertKey(sg.key)}>カーソル位置に入れる</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {fb.next_step && <p><strong>次の一歩</strong> {fb.next_step}</p>}
          <p className="muted">論文は AI がタイトルとメモから選んだものです。引用する前に、本当にそう書いてあるかを論文で確かめてください。</p>
        </div>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <div className="muted">{title}</div>
      <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </>
  );
}
