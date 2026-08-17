# dsh-skills-manager

[![GitHub topics: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-7c3aed)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> Bilingual 中英双语：English first, 中文译文在后。

## English

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

---

## 中文

正式（composition 挂载）的 DeepSeek Harness 插件：Web 插件设置里的一个 **Skills 管理** 标签页，按 skill 注册表 scope 分层（`@deepseek-ai/dsh-skill` + `@deepseek-ai/dsh-scope`）的三个官方层级管理 agent skills。

## 官方层级

| 层级 | 注册表层 | 文件 / 注册方式 | 可写？ |
|---|---|---|---|
| **global** | host 层 — host 行与仓库插件 | `<dshHome>/skills`（`user-dsh`，rank 400）、`<agentsHome>/skills`（`user-agents`，rank 500）、随附根 | 是（用户根） |
| **preset** | 单个 agent 预设的 standing 挂载层 | `<preset-dir>/skills/`，由该预设的 `dsh-skill-filesystem` 行经 `customSkillDirs` 接入 | 仅用户预设；随附预设只读 |
| **agent** | 单个 live agent 自己的 scope 层 | 经该 agent 的 scoped context 注册的运行时技能（如动态 Cordis 插件调用 `ctx.skills.register`） | 否 — 进程内、只读视图 |

项目根（`<project>/.dsh/skills`、`<project>/.agents/skills`）只通过各自 agent 的工作区 `cwd` 进入其合并视图，本面板不管理它们。

## 它管理什么

- **列出**各层级技能：既按文件（bundle `<name>/SKILL.md` 或 flat `<name>.md`、仅一层深 — 官方 skill-filesystem 格式），也按实时注册表贡献展示官方 `source`/`provider`/invocation 徽章。
- **创建 / 编辑 / 删除** global 用户根与用户预设 `skills/` 目录里的技能文件。随附预设界面只读。删除是移入 `<dshHome>/.dsh-skills-trash/` 而非抹除。
- **原样读取**任意技能文件并附校验报告；校验镜像官方 Skill Format：kebab-case 名（`[a-z0-9]+(-[a-z0-9]+)*`）、frontmatter `name` + `description` 必填、`whenToUse` 可选、`disable-model-invocation` / `user-invocable` 布尔、拒绝驼峰拼写（官方 provider 会直接丢弃此类技能）。
- **逐预设检查接线**：其组合是否以 `customSkillDirs` 挂载 `dsh-skill-filesystem` 并指向该预设的 `skills/` 目录（随附 `standard`/`cordis` 预设接的是相对 `skills/` 目录；复制出的用户预设继承该行）。
- **查看层级独有贡献**：遮蔽 global 的 preset 层技能、遮蔽 preset 的 agent 层（运行时）技能——按官方 `agent → preset → global` 链计算注册表视图差集。
- **批量导入**到任意可写层级：zip 压缩包或整个文件夹（见下）。

## 导入（zip / 文件夹）

可写根上的「导入」按钮接受两种输入：

- **zip 压缩包** — 浏览器把压缩包以 base64 上传；host 用一个零依赖的极简 ZIP 读取器解析（EOCD → 中央目录 → 本地头；stored 与 deflate 条目）。ZIP64、条目数超 2048、单文件超 8 MB、解压总量超 64 MB 会被拒绝。
- **文件夹** — 浏览器读取所选目录（`webkitdirectory`）并直接发送文件路径与内容。

两种模式都归一为同一趟候选选择：

- 每个 `**/SKILL.md` 是一个以其父目录命名的 bundle；
- 压缩包根下的 `*.md` 是 flat 技能，单一外层包装目录（整个 skills 文件夹打包的 zip）会自动进入；
- 身份按官方规则以 frontmatter `name` 为准，地址名仅作回退；不一致会报告；
- 不安全路径（`..`、绝对路径、盘符）跳过；重名保留首个。

每个候选都用官方 Skill Format 校验（与编辑器相同），再以规范的 `<name>/SKILL.md` bundle 导入。冲突默认跳过，勾选「覆盖」时先 `.bak` 备份再覆盖；同名 flat 文件总是阻止 bundle 导入。结果报告已导入名称、逐技能跳过原因与备注。

## 架构

- `lib/index.js` — Host 半边（纯 ESM）：注入 `webServer`；经 `ctx.get` 读取 `skills`、`agentPresets`、`agents` 并优雅降级；通过 `webServer.register` 提供 `/skills-manager/*` 同源 JSON API（包在 `ctx.effect` 里，卸载即移除路由）。文件操作只针对官方根、用 `node:fs/promises`；拼接路径前先按官方语法校验名称。注册表视图用 `ctx.skills.snapshot({ cwd, scope })`，scope 解析方式与随附 api-proxy 一致：global = 无 scope，preset = `standingKeyFor(id)`，agent = live agent 本身。
- `lib/client.js` — Client 半边：`window.__ModuleLoader__.load({id, factory})` 格式的手写 web 插件 bundle；注册 `settings.plugins.tab`（id `skills`），用 `fetch` 调用 host API。唯一模块依赖：`react`。

## 安装（web profile）

```sh
dsh plugin --profile web add <this-directory>
```

并向 profile 的 `cordis.patch.yml` 加一行：

```yaml
- insert:
    - id: skills-manager
      name: 'dsh-skills-manager'
```

然后重启 `dsh web`。该行既是 host 行，也（通过 package.json 里的 `dsh.client` 字段）是浏览器 roster 行。

## 生效时机

技能文件编辑会被文件系统 provider 的 watcher（或下一次发现扫描）捕获，通常无需重启即生效。某预设的 `skills/` 目录只有在该预设组合经 `customSkillDirs` 接入时才会被发现——面板的逐预设接线行会显示该状态。

## 信任

`/skills-manager` 路由执行的变更是用户在自家 DSH home 下改文件本就能做的，且与 Web UI 同源同端口、无额外鉴权。请仅在 loopback 主机上使用本插件。
