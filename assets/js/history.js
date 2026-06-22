// history.js — undo/redo for the editor.
//
// The editor mixes document.execCommand with raw DOM/Range mutations (smart typography,
// inline Markdown, autolink, checklists, paste). The native execCommand undo stack only
// sees the execCommand half, so Ctrl+Z was unreliable. This manager instead watches the
// editor with a MutationObserver and snapshots its *content*, capturing every change
// regardless of how it was made — no hooks needed at each mutation site.
//
// Find-and-replace wraps matches in <mark class="find-hit">; those are view-only, so we
// compare/store the content with the marks stripped. Highlighting therefore never creates
// an undo step, while a real replace does.

export function createHistory(editor, onRestore) {
  const MAX = 300;
  const DEBOUNCE = 350;
  let stack = [];
  let idx = -1;
  let timer = null;
  let restoring = false;

  // editor.innerHTML minus transient find-highlight wrappers (fast path when none exist).
  function contentHtml() {
    if (!editor.querySelector("mark.find-hit")) return editor.innerHTML;
    const clone = editor.cloneNode(true);
    clone.querySelectorAll("mark.find-hit").forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });
    return clone.innerHTML;
  }

  // Serialize the caret as a structural path so it can be restored after innerHTML is reset.
  function caretPath() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer)) return null;
    const path = [];
    let n = r.startContainer;
    while (n && n !== editor) {
      const p = n.parentNode;
      if (!p) return null;
      path.unshift([...p.childNodes].indexOf(n));
      n = p;
    }
    return { path, offset: r.startOffset };
  }

  function placeCaretEnd() {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function restoreCaret(cp) {
    if (!cp) return placeCaretEnd();
    let n = editor;
    for (const i of cp.path) {
      if (!n.childNodes || !n.childNodes[i]) return placeCaretEnd(); // structure drifted → safe fallback
      n = n.childNodes[i];
    }
    try {
      const max = n.nodeType === 3 ? n.length : n.childNodes.length;
      const r = document.createRange();
      r.setStart(n, Math.min(cp.offset, max));
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch {
      placeCaretEnd();
    }
  }

  function record() {
    const html = contentHtml();
    if (idx >= 0 && stack[idx].html === html) return; // nothing meaningful changed
    stack = stack.slice(0, idx + 1); // drop any redo tail
    stack.push({ html, caret: caretPath() });
    idx = stack.length - 1;
    if (stack.length > MAX) {
      stack.shift();
      idx--;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(record, DEBOUNCE);
  }

  function flush() {
    clearTimeout(timer);
    record();
  }

  function apply(snap) {
    restoring = true;
    editor.innerHTML = snap.html;
    restoreCaret(snap.caret);
    observer.takeRecords(); // drop the mutations our own restore just produced
    restoring = false;
    if (onRestore) onRestore();
  }

  const observer = new MutationObserver(() => {
    if (!restoring) schedule();
  });
  observer.observe(editor, { childList: true, subtree: true, characterData: true, attributes: true });

  return {
    // Seed (or re-seed, e.g. on document switch) so undo can't cross document boundaries.
    reset() {
      clearTimeout(timer);
      observer.takeRecords();
      stack = [{ html: contentHtml(), caret: caretPath() }];
      idx = 0;
    },
    undo() {
      flush();
      if (idx <= 0) return false;
      idx--;
      apply(stack[idx]);
      return true;
    },
    redo() {
      if (idx >= stack.length - 1) return false;
      idx++;
      apply(stack[idx]);
      return true;
    },
    canUndo: () => idx > 0,
    canRedo: () => idx < stack.length - 1,
  };
}
