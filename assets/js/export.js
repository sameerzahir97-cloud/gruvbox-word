// export.js — download the current document in several formats (all client-side)

import { htmlToMarkdown } from "./markdown.js";

function safeName(title) {
  return (title || "document").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document";
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Strip editor-only artifacts (zero-width spaces, find highlights) from HTML.
export function cleanHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  tmp.querySelectorAll("mark.find-hit").forEach((m) => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  });
  // Replace live checkboxes with a static glyph so exported HTML/Word shows an
  // intentional box rather than an interactive form control.
  tmp.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.replaceWith(document.createTextNode(box.checked || box.hasAttribute("checked") ? "☑ " : "☐ "));
  });
  tmp.querySelectorAll("ul.task-list").forEach((ul) => ul.removeAttribute("class"));
  tmp.querySelectorAll("li.task").forEach((li) => li.removeAttribute("class"));
  return tmp.innerHTML.replace(/​/g, "");
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportMarkdown(editor, title) {
  download(safeName(title) + ".md", htmlToMarkdown(editor), "text/markdown;charset=utf-8");
}

export function exportText(editor, title) {
  // Render an offscreen clone so innerText keeps block line breaks, and turn checkboxes
  // into "[x] "/"[ ] " markers (a bare <input> contributes no text).
  const clone = editor.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("input[type=checkbox]").forEach((b) =>
    b.replaceWith(document.createTextNode(b.checked || b.hasAttribute("checked") ? "[x] " : "[ ] "))
  );
  clone.style.cssText = "position:fixed;left:-99999px;top:0";
  document.body.appendChild(clone);
  const text = (clone.innerText || "").replace(/​/g, "");
  clone.remove();
  download(safeName(title) + ".txt", text, "text/plain;charset=utf-8");
}

export function exportHtml(editor, title) {
  const doc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:light}
  body{max-width:42rem;margin:3rem auto;padding:0 1.25rem;background:#fbf1c7;color:#3c3836;
    font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;line-height:1.7}
  h1,h2,h3{color:#282828;letter-spacing:-.015em}
  a{color:#076678}
  code{background:#f2e5bc;border:1px solid #e6d9ad;border-radius:5px;padding:.1em .35em}
  pre{background:#f2e5bc;border:1px solid #e6d9ad;border-radius:7px;padding:.9rem 1rem;overflow:auto}
  pre code{background:none;border:0;padding:0}
  blockquote{border-left:3px solid #af3a03;margin:0;padding-left:1rem;color:#504945;font-style:italic}
  hr{border:0;border-top:2px dashed #d5c4a1}
</style></head>
<body>${cleanHtml(editor.innerHTML)}</body></html>`;
  download(safeName(title) + ".html", doc, "text/html;charset=utf-8");
}

// A .doc file that is really HTML with Office namespaces — opens natively in Microsoft Word.
export function exportDoc(editor, title) {
  const header =
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
    "xmlns:w='urn:schemas-microsoft-com:office:word' " +
    "xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'>" +
    `<title>${esc(title)}</title>` +
    "<style>body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.5;color:#222}" +
    "h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}" +
    "code,pre{font-family:'Cascadia Code','Courier New',monospace;font-size:10pt}" +
    "pre{background:#f4f4f4;border:1px solid #ddd;padding:8pt}" +
    "blockquote{border-left:3px solid #bbb;margin-left:0;padding-left:12pt;color:#555;font-style:italic}" +
    "</style></head><body>";
  const footer = "</body></html>";
  const content = "﻿" + header + cleanHtml(editor.innerHTML) + footer;
  download(safeName(title) + ".doc", content, "application/msword");
}

export function exportPdf() {
  // The print stylesheet renders a clean page; the user picks "Save as PDF".
  window.print();
}

export function runExport(kind, editor, title) {
  switch (kind) {
    case "doc": return exportDoc(editor, title);
    case "md": return exportMarkdown(editor, title);
    case "html": return exportHtml(editor, title);
    case "txt": return exportText(editor, title);
    case "pdf": return exportPdf();
  }
}
