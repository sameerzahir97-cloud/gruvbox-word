<div align="center">

<img src="./assets/icons/favicon.svg" width="84" alt="Gruvbox Word logo" />

# Gruvbox Word

### A calm, fast, offline writing app — Word, but in [Gruvbox](https://github.com/morhetz/gruvbox) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/).

[**✍️ Open the app →**](https://word.sameerzahir.com)

![License: MIT](https://img.shields.io/badge/license-MIT-af3a03)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-79740e)
![PWA](https://img.shields.io/badge/PWA-installable%20%2F%20offline-076678)
![Vanilla JS](https://img.shields.io/badge/vanilla-HTML%20·%20CSS%20·%20JS-8f3f71)

<img src="./docs/screenshot-light.png" width="820" alt="Gruvbox Word — light theme" />

</div>

## Why

Most writing apps are either a heavyweight word processor or a bare Markdown box. **Gruvbox Word** is the calm middle: a familiar formatting toolbar **and** live Markdown shortcuts, wrapped in the warm Gruvbox palette and JetBrains Mono. It runs entirely in your browser, works offline, and your words never leave your device.

## Features

- **Hybrid editor** — click the toolbar like Word, *or* type Markdown (`# `, `- `, `> `, `**bold**`, `` `code` ``) and watch it format live, with smart typography (`--`→—, `...`→…) and auto-linking.
- **Checklists, slash menu & focus mode** — `[ ] ` for clickable task lists; press `/` on a blank line to insert any block; dim everything but the line you're writing.
- **Writing goals** — set a per-document word target and watch the progress ring fill.
- **Export anywhere** — Microsoft Word (`.doc`), Markdown, HTML, plain text, and print-perfect PDF. No server, no upload.
- **Import** Markdown / text / HTML by picker or drag-and-drop (sanitized on the way in).
- **Multiple documents** with a sidebar filter, automatic saving, and a live outline built from your headings.
- **Find & replace** with match highlighting.
- **Light & dark** Gruvbox themes, a distraction-free **zen mode**, and a full set of keyboard shortcuts.
- **Installable PWA** — add it to your dock and use it fully offline.
- **Private by design** — everything is stored locally in your browser (`localStorage`); nothing is ever sent anywhere.
- **Zero dependencies** — one HTML file, a stylesheet, and a handful of native ES modules. Hosts on any static host. Nothing to rot.

## Markdown shortcuts

| Type… | …and you get |
| --- | --- |
| `# ` `## ` `### ` | Headings 1–3 |
| `- ` or `* ` | Bullet list |
| `1. ` | Numbered list |
| `> ` | Blockquote |
| ` ``` ` | Code block |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `inline code` |
| `~~strike~~` | ~~strikethrough~~ |
| `[ ] ` | Checklist item |
| `[text](url)` | A link |

## Keyboard shortcuts

`Ctrl/⌘ + B / I` bold/italic · `Ctrl + E` inline code · `Ctrl + 1/2/3` headings · `Ctrl + K` link · `Ctrl + F` find · `Ctrl + S` export · `Ctrl + Alt + N` new doc · `Ctrl + Shift + L` theme · `Ctrl + Shift + Z` zen · `Ctrl + Shift + D` focus · `Ctrl + \` sidebar · `Tab` sub-bullet · `/` command menu · `?` help.

## Run locally

It's a static site — no build step.

```bash
# any static server works; for example:
npx serve .
# then open the printed http://localhost:3000
```

Or just open `index.html` in a browser (a server is only needed for the service worker / offline features).

## Tech

Plain **HTML + CSS + vanilla JavaScript** (native ES modules), a service worker for offline support, and a subset of **JetBrains Mono Nerd Font** shipped as WOFF2. No framework, no bundler, no dependencies.

## Credits

- Gruvbox palette by **Pavel “morhetz” Pertsev**
- **JetBrains Mono** by JetBrains, patched by **Nerd Fonts** (SIL OFL 1.1)

## License

[MIT](./LICENSE) © Sameer Zahir. Built with care — and a fair bit of AI.
