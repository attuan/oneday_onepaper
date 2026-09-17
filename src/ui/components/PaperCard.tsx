import { opener } from "@/core/store/backend";
import type { Paper } from "@/core/types";

export function PaperMeta({ paper }: { paper: Paper }) {
  const bits = [paper.authors.join(", "), paper.year, paper.venue].filter(Boolean);
  return <div className="muted">{paper.kind === "article" && <span className="badge">記事</span>} {bits.join(" · ") || "書誌情報なし"}</div>;
}

export function PaperLinks({ paper }: { paper: Paper }) {
  const links: { label: string; url: string }[] = [];
  if (paper.pdf_url) links.push({ label: "PDF", url: paper.pdf_url });
  if (paper.url) links.push({ label: "リンク", url: paper.url });
  if (paper.doi && !paper.url) links.push({ label: "DOI", url: `https://doi.org/${paper.doi}` });
  if (!links.length) return null;
  return (
    <div className="row" style={{ marginTop: 8 }}>
      {links.map((l) => (
        <button key={l.url} className="link" onClick={() => opener.url(l.url)}>
          {l.label} ↗
        </button>
      ))}
    </div>
  );
}
