# Gruvbox Word — developer / AI handoff

Context for anyone (human or AI) picking up this codebase. The [README](../README.md) is the
user-facing pitch; **this** file is the map of how it works, what's been done, the `contenteditable`
footguns, and how to verify changes. Read this before editing the editor.

> Stack: plain HTML + CSS + vanilla JS (native ES modules). No framework, no bundler, **zero deps**.
> Static site, deployed to https://word.sameerzahir.com via GitHub Pages from `main`.

---

## Architecture map

| File | Responsibility | Key symbols |
|------|----------------|-------------|
| `index.html` | App shell, inline SVG icon sprite, toolbar (`data-cmd` buttons), status bar, sidebar (`#doc-list`, `#doc-filter`), `#slash-menu`, `#export-menu`, `#help-modal`, hidden `#file-input`. | — |
| `assets/css/app.css` | Gruvbox theme tokens (light/dark), layout, editor typography, **checklist** styles, **focus-mode** dimming, slash menu, goal ring, `@media print` (PDF). | — |
| `assets/js/app.js` | Orchestration: state (`docs`, `activeId`, `prefs`), doc CRUD + autosave, the **unified input pipeline**, the **keydown** handler, checkbox-click toggle, slash menu, focus mode, writing goal, find & replace, import (with `sanitizeNode`), export menu, toolbar dispatch, global shortcuts, `init()`. | `refreshEmpty`, `newTaskItem`, `mergeTaskItemUp`, `updateFocusLine`, `renderDocList`, `setGoal`, `sanitizeNode` |
| `assets/js/editor.js` | `execCommand` wrappers + formatting commands. | `applyCommand`, `tryListIndent`, `toggleTaskList`/`createTaskItem`/`decorateTaskItem`, `activeCommands`, `insertLink`, `initEditorDefaults` |
| `assets/js/markdown.js` | Live Markdown shortcuts + HTML⇄Markdown conversion + URL safety. | `tryBlockShortcut`, `tryInlineShortcut`+`INLINE_RULES`, `trySmartTypography`, `tryAutoLink`, `singleUrl`, **`safeHref`**, `htmlToMarkdown` (`inline`/`listLines`/`walk`), `markdownToHtml`, `topBlock` |
| `assets/js/storage.js` | `localStorage` persistence (`docs`, `active`, `prefs`), `deriveTitle`. | — |
| `assets/js/export.js` | Client-side export. | `cleanHtml`, `runExport` (doc/md/html/txt/pdf) |
| `sw.js` | Service worker — offline app-shell cache. | — |

Documents live in `localStorage` (`gruvbox-word:docs`); each is `{id, title, html, createdAt, updatedAt, renamed?, goal?}`.

---

## Editor model & invariants (read before touching the editor)

1. **Two engines coexist.** Lists/bold/headings use `document.execCommand`; smart typography, inline
   Markdown, autolink, and all checklist ops mutate the DOM via the **Range API**. Consequence:
   **manual mutations are NOT on the execCommand undo stack** — `Ctrl+Z` won't cleanly revert a typed
   transform. Don't assume undo works for them.
2. **One ordered `input` handler** (`app.js`). Order, at most one transform per keystroke:
   `refreshEmpty` → (slash open? update filter, return) → on `insertText`: open slash on `/` →
   `trySmartTypography` → inline shortcut (`*_\`~)`) → autolink on space → `persist/updateStats/buildOutline`.
   **Add new typed transforms into this chain — never add a second `input` listener** (they'd fight
   over the mutated selection).
3. **One `keydown` handler** (`app.js`), order: slash nav → `Tab` (indent) → `Enter` → `Backspace` →
   `Space` (block shortcuts).
4. **ZWSP** (`​`) breaks the caret out of inline elements and is stripped on export and word
   counts. Any "is this empty?" / text check must `.replace(/​/g, "")`.
5. **Checklists**: `<ul class="task-list"><li class="task"><input type="checkbox" contenteditable="false"> text</li></ul>`.
   - Toggling a box must mirror the live `.checked` property to the **`checked` attribute**
     (`innerHTML` serializes attributes, not properties) — done in the editor `click` handler.
   - CSS uses a **hanging indent + absolutely-positioned checkbox**, NOT flexbox — flex puts a gap
     between every inline run and breaks formatted items. Strikethrough is `li.task:has(> input:checked)`.
6. `initEditorDefaults` sets `defaultParagraphSeparator=p` — block shortcuts rely on Enter producing `<p>`.
7. `topBlock(editor, node)` returns the **direct child of `#editor`** (the `UL`/`OL`/`P`/`H*`), never the `LI`.
8. `persist()` re-renders the doc list on every autosave, so `renderDocList()` reads the filter term
   **live from `#doc-filter`**, not from an argument (else it wipes mid-type).

### Security invariants (don't regress these)
- **Every link href** goes through `safeHref()` (allowlist `http(s)`/`mailto`/anchor/relative; everything
  else → `#`). Used by the live link shortcut, `markdownToHtml`, and `insertLink`.
- **`markdownToHtml`** quote-escapes the href (its `esc()` only handles `&<>`), preventing attribute breakout.
- **Imported HTML** is parsed with an inert `DOMParser` and run through `sanitizeNode` (strips
  `script/style/iframe/…`, all `on*` attributes, and `javascript:`/`data:`/`vbscript:` URLs) before it
  ever reaches `editor.innerHTML`. Never assign untrusted HTML to the editor without this.

---

## Change log

### 2026-06 — deferred low-priority fixes (PR #3)
Slash menu flips above the line when there's no room below; focus mode dims only on `:focus-within`
(no more whole-doc dim before the caret lands); TXT export keeps `[x]`/`[ ]` checklist markers; paste
doesn't auto-link inside code blocks or existing links; creating/importing a doc clears the sidebar
filter; "Replace" advances to the next match instead of resetting to the first; smart typography skips
URL-looking tokens (`http://a--b` stays intact). Verified by 10 new Playwright checks (62 total green).

### 2026-06 — editor enhancements + bug/security hardening (commit `838e7f7`, PR #1)
**Bugs fixed**
- `Tab`/`Shift+Tab` now create/outdent sub-bullets (there was no Tab handler); nested lists export to Markdown correctly.
- "Start writing…" placeholder no longer overlaps a freshly-created bullet/heading.

**Features added** — checklists, slash command menu (`/`), focus/typewriter mode (`Ctrl+Shift+D`),
per-document writing goal (ring in status bar), smart typography (— … →, curly quotes),
Enter-exits-empty-list, Markdown links + bare-URL autolink, sidebar document filter. The two `input`
listeners were merged into one ordered pipeline.

**Security hardening** — closed two stored-XSS holes: (1) Markdown link hrefs (scheme allowlist +
attribute-quote-escape), (2) HTML import (inert parse + sanitize).

**Correctness hardening** — checklists flow inline formatting (hanging indent, not flex), split text on
mid-item Enter, nest as checklists on Tab, keep nested boxes on toggle-off, merge into the previous item
on Backspace; Markdown export numbers `<ol>` correctly and reads checkbox state consistently.

Verified by a headless Playwright suite (35 feature/regression + 17 hardening checks, all green).

---

## Known deferred issues
- **Undo for typed transforms** — smart typography, inline Markdown, autolink, and checklist DOM ops
  mutate via the Range API, so `Ctrl+Z` (`execCommand("undo")`) doesn't revert them. A proper fix needs a
  custom history/undo manager that captures every mutation (a `MutationObserver` is the natural hook) yet
  ignores transient find-highlight wrapping and restores the caret — left as a focused future change.

---

## How to verify a change (this environment)

It's a static site, but **serve over HTTP** — `file://` breaks ES modules and the service worker.

```bash
# No real Python on this box (Store stub). Use a tiny Node static server or:
npx serve .
```

**Browser automation:** the Playwright MCP defaults to the `chrome` channel, which isn't installed here
(`playwright install chrome` needs admin). Drive **Edge** instead from a Node script:

```bash
# one-time, in a scratch dir (skips the ~130MB browser download — Edge is already installed):
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright
```
```js
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
```
Drive the served app with `page.keyboard`/`page.evaluate`. For pure functions, dynamically import the
module in-page and call it directly, e.g.:
```js
await page.evaluate(async () => (await import("/assets/js/markdown.js")).htmlToMarkdown(document.querySelector("#editor")));
```
Always re-run the regression checks (formatting shortcuts, all 5 exports, md/html import, theme/zen,
autosave, outline) after editor changes.

---

## Conventions
- Match the surrounding style: small functions, descriptive names, comments only where intent isn't obvious.
- Smallest change that works; fix root causes. No dependencies, no build step — keep it that way.
- Deploy = merge to `main` (GitHub Pages). Branch + PR, don't push `main` directly.
