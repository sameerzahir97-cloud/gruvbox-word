# Gruvbox Word — project rules

Calm, offline, **zero-dependency** writing app: plain HTML + CSS + vanilla JS (native ES modules).
No framework, no bundler, no build step — keep it that way.

**Deep context lives in [`docs/HANDOFF.md`](./docs/HANDOFF.md)** — architecture map, the
`contenteditable` invariants, the security rules, the change log. Read it before editing the editor.

## Editing the editor
- The editor mixes `document.execCommand` with manual Range mutations. There is **one** ordered `input`
  handler and **one** `keydown` handler in `assets/js/app.js` — extend those, never add parallel listeners.
- **Security, don't regress:** every link href must go through `safeHref` (`markdown.js`); imported HTML
  must go through `sanitizeNode` (`app.js`). Never assign untrusted HTML to the editor.
- Text/empty checks must strip the zero-width space (`.replace(/​/g, "")`).

## Verify
- Serve over HTTP (`file://` breaks ES modules + the service worker). No real Python on this box.
- Browser-test by driving **Edge** with Playwright (`channel: "msedge"`) — Chrome isn't installed here.
- Re-run the regression checks after any editor change: formatting shortcuts, all 5 exports, md/html
  import, theme/zen, autosave, outline.

## Ship
- Branch + PR; don't push `main` directly. Merging `main` deploys to word.sameerzahir.com (GitHub Pages).
- Update the `docs/HANDOFF.md` change log when you ship something notable.
