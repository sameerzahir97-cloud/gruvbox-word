// app.js — orchestration: state, UI wiring, events.

import * as store from "./storage.js";
import { applyCommand, activeCommands, execCmd, initEditorDefaults, tryListIndent, closest, createTaskItem } from "./editor.js";
import { tryBlockShortcut, tryInlineShortcut, trySmartTypography, tryAutoLink, singleUrl, markdownToHtml, topBlock } from "./markdown.js";
import { runExport } from "./export.js";
import { createHistory } from "./history.js";

const $ = (sel) => document.querySelector(sel);
const editor = $("#editor");
const app = $("#app");
const ZWSP = "​";

// Undo/redo that captures every edit (execCommand AND raw DOM transforms). Seeded per
// document in loadDoc(); afterRestore() refreshes the UI when a snapshot is applied.
const editHistory = createHistory(editor, () => afterRestore());

const WELCOME = `<h1>Welcome to Gruvbox Word</h1><p>A calm place to write. Start typing, or try a little Markdown — type <code>#&nbsp;</code> for a heading, <code>-&nbsp;</code> for a list, or wrap a word in <code>**stars**</code> for <strong>bold</strong>.</p><p>Everything saves automatically and stays on your device. When you're done, hit <strong>Export</strong> for Word, Markdown, HTML or PDF.</p><p>Happy writing. ✶</p>`;

let docs = [];
let activeId = null;
let saveTimer = null;
let statTimer = null;
let prefs = {};

/* ===================== documents ===================== */

function currentDoc() {
  return docs.find((d) => d.id === activeId) || null;
}

function newDoc(html = "<p></p>", focus = true) {
  const now = Date.now();
  const doc = { id: store.uid(), title: "Untitled", html, createdAt: now, updatedAt: now };
  docs.unshift(doc);
  activeId = doc.id;
  store.saveDocs(docs);
  store.setActiveId(activeId);
  const filter = $("#doc-filter"); // clear so the new/imported doc is visible in the sidebar
  if (filter) filter.value = "";
  loadDoc(doc, focus);
  renderDocList();
  return doc;
}

function loadDoc(doc, focus = true) {
  activeId = doc.id;
  store.setActiveId(activeId);
  clearFocusLine(); // drop stale active-line ref from the previous doc
  editor.innerHTML = doc.html || "<p></p>";
  refreshEmpty();
  updateStats();
  buildOutline();
  renderDocList();
  if (focus) {
    editor.focus();
    placeCaretEnd();
    if (app.classList.contains("focus-mode")) updateFocusLine();
  }
  editHistory.reset(); // start a fresh undo timeline for this document
}

function deleteDoc(id) {
  const idx = docs.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const wasActive = docs[idx].id === activeId;
  docs.splice(idx, 1);
  store.saveDocs(docs);
  if (!docs.length) {
    newDoc(WELCOME);
    return;
  }
  if (wasActive) loadDoc(docs[Math.max(0, idx - 1)]);
  else renderDocList();
}

function persist(now = false) {
  const doc = currentDoc();
  if (!doc) return;
  const save = () => {
    doc.html = editor.innerHTML;
    doc.title = doc.renamed ? doc.title : store.deriveTitle(doc.html);
    doc.updatedAt = Date.now();
    store.saveDocs(docs);
    renderDocList();
    setSaved(true);
  };
  if (now) {
    clearTimeout(saveTimer);
    save();
    return;
  }
  setSaved(false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

function setSaved(saved) {
  const el = $("#stat-save");
  el.classList.toggle("is-saving", !saved);
  el.textContent = saved ? "Saved" : "Saving";
}

function renderDocList() {
  const list = $("#doc-list");
  // Read the filter live from the input — persist() re-renders on every autosave,
  // so passing it as an argument would wipe the term mid-type.
  const q = ($("#doc-filter")?.value || "").trim().toLowerCase();
  list.innerHTML = "";
  const shown = q ? docs.filter((d) => (d.title || "Untitled").toLowerCase().includes(q)) : docs;
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "doc-empty";
    li.textContent = q ? "No matches" : "No documents";
    list.appendChild(li);
    return;
  }
  shown.forEach((doc) => {
    const li = document.createElement("li");
    li.className = "doc-item" + (doc.id === activeId ? " is-active" : "");
    li.tabIndex = 0;
    li.innerHTML = `<span class="doc-item__title"></span>
      <span class="doc-item__actions">
        <button class="iconbtn iconbtn--sm" data-act="rename" title="Rename" aria-label="Rename"><svg><use href="#icon-edit"/></svg></button>
        <button class="iconbtn iconbtn--sm" data-act="delete" title="Delete" aria-label="Delete"><svg><use href="#icon-trash"/></svg></button>
      </span>`;
    li.querySelector(".doc-item__title").textContent = doc.title || "Untitled";
    li.addEventListener("click", (e) => {
      if (e.target.closest("[data-act]")) return;
      if (doc.id !== activeId) {
        persist(true);
        loadDoc(doc);
      }
    });
    li.querySelector('[data-act="rename"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const name = window.prompt("Rename document", doc.title || "Untitled");
      if (name && name.trim()) {
        doc.title = name.trim().slice(0, 60);
        doc.renamed = true;
        store.saveDocs(docs);
        renderDocList();
      }
    });
    li.querySelector('[data-act="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.confirm(`Delete "${doc.title || "Untitled"}"? This can't be undone.`)) deleteDoc(doc.id);
    });
    list.appendChild(li);
  });
}

/* ===================== stats + outline ===================== */

function updateStats() {
  clearTimeout(statTimer);
  statTimer = setTimeout(() => {
    const text = (editor.textContent || "").replace(/​/g, "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.replace(/\s/g, "").length;
    const mins = Math.max(1, Math.round(words / 200));
    const doc = currentDoc();
    const goal = doc && doc.goal;
    const ring = $("#goal-ring");
    if (goal) {
      $("#stat-words").textContent = `${words.toLocaleString()} / ${goal.toLocaleString()} words`;
      const C = 2 * Math.PI * 8;
      const fill = ring.querySelector(".goalring__fill");
      fill.style.strokeDasharray = C.toFixed(2);
      fill.style.strokeDashoffset = (C * (1 - Math.max(0, Math.min(1, words / goal)))).toFixed(2);
      ring.classList.toggle("is-done", words >= goal);
      ring.hidden = false;
    } else {
      $("#stat-words").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
      ring.hidden = true;
    }
    $("#stat-chars").textContent = `${chars.toLocaleString()} ${chars === 1 ? "character" : "characters"}`;
    $("#stat-read").textContent = words ? `${mins} min read` : "0 min read";
  }, 120);
}

// Set or clear a per-document word goal (shown as a ring in the status bar).
function setGoal() {
  const doc = currentDoc();
  if (!doc) return;
  const input = window.prompt("Word goal for this document (blank to clear):", doc.goal ? String(doc.goal) : "");
  if (input === null) return;
  const n = parseInt(input, 10);
  doc.goal = Number.isFinite(n) && n > 0 ? n : undefined;
  store.saveDocs(docs);
  updateStats();
}

function buildOutline() {
  const out = $("#outline");
  out.innerHTML = "";
  const heads = editor.querySelectorAll("h1, h2, h3");
  heads.forEach((h, i) => {
    if (!h.id) h.id = "h-" + i;
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.className = "lvl-" + h.tagName[1];
    a.textContent = h.textContent.replace(/​/g, "") || "Untitled heading";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    out.appendChild(a);
  });
}

function refreshEmpty() {
  // A fresh list/heading/etc. has no text yet but is real content — without this the
  // placeholder would render on top of an empty bullet.
  const hasBlocks = editor.querySelector("ul, ol, li, h1, h2, h3, blockquote, pre, hr, img, table");
  const empty = !hasBlocks && !editor.textContent.replace(/​/g, "").trim() && editor.children.length <= 1;
  editor.classList.toggle("is-empty", empty);
  editor.dataset.placeholder = empty ? "Start writing…" : "";
}

/* ===================== caret helpers ===================== */

function placeCaretEnd() {
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ===================== toolbar + commands ===================== */

function syncToolbar() {
  const active = activeCommands();
  document.querySelectorAll(".toolbar [data-cmd]").forEach((btn) => {
    const cmd = btn.dataset.cmd;
    if (["bold", "italic", "strikeThrough", "inlineCode", "h1", "h2", "h3", "ul", "ol", "checklist", "quote", "codeblock"].includes(cmd))
      btn.classList.toggle("is-active", active.has(cmd));
  });
}

const ACTIONS = {
  sidebar: toggleSidebar,
  find: openFind,
  import: () => $("#file-input").click(),
  export: toggleExportMenu,
  theme: toggleTheme,
  focus: toggleFocus,
  zen: toggleZen,
  help: openHelp,
  undo: () => editHistory.undo(),
  redo: () => editHistory.redo(),
};

document.querySelector(".toolbar").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cmd]");
  if (!btn) return;
  const cmd = btn.dataset.cmd;
  if (ACTIONS[cmd]) ACTIONS[cmd]();
  else {
    applyCommand(cmd, editor);
    persist();
    syncToolbar();
    buildOutline();
    updateStats();
    refreshEmpty();
  }
});

/* ===================== editor events ===================== */

// One ordered input pipeline. At most one text transform runs per keystroke so the
// handlers don't fight over the selection each one mutates.
editor.addEventListener("input", (e) => {
  refreshEmpty();

  if (slashOpen()) {
    updateSlashMenu();
    persist();
    return;
  }

  if (e.inputType === "insertText" && e.data) {
    const d = e.data;
    if (d === "/" && openSlashIfEmptyBlock()) { persist(); return; } // menu owns the rest
    const smart = prefs.smartType !== false && trySmartTypography(editor, d, prefs.smartQuotes !== false);
    if (!smart && "*_`~)".includes(d)) tryInlineShortcut(editor);
    else if (!smart && d === " ") tryAutoLink(editor);
  }

  persist();
  updateStats();
  buildOutline();
  if (app.classList.contains("focus-mode")) updateFocusLine();
});

editor.addEventListener("keydown", (e) => {
  // Slash menu, when open, owns navigation keys.
  if (slashOpen() && handleSlashKey(e)) { e.stopPropagation(); return; }

  // Tab / Shift+Tab: nested list items (sub-bullets). Outside a list, fall through
  // to the browser default so Tab still moves focus out of the editor.
  if (e.key === "Tab") {
    if (tryListIndent(editor, e.shiftKey)) {
      e.preventDefault();
      persist();
      syncToolbar();
    }
    return;
  }

  // Enter on an empty checklist item makes the next checklist item;
  // Enter on any other empty list item exits the list.
  if (e.key === "Enter" && !e.shiftKey) {
    const li = caretListItem();
    if (li && !li.querySelector("ul, ol")) {
      const emptyItem = !li.textContent.replace(/​/g, "").trim();
      if (li.classList.contains("task") && !emptyItem) {
        e.preventDefault();
        newTaskItem(li);
        persist();
        return;
      }
      if (emptyItem) {
        e.preventDefault();
        // Drop the checkbox first — outdent leaves a contenteditable=false input stranded.
        const box = li.querySelector(":scope > input[type=checkbox]");
        if (box) box.remove();
        execCmd("outdent");
        persist();
        syncToolbar();
        buildOutline();
        refreshEmpty();
        return;
      }
    }
  }

  // Backspace at the start of a task item (just after its checkbox): merge into the
  // previous item if there is one (native merge would orphan/duplicate the checkbox);
  // otherwise convert this item back to a plain paragraph.
  if (e.key === "Backspace") {
    const li = caretListItem();
    if (li && li.classList.contains("task") && caretAtItemStart(li)) {
      e.preventDefault();
      const prev = li.previousElementSibling;
      if (prev && prev.matches("li")) mergeTaskItemUp(li, prev);
      else unwrapTaskItem(li);
      persist();
      syncToolbar();
      refreshEmpty();
      return;
    }
  }

  // Space triggers block-level Markdown shortcuts
  if (e.key === " ") {
    if (tryBlockShortcut(editor, execCmd, () => applyCommand("checklist", editor))) {
      e.preventDefault();
      persist();
      syncToolbar();
      buildOutline();
      refreshEmpty();
    }
  }
});

// Caret's enclosing <li>, or null.
function caretListItem() {
  const sel = window.getSelection();
  return sel.rangeCount ? closest(sel.getRangeAt(0).startContainer, "li") : null;
}

// Insert a fresh checklist item after `li`, moving any text after the caret into it
// (so Enter mid-item splits like every other list), and place the caret at its start.
function newTaskItem(li) {
  const next = createTaskItem();
  li.after(next);
  const sel = window.getSelection();
  if (sel.rangeCount && li.lastChild) {
    const tail = sel.getRangeAt(0).cloneRange();
    tail.setEndAfter(li.lastChild);
    next.appendChild(tail.extractContents());
  }
  const box = next.querySelector(":scope > input[type=checkbox]");
  const target = box ? box.nextSibling : next.firstChild;
  const r = document.createRange();
  r.setStart(target, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  refreshEmpty();
}

// True if a collapsed caret sits at the start of a task item's text (just after its checkbox).
function caretAtItemStart(li) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const box = li.querySelector(":scope > input[type=checkbox]");
  const probe = document.createRange();
  if (box) probe.setStartAfter(box);
  else probe.setStart(li, 0);
  probe.setEnd(r.startContainer, r.startOffset);
  return probe.toString().replace(/​/g, "") === "";
}

// Merge a task item into the previous list item: drop its checkbox, move its content
// to the end of `prev`, and put the caret at the join.
function mergeTaskItemUp(li, prev) {
  const box = li.querySelector(":scope > input[type=checkbox]");
  if (box) box.remove();
  const caretNode = prev.lastChild;
  const caretOffset = caretNode ? (caretNode.nodeType === 3 ? caretNode.length : caretNode.childNodes.length) : 0;
  while (li.firstChild) prev.appendChild(li.firstChild);
  li.remove();
  const sel = window.getSelection();
  const r = document.createRange();
  if (caretNode && caretNode.parentNode === prev && caretNode.nodeType === 3) r.setStart(caretNode, caretOffset);
  else { r.selectNodeContents(prev); r.collapse(false); }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// Turn a task item back into a plain paragraph (drop the checkbox, exit the list).
function unwrapTaskItem(li) {
  const box = li.querySelector(":scope > input[type=checkbox]");
  if (box) box.remove();
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(li);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  execCmd("outdent");
}

// Toggling a checkbox flips a live property that innerHTML won't serialize — mirror it
// to the attribute so the state survives a save/reload.
editor.addEventListener("click", (e) => {
  if (e.target.matches && e.target.matches('input[type="checkbox"]')) {
    e.target.toggleAttribute("checked", e.target.checked);
    persist();
  }
});

document.addEventListener("selectionchange", () => {
  if (document.activeElement !== editor) return;
  syncToolbar();
  if (app.classList.contains("focus-mode")) updateFocusLine();
});

// Paste as plain text to keep documents clean (Markdown still applies as you type).
// A pasted bare URL becomes a link.
editor.addEventListener("paste", (e) => {
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  if (text == null) return;
  e.preventDefault();
  const url = singleUrl(text);
  const sel = window.getSelection();
  // Don't auto-link inside a code block or an existing link — paste plain text there.
  const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const blocked = node && closest(node, "pre, code, a");
  if (url && !blocked && sel.rangeCount && !sel.isCollapsed) {
    execCmd("createLink", url);
  } else if (url && !blocked && sel.rangeCount) {
    const a = document.createElement("a");
    a.setAttribute("href", url);
    a.textContent = text.trim();
    const r = sel.getRangeAt(0);
    r.insertNode(a);
    r.setStartAfter(a);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    execCmd("insertText", text);
  }
  refreshEmpty();
  persist();
  updateStats();
});

/* ===================== sidebar / zen / theme ===================== */

function toggleSidebar() {
  if (window.matchMedia("(max-width: 820px)").matches) app.classList.toggle("show-sidebar");
  else {
    app.classList.toggle("no-sidebar");
    savePref("sidebar", !app.classList.contains("no-sidebar"));
  }
}

function toggleZen() {
  app.classList.toggle("zen");
  const on = app.classList.contains("zen");
  $("#btn-zen-exit").hidden = !on;
  savePref("zen", on);
}

/* ===================== focus / typewriter mode ===================== */

let activeLine = null;

function toggleFocus() {
  app.classList.toggle("focus-mode");
  const on = app.classList.contains("focus-mode");
  savePref("focus", on);
  syncFocusButton();
  if (on) updateFocusLine();
  else clearFocusLine();
}

function syncFocusButton() {
  const btn = document.querySelector('.toolbar [data-cmd="focus"]');
  if (btn) btn.classList.toggle("is-active", app.classList.contains("focus-mode"));
}

function clearFocusLine() {
  if (activeLine) activeLine.classList.remove("is-active-line");
  activeLine = null;
}

// Highlight the caret's block and keep it vertically centred. Only reacts when the
// block actually changes, so typing within a paragraph never triggers a scroll (avoids
// the oscillation you get from fighting the browser's own caret-into-view scrolling).
function updateFocusLine() {
  const sel = window.getSelection();
  const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const block = node ? topBlock(editor, node) : null;
  if (block === activeLine) return;
  if (activeLine) activeLine.classList.remove("is-active-line");
  activeLine = block;
  if (!block) return;
  block.classList.add("is-active-line");
  const wrap = $(".editor-wrap");
  requestAnimationFrame(() => {
    const w = wrap.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    wrap.scrollTop += b.top + b.height / 2 - (w.top + w.height / 2);
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  savePref("theme", next);
}

/* ===================== history (undo / redo) ===================== */

// Refresh everything after an undo/redo swaps the editor content.
function afterRestore() {
  persist();
  updateStats();
  buildOutline();
  refreshEmpty();
  syncToolbar();
  if (app.classList.contains("focus-mode")) updateFocusLine();
  if (!$("#find-bar").hidden) runFind(); // re-highlight against the restored content
}

/* ===================== export menu ===================== */

function toggleExportMenu() {
  const menu = $("#export-menu");
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }
  const btn = $("#btn-export");
  const r = btn.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = r.bottom + 6 + "px";
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12) + "px";
}

$("#export-menu").addEventListener("click", (e) => {
  const item = e.target.closest("[data-export]");
  if (!item) return;
  $("#export-menu").hidden = true;
  const doc = currentDoc();
  runExport(item.dataset.export, editor, doc ? doc.title : "document");
  if (item.dataset.export !== "pdf") toast(`Exported as ${item.dataset.export.toUpperCase()}`);
});

document.addEventListener("click", (e) => {
  const menu = $("#export-menu");
  if (!menu.hidden && !e.target.closest("#export-menu, #btn-export")) menu.hidden = true;
});

/* ===================== slash command menu ===================== */

function insertDate() {
  execCmd("insertText", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
}

const SLASH_COMMANDS = [
  { key: "h1", label: "Heading 1", hint: "#", alias: ["title", "heading"], run: () => applyCommand("h1", editor) },
  { key: "h2", label: "Heading 2", hint: "##", alias: ["heading"], run: () => applyCommand("h2", editor) },
  { key: "h3", label: "Heading 3", hint: "###", alias: ["heading"], run: () => applyCommand("h3", editor) },
  { key: "ul", label: "Bullet list", hint: "-", alias: ["bullet", "list", "unordered"], run: () => applyCommand("ul", editor) },
  { key: "ol", label: "Numbered list", hint: "1.", alias: ["number", "ordered", "list"], run: () => applyCommand("ol", editor) },
  { key: "task", label: "Checklist", hint: "[ ]", alias: ["todo", "check", "task"], run: () => applyCommand("checklist", editor) },
  { key: "quote", label: "Quote", hint: ">", alias: ["blockquote", "cite"], run: () => applyCommand("quote", editor) },
  { key: "code", label: "Code block", hint: "```", alias: ["pre", "snippet"], run: () => applyCommand("codeblock", editor) },
  { key: "hr", label: "Divider", hint: "—", alias: ["rule", "line", "separator"], run: () => applyCommand("hr", editor) },
  { key: "date", label: "Insert date", hint: "today", alias: ["time"], run: insertDate },
];

let slash = { open: false, block: null, index: 0, items: [] };

function slashOpen() { return slash.open; }

function matchCmd(c, q) {
  return c.key.includes(q) || c.label.toLowerCase().includes(q) || (c.alias || []).some((a) => a.includes(q));
}

function openSlashIfEmptyBlock() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const block = topBlock(editor, sel.getRangeAt(0).startContainer);
  if (!block || block.textContent.replace(/​/g, "") !== "/") return false;
  if (/^(PRE|CODE)$/.test(block.tagName)) return false;
  slash = { open: true, block, index: 0, items: [] };
  $("#slash-menu").hidden = false;
  renderSlash("");
  positionSlash(block);
  return true;
}

function positionSlash(block) {
  const menu = $("#slash-menu");
  const r = block.getBoundingClientRect(); // block rect: a collapsed range in an empty <p> measures as (0,0)
  // Flip above the line when there isn't room below it.
  const below = r.bottom + 4;
  const top = below + menu.offsetHeight > window.innerHeight && r.top - menu.offsetHeight - 4 > 0
    ? r.top - menu.offsetHeight - 4
    : below;
  menu.style.top = top + "px";
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12) + "px";
}

function renderSlash(query) {
  const q = query.toLowerCase();
  const items = SLASH_COMMANDS.filter((c) => !q || matchCmd(c, q));
  slash.items = items;
  if (slash.index >= items.length) slash.index = 0;
  const menu = $("#slash-menu");
  menu.innerHTML = "";
  if (!items.length) {
    menu.innerHTML = `<div class="menu__empty">No matches</div>`;
    return;
  }
  items.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu__item" + (i === slash.index ? " is-active" : "");
    b.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.textContent = c.label;
    const hint = document.createElement("span");
    hint.className = "menu__hint";
    hint.textContent = c.hint;
    b.append(label, hint);
    // mousedown (not click) so the editor keeps focus/selection through the choice
    b.addEventListener("mousedown", (e) => { e.preventDefault(); chooseSlash(i); });
    menu.appendChild(b);
  });
}

function updateSlashMenu() {
  const block = slash.block;
  if (!block || !block.isConnected) { closeSlash(); return; }
  const text = block.textContent.replace(/​/g, "");
  if (text[0] !== "/" || /\s/.test(text)) { closeSlash(); return; } // deleted "/" or typed a space → dismiss
  renderSlash(text.slice(1));
  positionSlash(block); // height changed with filtering — re-evaluate the flip
}

function moveSlash(d) {
  if (!slash.items.length) return;
  slash.index = (slash.index + d + slash.items.length) % slash.items.length;
  const els = $("#slash-menu").querySelectorAll(".menu__item");
  els.forEach((el, i) => el.classList.toggle("is-active", i === slash.index));
  if (els[slash.index]) els[slash.index].scrollIntoView({ block: "nearest" });
}

function handleSlashKey(e) {
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); moveSlash(1); return true;
    case "ArrowUp": e.preventDefault(); moveSlash(-1); return true;
    case "Enter":
    case "Tab": e.preventDefault(); chooseSlash(slash.index); return true;
    case "Escape": e.preventDefault(); closeSlash(); return true;
  }
  return false;
}

function chooseSlash(i) {
  const cmd = slash.items[i];
  const block = slash.block;
  closeSlash();
  if (!cmd || !block || !block.isConnected) return;
  // Wipe the "/query" text and drop a caret into the (now empty) block, then run the command.
  editor.focus();
  const r = document.createRange();
  r.selectNodeContents(block);
  r.deleteContents();
  r.selectNodeContents(block);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  cmd.run();
  persist();
  syncToolbar();
  buildOutline();
  refreshEmpty();
  updateStats();
  if (app.classList.contains("focus-mode")) updateFocusLine();
}

function closeSlash() {
  slash = { open: false, block: null, index: 0, items: [] };
  $("#slash-menu").hidden = true;
}

document.addEventListener("mousedown", (e) => {
  if (slashOpen() && !e.target.closest("#slash-menu")) closeSlash();
});

/* ===================== import ===================== */

// Strip dangerous markup from imported HTML before it ever touches the live editor.
function sanitizeNode(root) {
  root.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form, input, button, textarea, select").forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href)$/.test(name) && /^\s*(javascript|data|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name);
    });
  });
  return root;
}

$("#file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const content = String(reader.result);
    let html;
    if (/\.html?$/i.test(file.name)) {
      // DOMParser builds an inert document (no resource loads, no script execution).
      const parsed = new DOMParser().parseFromString(content, "text/html");
      html = sanitizeNode(parsed.body).innerHTML;
    } else {
      html = markdownToHtml(content);
    }
    const base = file.name.replace(/\.[^.]+$/, "");
    const doc = newDoc(html);
    doc.title = base.slice(0, 60);
    doc.renamed = true;
    store.saveDocs(docs);
    renderDocList();
    toast(`Imported ${file.name}`);
  };
  reader.readAsText(file);
  e.target.value = "";
});

// drag & drop import
["dragover", "drop"].forEach((ev) =>
  editor.addEventListener(ev, (e) => {
    if (e.dataTransfer && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      if (ev === "drop" && e.dataTransfer.files[0]) {
        $("#file-input").files = e.dataTransfer.files;
        $("#file-input").dispatchEvent(new Event("change"));
      }
    }
  })
);

/* ===================== find & replace ===================== */

let findHits = [];
let findIdx = -1;

function openFind() {
  const bar = $("#find-bar");
  bar.hidden = false;
  const input = $("#find-input");
  const sel = window.getSelection().toString();
  if (sel) input.value = sel;
  input.focus();
  input.select();
  runFind();
}

function closeFind() {
  $("#find-bar").hidden = true;
  clearHighlights();
  findHits = [];
  findIdx = -1;
  editor.focus();
}

function clearHighlights() {
  editor.querySelectorAll("mark.find-hit").forEach((m) => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });
}

function runFind() {
  clearHighlights();
  findHits = [];
  findIdx = -1;
  const term = $("#find-input").value;
  if (!term) {
    $("#find-count").textContent = "0/0";
    return;
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement.closest("mark.find-hit") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const lc = term.toLowerCase();
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    let from = 0;
    let i;
    while ((i = text.toLowerCase().indexOf(lc, from)) !== -1) {
      targets.push({ node, start: i, end: i + term.length });
      from = i + term.length;
    }
  }
  // wrap from last to first so offsets stay valid
  targets.reverse().forEach((t) => {
    const r = document.createRange();
    r.setStart(t.node, t.start);
    r.setEnd(t.node, t.end);
    const mark = document.createElement("mark");
    mark.className = "find-hit";
    r.surroundContents(mark);
    findHits.unshift(mark);
  });
  if (findHits.length) {
    findIdx = 0;
    focusHit();
  }
  $("#find-count").textContent = `${findHits.length ? 1 : 0}/${findHits.length}`;
}

function focusHit() {
  findHits.forEach((m, i) => m.classList.toggle("is-current", i === findIdx));
  const cur = findHits[findIdx];
  if (cur) {
    cur.scrollIntoView({ block: "center", behavior: "smooth" });
    $("#find-count").textContent = `${findIdx + 1}/${findHits.length}`;
  }
}

function stepFind(dir) {
  if (!findHits.length) return;
  findIdx = (findIdx + dir + findHits.length) % findHits.length;
  focusHit();
}

function replaceOne() {
  if (findIdx < 0 || !findHits[findIdx]) return;
  const idx = findIdx;
  findHits[findIdx].replaceWith(document.createTextNode($("#replace-input").value));
  persist();
  runFind(); // rebuilds findHits and resets findIdx to 0
  if (findHits.length) { findIdx = Math.min(idx, findHits.length - 1); focusHit(); } // stay put → next hit
}

function replaceAll() {
  const val = $("#replace-input").value;
  if (!findHits.length) return;
  const n = findHits.length;
  findHits.forEach((m) => m.replaceWith(document.createTextNode(val)));
  persist();
  updateStats();
  runFind();
  toast(`Replaced ${n}`);
}

$("#find-input").addEventListener("input", runFind);
$("#find-next").addEventListener("click", () => stepFind(1));
$("#find-prev").addEventListener("click", () => stepFind(-1));
$("#find-replace").addEventListener("click", replaceOne);
$("#find-replace-all").addEventListener("click", replaceAll);
$("#find-close").addEventListener("click", closeFind);
$("#find-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === "Escape") closeFind();
});
$("#replace-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); replaceOne(); }
  if (e.key === "Escape") closeFind();
});

/* ===================== help modal ===================== */

function openHelp() { $("#help-modal").hidden = false; }
function closeHelp() { $("#help-modal").hidden = true; }
document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeHelp));
$("#btn-help-2").addEventListener("click", openHelp);

/* ===================== misc ===================== */

$("#btn-new-doc").addEventListener("click", () => { persist(true); newDoc(); });
$("#btn-zen-exit").addEventListener("click", toggleZen);
$("#doc-filter").addEventListener("input", renderDocList);
$("#stat-words").addEventListener("click", setGoal);
$("#stat-words").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setGoal(); } });

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("is-show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("is-show");
    setTimeout(() => (t.hidden = true), 200);
  }, 1900);
}

function savePref(key, val) {
  prefs[key] = val;
  store.savePrefs(prefs);
}

/* ===================== keyboard shortcuts ===================== */

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape") {
    if (!$("#export-menu").hidden) $("#export-menu").hidden = true;
    else if (!$("#help-modal").hidden) closeHelp();
    else if (!$("#find-bar").hidden) closeFind();
    else if (app.classList.contains("zen")) toggleZen();
    return;
  }
  if (e.key === "?" && e.shiftKey && document.activeElement !== editor) { openHelp(); return; }
  if (!mod) return;

  const k = e.key.toLowerCase();
  const map = {
    b: "bold", i: "italic", e: "inlineCode", k: "link",
    1: "h1", 2: "h2", 3: "h3",
  };
  if (e.shiftKey && k === "s") { e.preventDefault(); applyCommand("strikeThrough", editor); persist(); syncToolbar(); return; }
  if (e.shiftKey && k === "l") { e.preventDefault(); toggleTheme(); return; }
  if (e.shiftKey && k === "z") { e.preventDefault(); toggleZen(); return; }
  if (e.shiftKey && k === "d") { e.preventDefault(); toggleFocus(); return; }
  if (e.altKey && k === "n") { e.preventDefault(); persist(true); newDoc(); return; }
  if (k === "\\") { e.preventDefault(); toggleSidebar(); return; }
  if (k === "s") { e.preventDefault(); toggleExportMenu(); return; }
  if (k === "f") { e.preventDefault(); openFind(); return; }
  if (k === "z" && !e.shiftKey) { e.preventDefault(); editHistory.undo(); return; }
  if (k === "y") { e.preventDefault(); editHistory.redo(); return; }

  if (map[k] && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    applyCommand(map[k], editor);
    persist();
    syncToolbar();
    buildOutline();
    refreshEmpty();
  }
});

/* ===================== init ===================== */

function init() {
  initEditorDefaults();
  prefs = store.loadPrefs();
  document.documentElement.dataset.theme =
    prefs.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (prefs.sidebar === false && !window.matchMedia("(max-width: 820px)").matches) app.classList.add("no-sidebar");
  if (window.matchMedia("(max-width: 820px)").matches) app.classList.add("no-sidebar");
  if (prefs.focus) { app.classList.add("focus-mode"); syncFocusButton(); }

  docs = store.loadDocs();
  activeId = store.getActiveId();
  if (!docs.length) {
    newDoc(WELCOME, false);
  } else {
    const doc = currentDoc() || docs[0];
    loadDoc(doc, false);
  }
  setSaved(true);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./sw.js").catch(() => {})
    );
  }
}

init();
