# Publishing

`npm run preflight` checks everything that can be checked without an account.
It currently reports two blockers, and both need you — neither can be
automated away.

## Two registries, not one

This matters more than it sounds: **the VS Code Marketplace and Open VSX are
separate, and the forks only read Open VSX.**

| Registry | Who installs from it |
|---|---|
| **VS Code Marketplace** | Microsoft's VS Code only |
| **Open VSX** | Cursor, VSCodium, Windsurf, Gitpod, Theia |

You use Cursor. If you publish only to the Marketplace, you will not be able
to install your own extension from inside your own editor. Publish to both.

Open VSX is the easier of the two and has far less competition in search —
for a project whose whole point is borrowing distribution, it is arguably the
one that matters.

## 1. Open VSX

1. Sign in at <https://open-vsx.org> with GitHub.
2. Settings → Access Tokens → generate one. Treat it like a password; don't
   paste it into a chat window. Put it in your environment instead:
   `$env:OVSX_PAT = "<token>"` (PowerShell, current session only).
3. Claim the namespace and publish:

```sh
npx --yes ovsx create-namespace abhinai20 -p $env:OVSX_PAT
npm run build && npm test
npx --yes ovsx publish devops-toolbox-0.1.0.vsix -p $env:OVSX_PAT
```

The namespace must match the `publisher` field in `package.json`.

## 2. VS Code Marketplace

1. Create an Azure DevOps organisation at <https://dev.azure.com> (free; a
   Microsoft account is enough).
2. User settings → Personal Access Tokens → New Token:
   - **Organization:** All accessible organizations ← the usual mistake; a
     single-org token fails with a confusing 401
   - **Scopes:** Custom defined → Marketplace → **Manage**
3. Create the publisher at <https://marketplace.visualstudio.com/manage>. The
   publisher ID must match `publisher` in `package.json` (currently
   `abhinai20`, which is not yet registered).
4. Log in once, then publish:

```sh
npx --yes @vscode/vsce login abhinai20   # prompts for the PAT, stores it
npm run publish                           # build + test + preflight + publish
```

## 3. Before either

Fix the second preflight blocker — `package.json` points `repository` at
`https://github.com/Abhinai20/devops-toolbox-vscode`, which doesn't exist. A
dead "Repository" link is the first thing on a new listing that makes it look
abandoned. Either:

```sh
git init && git add . && git commit -m "DevOps Toolbox for VS Code"
gh repo create devops-toolbox-vscode --public --source=. --push
```

…or delete the `repository` block from `package.json`.

## Versions are permanent

A published version number can never be reused. Publishing `0.1.0` with a
broken link means the fix ships as `0.1.1` and the bad version stays in the
history. That is why `npm run publish` runs the build, the tests and the
preflight first, and why it refuses to proceed while any blocker stands.

## Updating later

```sh
npm version patch     # or minor / major
npm run publish       # and the ovsx publish line above, for the forks
```

Re-run `npm run build` after any change to the website — the tools live
there, not here.
