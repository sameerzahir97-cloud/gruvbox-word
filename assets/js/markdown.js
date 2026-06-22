// markdown.js — live Markdown input shortcuts + HTML <-> Markdown conversion

const ZWSP = "​";

/* ---------- helpers ---------- */

export function topBlock(editor, node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  while (el && el !== editor && el.parentElement !== editor) el = el.parentElement;
  return el && el !== editor ? el : null;
}

function inCodeContext(node) {
  let el = node.nodeType === 3 ? node.parentElement : node;
  return !!(el && el.closest && el.closest("pre, code"));
}

/* ---------- block-level shortcuts (fired on Space) ---------- */
// Returns true if it consumed the space and transformed the block.
export function tryBlockShortcut(editor, execCmd, onTask) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (inCodeContext(range.startContainer)) return false;

  const block = topBlock(editor, range.startContainer);
  // Allow paragraphs, headings, and bare top-level text (e.g. a freshly-cleared
  // editor). Only stay out of lists, quotes, and code blocks where these
  // characters are legitimate content.
  if (block && /^(UL|OL|LI|BLOCKQUOTE|PRE|TABLE)$/.test(block.tagName)) return false;
  const scope = block || editor;

  const probe = range.cloneRange();
  probe.selectNodeContents(scope);
  probe.setEnd(range.startContainer, range.startOffset);
  const marker = probe.toString();

  const blockMap = { "#": "H1", "##": "H2", "###": "H3", ">": "BLOCKQUOTE" };
  let action = null;
  if (blockMap[marker]) action = { kind: "format", tag: blockMap[marker] };
  else if (/^\[[ xX]?\]$/.test(marker)) action = { kind: "task" };
  else if (marker === "-" || marker === "*" || marker === "+") action = { kind: "ul" };
  else if (/^\d+\.$/.test(marker)) action = { kind: "ol" };
  else if (marker === "```") action = { kind: "format", tag: "PRE" };
  if (!action) return false;
  if (action.kind === "task" && !onTask) return false;

  // remove the typed marker
  const del = range.cloneRange();
  del.selectNodeContents(scope);
  del.setEnd(range.startContainer, range.startOffset);
  del.deleteContents();

  if (action.kind === "format") execCmd("formatBlock", action.tag);
  else if (action.kind === "ul") execCmd("insertUnorderedList");
  else if (action.kind === "ol") execCmd("insertOrderedList");
  else if (action.kind === "task") onTask();
  return true;
}

/* ---------- inline shortcuts (fired on input of a delimiter) ---------- */
const INLINE_RULES = [
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)$/, tag: "a", link: true },
  { re: /\*\*([^*\n]+?)\*\*$/, tag: "strong", d: 2 },
  { re: /__([^_\n]+?)__$/, tag: "strong", d: 2 },
  { re: /~~([^~\n]+?)~~$/, tag: "del", d: 2 },
  { re: /`([^`\n]+?)`$/, tag: "code", d: 1, raw: true },
  { re: /(?:^|[^*])\*([^*\n]+?)\*$/, tag: "em", d: 1 },
  { re: /(?:^|[^_\w])_([^_\n]+?)_$/, tag: "em", d: 1 },
];

export function tryInlineShortcut(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== 3) return false;
  if (inCodeContext(node)) return false;

  const caret = range.startOffset;
  const text = node.textContent.slice(0, caret);

  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const inner = m[1];
    if (!inner || (rule.raw && inner.includes(ZWSP))) continue;
    // links consume the whole [text](url); other rules just the delimited run
    const span = rule.link ? m[0].length : inner.length + rule.d * 2;
    const start = caret - span;
    if (start < 0) continue;

    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, caret);
    r.deleteContents();

    const el = document.createElement(rule.tag);
    el.textContent = inner;
    if (rule.link) el.setAttribute("href", safeHref(m[2]));
    r.insertNode(el);

    // Break out of the inline element with a zero-width space so typing
    // continues unformatted (ZWSP is stripped on export and from word counts).
    const tail = document.createTextNode("​");
    el.after(tail);
    const nr = document.createRange();
    nr.setStart(tail, 1);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    return true;
  }
  return false;
}

/* ---------- smart typography (fired on insertText) ---------- */
// Calm punctuation: -- → —, ... → …, -> → →, and context-aware curly quotes.
// Returns true if it replaced something. Quotes are gated by the caller's pref.
export function trySmartTypography(editor, data, quotes) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== 3 || inCodeContext(node)) return false;

  const caret = range.startOffset;
  const before = node.textContent.slice(0, caret);
  // Don't mangle a URL being typed (http://a--b.com, a->b inside a link, …).
  const token = before.slice(before.search(/\S+$/));
  const urlish = /^(https?:\/\/|www\.)/i.test(token) || token.includes("://");
  let from = -1;
  let repl = null;

  if (!urlish && data === "-" && before.endsWith("--")) { from = caret - 2; repl = "—"; }
  else if (!urlish && data === "." && before.endsWith("...")) { from = caret - 3; repl = "…"; }
  else if (!urlish && data === ">" && before.endsWith("->")) { from = caret - 2; repl = "→"; }
  else if (quotes && (data === '"' || data === "'")) {
    const prev = before[caret - 2];
    const open = !prev || /[\s([{‘“]/.test(prev);
    repl = data === '"' ? (open ? "“" : "”") : open ? "‘" : "’";
    from = caret - 1;
  }
  if (repl == null || from < 0) return false;

  const r = document.createRange();
  r.setStart(node, from);
  r.setEnd(node, caret);
  r.deleteContents();
  const t = document.createTextNode(repl);
  r.insertNode(t);
  const nr = document.createRange();
  nr.setStart(t, t.length);
  nr.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nr);
  return true;
}

/* ---------- auto-link bare URLs (fired on Space) ---------- */
const URL_RE = /(https?:\/\/[^\s<]*[^\s<.,;:!?)\]}'"]|www\.[^\s<]*[^\s<.,;:!?)\]}'"])$/i;

export function tryAutoLink(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== 3 || inCodeContext(node)) return false;
  const parent = node.parentElement;
  if (parent && parent.closest("a")) return false;

  const caret = range.startOffset;
  const trailing = node.textContent.slice(0, caret).match(/\s+$/);
  const end = caret - (trailing ? trailing[0].length : 0);
  const m = URL_RE.exec(node.textContent.slice(0, end));
  if (!m) return false;

  const url = m[1];
  const start = end - url.length;
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  r.deleteContents();
  const a = document.createElement("a");
  a.setAttribute("href", /^www\./i.test(url) ? "https://" + url : url);
  a.textContent = url;
  r.insertNode(a);

  // Keep the caret after the trailing space (outside the link) so typing continues normally.
  const after = a.nextSibling;
  const nr = document.createRange();
  if (after && after.nodeType === 3) nr.setStart(after, Math.min(trailing ? trailing[0].length : 0, after.length));
  else nr.setStartAfter(a);
  nr.collapse(true);
  sel.removeAllRanges();
  sel.addRange(nr);
  return true;
}

// If pasted text is a single bare URL, return its href; else null.
export function singleUrl(text) {
  const t = (text || "").trim();
  if (!t || /\s/.test(t)) return null;
  if (!/^(https?:\/\/[^\s<]+|www\.[^\s<]+)$/i.test(t)) return null;
  return /^www\./i.test(t) ? "https://" + t : t;
}

// Neutralize dangerous link targets (javascript:, data:, …). Allows http(s)/mailto,
// anchors and relative paths; upgrades bare www. to https. Returns "#" for anything else.
export function safeHref(url) {
  const u = (url || "").trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^(#|\/|\.{1,2}\/)/.test(u)) return u;
  if (/^www\./i.test(u)) return "https://" + u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "#"; // some other (untrusted) scheme
  return u; // schemeless / relative text — no colon, safe
}

/* ---------- HTML -> Markdown (export) ---------- */
export function htmlToMarkdown(root) {
  const lines = [];

  function inline(node) {
    let out = "";
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        out += n.textContent.replace(/​/g, "");
      } else if (n.nodeType === 1) {
        const t = n.tagName;
        if (t === "BR") out += "  \n";
        else if (t === "STRONG" || t === "B") out += `**${inline(n)}**`;
        else if (t === "EM" || t === "I") out += `*${inline(n)}*`;
        else if (t === "DEL" || t === "S" || t === "STRIKE") out += `~~${inline(n)}~~`;
        else if (t === "CODE") out += "`" + n.textContent.replace(/​/g, "") + "`";
        else if (t === "A") out += `[${inline(n)}](${n.getAttribute("href") || ""})`;
        else if (t === "UL" || t === "OL" || t === "LI" || t === "INPUT") { /* blocks/widgets: handled by listLines() */ }
        else out += inline(n);
      }
    });
    return out;
  }

  // Recurse a list, indenting nested levels two spaces. Task-list items become
  // `- [ ]` / `- [x]` so checklists round-trip through Markdown.
  function listLines(listEl, depth, ordered) {
    const pad = "  ".repeat(depth);
    const isTask = listEl.classList.contains("task-list");
    let n = 1;
    listEl.querySelectorAll(":scope > li").forEach((li) => {
      let marker;
      if (isTask) {
        const box = li.querySelector(":scope > input[type=checkbox]");
        marker = box && (box.checked || box.hasAttribute("checked")) ? "- [x] " : "- [ ] ";
      } else {
        marker = ordered ? `${n++}. ` : "- ";
      }
      lines.push(pad + marker + inline(li).trim());
      li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) =>
        listLines(sub, depth + 1, sub.tagName === "OL")
      );
    });
  }

  function walk(parent) {
    Array.from(parent.children).forEach((el) => {
      const t = el.tagName;
      if (t === "H1") lines.push("# " + inline(el), "");
      else if (t === "H2") lines.push("## " + inline(el), "");
      else if (t === "H3") lines.push("### " + inline(el), "");
      else if (t === "UL" || t === "OL") {
        listLines(el, 0, t === "OL");
        lines.push("");
      } else if (t === "BLOCKQUOTE") {
        inline(el).split("\n").forEach((l) => lines.push("> " + l));
        lines.push("");
      } else if (t === "PRE") {
        lines.push("```", el.textContent.replace(/​/g, "").replace(/\n$/, ""), "```", "");
      } else if (t === "HR") {
        lines.push("---", "");
      } else {
        const s = inline(el);
        lines.push(s, "");
      }
    });
  }

  walk(root);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ---------- Markdown -> HTML (import) ---------- */
export function markdownToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inlineMd = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${safeHref(url).replace(/"/g, "&quot;")}">${text}</a>`);

  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  const blockStart = /^(#{1,3}\s|>\s?|```|\s*[-*+]\s|\s*\d+\.\s)/;

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      let code = "";
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code += lines[i++] + "\n";
      i++;
      html += `<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const lvl = line.match(/^#+/)[0].length;
      html += `<h${lvl}>${inlineMd(line.replace(/^#+\s/, ""))}</h${lvl}>`;
      i++;
      continue;
    }
    if (/^\s*[-*+]\s\[[ xX]?\]\s/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*[-*+]\s\[[ xX]?\]\s/.test(lines[i])) {
        const m = lines[i++].match(/^\s*[-*+]\s\[([ xX]?)\]\s(.*)$/);
        const checked = /x/i.test(m[1]) ? " checked" : "";
        items += `<li class="task"><input type="checkbox" contenteditable="false"${checked}> ${inlineMd(m[2])}</li>`;
      }
      html += `<ul class="task-list">${items}</ul>`;
      continue;
    }
    if (/^\s*[-*+]\s/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i]) && !/^\s*[-*+]\s\[[ xX]?\]\s/.test(lines[i]))
        items += `<li>${inlineMd(lines[i++].replace(/^\s*[-*+]\s/, ""))}</li>`;
      html += `<ul>${items}</ul>`;
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i]))
        items += `<li>${inlineMd(lines[i++].replace(/^\s*\d+\.\s/, ""))}</li>`;
      html += `<ol>${items}</ol>`;
      continue;
    }
    if (/^>\s?/.test(line)) {
      let q = "";
      while (i < lines.length && /^>\s?/.test(lines[i])) q += lines[i++].replace(/^>\s?/, "") + " ";
      html += `<blockquote>${inlineMd(q.trim())}</blockquote>`;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html += "<hr>";
      i++;
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    let para = line;
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !blockStart.test(lines[i])) para += " " + lines[i++];
    html += `<p>${inlineMd(para)}</p>`;
  }
  return html || "<p></p>";
}
