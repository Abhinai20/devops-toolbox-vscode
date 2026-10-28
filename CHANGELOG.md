# Changelog

## 0.1.0

First release. 36 tools, all running locally in a webview with `connect-src 'none'`.

- **DevOps Toolbox: Open Tool…** — searchable list of every tool.
- **DevOps Toolbox: Open Toolbox** — the full toolbox with its sidebar.
- Follows the editor's light/dark theme on first open; the in-panel toggle still wins.
- Markdown → Word saves through VS Code's own save dialog, since webviews can't download.
- The AI Rephraser from the web version is deliberately left out: it calls a remote API, which this package promises not to do.
