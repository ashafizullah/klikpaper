// A small, safe Markdown subset for chat replies: everything is escaped first,
// then paragraphs, lists, headings, code, bold/italic and page citations are
// added back as known tags. No raw HTML, images or links from the model.

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[(?:p|pp|hal|hlm)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/gi, (_m, a, b) => `<button class="cite" data-page="${a}">p. ${a}${b ? `–${b}` : ""}</button>`);
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r/g, "").split("\n");
  let html = "";
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  let code: string[] | null = null;
  const flushPara = () => {
    if (para.length) html += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        html += `<pre><code>${escape(code.join("\n"))}</code></pre>`;
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      code = [];
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      html += `<h4>${inline(heading[2])}</h4>`;
    } else if (bullet || numbered) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${inline((bullet ?? numbered)![1])}</li>`;
    } else if (!line.trim()) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  if (code) html += `<pre><code>${escape(code.join("\n"))}</code></pre>`;
  flushPara();
  closeList();
  return html;
}
