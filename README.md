# dsh-skills-manager

[![GitHub topics: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-7c3aed)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Formal (composition-mounted) DeepSeek Harness plugin: a **Skills 管理** tab in the
Web Plugins settings section that manages agent skills at the three official
hierarchy levels of the skill registry's scope layering
(`@deepseek-ai/dsh-skill` + `@deepseek-ai/dsh-scope`).

## The official levels

| Level | Registry layer | Files / registration | Writable? |
|---|---|---|---|
| **global** | host layer — host rows and repository plugins | `<dshHome>/skills` (`user-dsh`, rank 400), `<agentsHome>/skills` (`user-agents`, rank 500), bundled root | yes (user roots) |
| **preset** | one agent preset's standing mount layer | `<preset-dir>/skills/`, wired by the preset's `dsh-skill-filesystem` row via `customSkillDirs` | user presets only; shipped presets read-only |
| **agent** | one live agent's own scope layer | runtime skills registered through that agent's scoped context (e.g. dynamic Cordis plugins calling `ctx.skills.register`) | no — process-local, read-only view |

Project roots (`<project>/.dsh/skills`, `<project>/.agents/skills`) only enter
each agent's merged view through its workspace `cwd`; they are not managed by
this panel.

## What it manages

- **List** skills at each level, both as files (bundle `<name>/SKILL.md` or flat
  `<name>.md`, one level deep — the official skill-filesystem format) and as the
  live registry contribution with official `source`/`provider`/invocation badges.
- **Create / edit / delete** skill files in the global user roots and in user
  presets' `skills/` directories. Shipped presets are read-only in the UI.
  Deletes move the skill into `<dshHome>/.dsh-skills-trash/` instead of erasing.
- **Read** any skill file verbatim, with a validation report; validation mirrors
  the official Skill Format: kebab-case name (`[a-z0-9]+(-[a-z0-9]+)*`),
  frontmatter `name` + `description` required, `whenToUse` optional,
  `disable-model-invocation` / `user-invocable` booleans, and camelCase spellings
  rejected (the official provider drops such skills outright).
- **Inspect wiring** per preset: whether its composition mounts
  `dsh-skill-filesystem` with `customSkillDirs` pointing at the preset's
  `skills/` directory (the shipped `standard`/`cordis` presets wire a relative
  `skills/` dir; a copied user preset inherits that row).
- **View layer-exclusive contributions**: preset-layer skills that shadow
  global, and agent-layer (runtime) skills that shadow the preset — computed as
  the registry view diff along the official `agent → preset → global` chain.
- **Batch import** into any writable level from a zip archive or a whole
  folder (see below).

## Import (zip / folder)

The 导入 button on a writable root accepts two input modes:

- **zip 压缩包** — the browser uploads the archive as base64; the host parses
  it with a minimal zero-dependency ZIP reader (EOCD → central directory →
  local headers; stored and deflate entries). ZIP64, entry counts over 2048,
  files over 8 MB, and total extraction over 64 MB are rejected.
- **文件夹** — the browser reads the picked directory (`webkitdirectory`) and
  sends file paths plus contents directly.

Both modes normalize into one candidate-selection pass:

- every `**/SKILL.md` is a bundle named by its parent directory;
- `*.md` at the archive root is a flat skill, and a single outer wrapper
  directory (a zip of a whole skills folder) is descended into automatically;
- the identity follows the official rule — the frontmatter `name` — with the
  address name only as fallback; mismatches are reported;
- unsafe paths (`..`, absolute, drive-letter) are skipped; duplicate names keep
  the first occurrence.

Every candidate is validated with the official Skill Format checks (same as the
editor), then imported as a canonical `<name>/SKILL.md` bundle. Conflicts are
skipped by default, or overwritten with a `.bak` backup when 覆盖 is checked; a
same-name flat file always blocks a bundle import. The result reports imported
names, per-skill skip reasons, and notes.

## Architecture

- `lib/index.js` — Host half (plain ESM): injects `webServer`; reads `skills`,
  `agentPresets`, `agents` through `ctx.get` with graceful degradation; serves a
  same-origin JSON API under `/skills-manager/*` via `webServer.register`
  (wrapped in `ctx.effect`, so teardown removes the routes). File operations use
  `node:fs/promises` against the official roots only; names are validated with
  the official grammar before any path is joined. Registry views use
  `ctx.skills.snapshot({ cwd, scope })` with the scope resolved the same way the
  shipped api-proxy does: global = no scope, preset = `standingKeyFor(id)`,
  agent = the live agent itself.
- `lib/client.js` — Client half: a hand-written web plugin bundle in the
  `window.__ModuleLoader__.load({id, factory})` format; registers
  `settings.plugins.tab` (id `skills`) and calls the host API with `fetch`.
  Only module dependency: `react`.

## Installation (web profile)

```sh
dsh plugin --profile web add <this-directory>
```

and add one row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: skills-manager
      name: 'dsh-skills-manager'
```

Then restart `dsh web`. The row is both a host row and (via the `dsh.client`
field in package.json) a browser roster row.

## Effect timing

Skill file edits are picked up by the filesystem provider's watcher (or by the
next discovery pass), so they normally take effect without a restart. A preset's
`skills/` directory is only discovered when that preset's composition wires it
via `customSkillDirs` — the panel's per-preset wiring line shows that status.

## Trust

The `/skills-manager` routes perform the same mutations a user could make by
editing files under their own DSH home, and are served on the same host/port as
the Web UI with no additional auth. Keep this plugin on loopback hosts.
