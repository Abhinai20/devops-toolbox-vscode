# DevOps Toolbox — 36 offline tools for VS Code

The utilities you'd normally paste half a production config into a random website to use — JWT decoder, cron explainer, CIDR calculator, YAML/JSON/Terraform/Kubernetes linters — running inside your editor instead.

**Nothing you paste leaves your machine.** The webview's Content-Security-Policy sets `connect-src 'none'`, so there is no origin any script in this extension could send data to, and no tool that tries. That is the whole point: the token you're debugging is usually a real token, and the manifest is usually a real manifest.

Works offline. No account, no telemetry, no configuration.

## Using it

Two commands, from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | What it does |
|---|---|
| **DevOps Toolbox: Open Tool…** | Searchable list of all 36 — type `jwt`, `cron`, `cidr`, `k8s` |
| **DevOps Toolbox: Open Toolbox** | Opens the full toolbox with its sidebar |

The panel keeps its contents when you tab away, and follows your editor's light/dark theme.

## What's included

<!-- TOOLS:START -->
**Format & Validate** — YAML Validator · JSON ↔ YAML · Markdown → Word · XML ↔ JSON · JSON Schema Generator · Config Diff (JSON/YAML)

**Kubernetes & Docker** — K8s Manifest Analyzer · Dockerfile Checker · K8s Quantity Converter · K8s Resource Quota Calculator · kubectl JSONPath Tester · K8s Manifest Generator

**Reliability** — SLO / Error Budget Calculator

**Terraform & AWS** — TF Plan Formatter · IAM Policy Analyzer · Version Constraint Checker

**Security** — JWT Decoder · chmod Calculator · Secret Scanner · TLS Certificate Decoder

**Text & Code** — Regex Tester · cURL → Code · Mermaid Diagram Preview · REST Endpoint Mock Generator · .env File Validator · Nginx Config Formatter

**Time** — Cron Explainer · Cron Builder · Unix Timestamp · Timezone Converter · Cron Next Run Calculator

**Networking** — CIDR Calculator · CIDR Overlap Checker · VPC Subnet Planner

**Shell & Files** — find Command Builder · sed Command Builder
<!-- TOOLS:END -->

## Privacy

- No network access of any kind — enforced by CSP, not by policy.
- No telemetry, no analytics, no crash reporting.
- No settings, no stored data. The only thing written to disk is a file you explicitly save from Markdown → Word.

## Building from source

The tools are shared with [the web version](https://abhinai20.github.io/devops-toolbox/), which is the single source of truth. `build/build.js` reads the website and assembles the webview, so there is no forked copy of any tool's logic.

```sh
npm install
npm run build   # regenerate media/ from the website
npm test        # 20 checks in a real DOM
npm run package # produce the .vsix
```

## Licence

MIT.
