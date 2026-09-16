// 講座(仕様 11 v2)用の小さな Markdown レンダラ。依存を増やさないために自前で持つ。
// 対応: 見出し、段落、箇条書き(- と 1.)、引用、コードブロック、太字、コード、リンク、区切り線。
// 入力は同梱の講座テキストだけなので、これで足りる。出力前に必ずエスケープする

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 行内の記法。先にエスケープしてから置き換える */
export function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c: string) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return s;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${renderInline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushAll();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    const oli = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (li || oli) {
      flushPara();
      flushQuote();
      const tag = li ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((li ?? oli)![1]);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    // 箇条書きの続きの行(字下げ)は同じ項目につなぐ
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}

/** 最初の見出しをタイトルにする。無ければ null */
export function markdownTitle(md: string): string | null {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : null;
}
