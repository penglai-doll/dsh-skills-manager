// dsh-skills-manager — host API smoke test.
//
// Runs the real `apply()` from lib/index.js against mock services and REAL
// files in a temp dshHome/agentsHome, driving every /skills-manager route the
// way the web server would. This validates the complete host API contract
// (levels listing, file CRUD, validation, layer-scoped registry views) without
// needing a running DSH process.

import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { buildZip } from './zip-fixture.mjs'

// ---- temp fixture dirs inside the workspace (sandbox-friendly) ---------------
const base = await mkdtemp(join(process.cwd(), '.smoke-tmp-'))
const dshHome = join(base, 'dsh-home')
const agentsHome = join(base, 'agents-home')
const userPresetDir = join(dshHome, '.agent-presets', 'my-preset')
const shippedDir = join(base, 'shipped-preset')
const workspace = join(base, 'project')

process.env.DSH_HOME = dshHome
process.env.DSH_AGENTS_HOME = agentsHome

const cleanup = async () => { await rm(base, { recursive: true, force: true }) }

function fail(msg) {
  throw new Error(msg)
}

function ok(msg) {
  console.log('✓ ' + msg)
}

// ---- mock services -------------------------------------------------------------

const presetKey = { kind: 'preset-key', id: 'my-preset' }
const shippedKey = { kind: 'preset-key', id: 'shipped' }
const agentObj = {
  id: 'agent-1',
  status: 'idle',
  ctx: { marker: 'agent-ctx' },
  session: { header: { cwd: workspace } },
}

const GLOBAL_SKILLS = [
  {
    name: 'global-skill', description: 'global layer skill', whenToUse: undefined,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-dsh', provider: 'filesystem',
    resourceBase: { kind: 'directory', path: join(dshHome, 'skills') },
  },
]
const PRESET_SKILLS = [
  ...GLOBAL_SKILLS,
  {
    name: 'preset-skill', description: 'preset layer skill', whenToUse: undefined,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom', provider: 'filesystem',
    resourceBase: { kind: 'directory', path: join(userPresetDir, 'skills') },
  },
]
const AGENT_SKILLS = [
  ...PRESET_SKILLS,
  {
    name: 'agent-skill', description: 'agent layer runtime skill', whenToUse: undefined,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'runtime', provider: 'runtime', resourceBase: undefined,
  },
]

const mockSkills = {
  snapshot({ scope }) {
    const list = scope === undefined ? GLOBAL_SKILLS
      : scope === presetKey ? PRESET_SKILLS
      : scope === agentObj ? AGENT_SKILLS
      : GLOBAL_SKILLS
    return Promise.resolve({ complete: true, skills: list })
  },
}

const wiredComposition = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n  config:\n    customSkillDirs:\n      - !!js \"process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))\"\n- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'\n"
const bareComposition = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n"

const mockPresets = {
  defaultId: 'my-preset',
  authorable: true,
  async list() {
    return [
      { id: 'my-preset', trust: 'user', path: join(userPresetDir, 'agent.cordis.yml'), broken: null },
      { id: 'shipped', trust: 'system', path: join(shippedDir, 'agent.cordis.yml'), broken: null },
    ]
  },
  async read(id) {
    if (id === 'my-preset') return wiredComposition
    if (id === 'shipped') return bareComposition
    throw new Error('unknown preset ' + id)
  },
  async standingKeyFor(id) {
    if (id === 'my-preset') return presetKey
    if (id === 'shipped') return shippedKey
    throw new Error('unknown preset ' + id)
  },
  composedPreset() { return 'my-preset' },
  serviceFor() { return mockSkills },
}

const mockAgents = {
  list() { return [agentObj] },
  get(id) { return id === agentObj.id ? agentObj : undefined },
}

// ---- harness wiring -------------------------------------------------------------

let capturedHandler = null
let webServerDisposed = false
const mockWebServer = {
  register({ path, handler }) {
    if (path !== '/skills-manager') throw new Error('unexpected path ' + path)
    capturedHandler = handler
    return () => { webServerDisposed = true }
  },
}

const ctx = {
  webServer: mockWebServer, // injected hard dependency
  get: (name) => (name === 'skills' ? mockSkills : name === 'agentPresets' ? mockPresets : name === 'agents' ? mockAgents : undefined),
  effect: (fn) => { fn() },
}

apply(ctx)
if (capturedHandler === null) fail('webServer.register 未被调用')

// ---- route driver ----------------------------------------------------------------

function call(url, method = 'GET', body = undefined) {
  return new Promise((resolve, reject) => {
    let settled = false
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        if (settled) return
        settled = true
        let parsed = null
        try { parsed = payload ? JSON.parse(payload) : null } catch { parsed = payload }
        resolve({ status: res.statusCode, body: parsed })
      },
    }
    const req = {
      url,
      method,
      on(event, cb) {
        // 'error' registrations are accepted but never emitted.
        if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)))
        if (event === 'end') queueMicrotask(() => cb())
      },
    }
    capturedHandler(req, res).catch((e) => {
      if (!settled) { settled = true; reject(e) }
    })
  })
}

// ---- fixtures on disk ---------------------------------------------------------------

await mkdir(userPresetDir, { recursive: true })
await writeFile(join(userPresetDir, 'agent.cordis.yml'), wiredComposition, 'utf8')
await mkdir(shippedDir, { recursive: true })
await writeFile(join(shippedDir, 'agent.cordis.yml'), bareComposition, 'utf8')
await mkdir(workspace, { recursive: true })

const goodSkill = (name, desc) => '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n\n# ' + name + '\n\nbody text\n'

try {
  // 1. create at global user-dsh root
  let r = await call('/skills-manager/skill', 'POST', { root: 'global', rootKey: 'user-dsh', name: 'hello-skill', text: goodSkill('hello-skill', 'a hello skill') })
  if (!r.body.ok) fail('global 创建失败: ' + JSON.stringify(r.body))
  ok('global 创建技能成功: ' + r.body.path)
  const onDisk = await readFile(join(dshHome, 'skills', 'hello-skill', 'SKILL.md'), 'utf8')
  if (!onDisk.includes('name: hello-skill')) fail('落盘内容缺少 frontmatter name')
  ok('文件落盘于 <dshHome>/skills/hello-skill/SKILL.md')

  // 2. read back
  r = await call('/skills-manager/skill?root=global&rootKey=user-dsh&name=hello-skill')
  if (!r.body.ok || !r.body.text.includes('body text')) fail('读取回显失败')
  ok('读取回显一致（含校验报告）')

  // 3. invalid name
  r = await call('/skills-manager/skill', 'POST', { root: 'global', name: 'Hello Skill', text: goodSkill('Hello Skill', 'x') })
  if (r.body.ok || r.status !== 400) fail('非法名字未被拒绝')
  ok('非法技能名被拒绝（kebab-case）')

  // 4. missing description
  r = await call('/skills-manager/skill', 'POST', { root: 'global', name: 'no-desc', text: '---\nname: no-desc\n---\nbody' })
  if (r.body.ok || r.status !== 400) fail('缺 description 未被拒绝')
  ok('缺 description 的 frontmatter 被拒绝')

  // 5. camelCase invocation field
  r = await call('/skills-manager/validate', 'POST', { name: 'x-skill', text: '---\nname: x-skill\ndescription: x\ndisableModelInvocation: true\n---\n' })
  if (r.body.ok) fail('驼峰 invocation 字段未被拒绝')
  ok('驼峰 disableModelInvocation 被拒绝（官方 fail-closed）')

  // 6. flat-file conflict
  await mkdir(join(dshHome, 'skills'), { recursive: true })
  await writeFile(join(dshHome, 'skills', 'flat-one.md'), goodSkill('flat-one', 'flat'), 'utf8')
  r = await call('/skills-manager/skill', 'POST', { root: 'global', name: 'flat-one', text: goodSkill('flat-one', 'bundle') })
  if (r.body.ok) fail('同名 flat 与 bundle 冲突未被拒绝')
  ok('同名 flat 文件冲突被拒绝')

  // 7. levels overview
  r = await call('/skills-manager/levels')
  if (!r.body.ok) fail('levels 失败: ' + JSON.stringify(r.body))
  const g = r.body.global.roots.find((x) => x.key === 'user-dsh')
  if (!g || !g.skills.some((s) => s.name === 'hello-skill')) fail('levels 缺 global 技能')
  const p = r.body.presets.find((x) => x.id === 'my-preset')
  if (!p || p.wiring.status !== 'custom' || !p.wiring.wired) fail('preset wiring 检测失败: ' + JSON.stringify(p && p.wiring))
  const shipped = r.body.presets.find((x) => x.id === 'shipped')
  if (!shipped || shipped.wiring.status !== 'default-only') fail('shipped wiring 状态应为 default-only')
  if (!r.body.agents.some((a) => a.id === 'agent-1' && a.preset === 'my-preset')) fail('agent 列表失败')
  ok('levels 总览正常（roots/presets/wiring/agents）')

  // 8. preset-level create (user preset)
  r = await call('/skills-manager/skill', 'POST', { root: 'preset', presetId: 'my-preset', name: 'preset-hello', text: goodSkill('preset-hello', 'preset skill') })
  if (!r.body.ok) fail('preset 创建失败: ' + JSON.stringify(r.body))
  await stat(join(userPresetDir, 'skills', 'preset-hello', 'SKILL.md'))
  ok('preset 层创建成功（<preset>/skills/preset-hello/SKILL.md）')

  // 9. shipped preset is read-only
  r = await call('/skills-manager/skill', 'POST', { root: 'preset', presetId: 'shipped', name: 'nope', text: goodSkill('nope', 'x') })
  if (r.body.ok) fail('随附 preset 未被拒绝写入')
  ok('随附 preset 写入被拒绝（只读）')

  // 10. delete moves to trash
  r = await call('/skills-manager/skill/delete', 'POST', { root: 'global', name: 'hello-skill' })
  if (!r.body.ok) fail('删除失败: ' + JSON.stringify(r.body))
  let gone = false
  try { await stat(join(dshHome, 'skills', 'hello-skill')) } catch { gone = true }
  if (!gone) fail('删除后目录仍在')
  const trashEntries = await readdir(join(dshHome, '.dsh-skills-trash'))
  if (!trashEntries.some((t) => t.startsWith('hello-skill-'))) fail('回收站没有该技能')
  ok('删除移入回收站 <dshHome>/.dsh-skills-trash/')

  // 11. registry views: global / preset / agent
  r = await call('/skills-manager/registry?scope=global')
  if (!r.body.available || !r.body.skills.some((s) => s.name === 'global-skill')) fail('global 注册视图失败')
  ok('global 注册视图正常')

  r = await call('/skills-manager/registry?scope=preset:my-preset')
  if (!r.body.exclusive.includes('preset-skill') || r.body.exclusive.includes('global-skill')) fail('preset 层独有计算错误: ' + JSON.stringify(r.body.exclusive))
  ok('preset 层注册视图 + 层独有计算正常')

  r = await call('/skills-manager/registry?scope=agent:agent-1')
  // Agent view minus ITS PRESET view: only the agent-layer runtime skill is
  // exclusive; preset-layer skills stay owned by the preset layer.
  if (JSON.stringify(r.body.exclusive) !== JSON.stringify(['agent-skill'])) fail('agent 层独有计算错误: ' + JSON.stringify(r.body.exclusive))
  if (r.body.preset !== 'my-preset' || r.body.cwd !== workspace) fail('agent 视图 preset/cwd 错误')
  ok('agent 层注册视图（cwd/preset/层独有）正常')

  r = await call('/skills-manager/registry?scope=preset:missing')
  if (r.body.available) fail('未知 preset 未被报错')
  ok('未知 preset 的视图请求正确报错')

  // 12. import: entries mode (folder pick) with wrapper paths + bad candidates
  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'global', rootKey: 'user-dsh', overwrite: false, mode: 'entries',
    entries: [
      { path: 'PickedFolder/import-a/SKILL.md', text: goodSkill('import-a', 'imported a') },
      { path: 'PickedFolder/import-b/SKILL.md', text: goodSkill('import-b', 'imported b') },
      { path: '../evil/SKILL.md', text: goodSkill('evil', 'x') },
      { path: 'PickedFolder/bad-one/SKILL.md', text: '---\nname: bad-one\n---\nmissing description' },
    ],
  })
  if (!r.body.ok) fail('entries 导入失败: ' + JSON.stringify(r.body))
  if (r.body.imported.length !== 2) fail('应导入 2 个，实际: ' + JSON.stringify(r.body))
  if (!r.body.notes.some((n) => n.includes('不安全路径'))) fail('不安全路径未提示: ' + JSON.stringify(r.body.notes))
  if (!r.body.skipped.some((s) => s.name === 'bad-one' && s.reason.includes('校验失败'))) fail('校验失败项未跳过')
  if (!r.body.notes.some((n) => n.includes('单一外层目录'))) fail('wrapper 提示缺失')
  await stat(join(dshHome, 'skills', 'import-a', 'SKILL.md'))
  await stat(join(dshHome, 'skills', 'import-b', 'SKILL.md'))
  ok('entries（文件夹）模式导入成功，wrapper 自动展开，非法项跳过')

  // 13. re-import without overwrite → conflicts skipped
  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'global', rootKey: 'user-dsh', overwrite: false, mode: 'entries',
    entries: [{ path: 'import-a/SKILL.md', text: goodSkill('import-a', 'v2') }],
  })
  if (r.body.imported.length !== 0 || !r.body.skipped.some((s) => s.name === 'import-a' && s.reason.includes('已存在'))) fail('冲突策略错误: ' + JSON.stringify(r.body))
  ok('同名冲突（未覆盖）被跳过')

  // 14. overwrite=true → rewritten with .bak backup
  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'global', rootKey: 'user-dsh', overwrite: true, mode: 'entries',
    entries: [{ path: 'import-a/SKILL.md', text: goodSkill('import-a', 'v2') }],
  })
  if (r.body.imported.length !== 1) fail('覆盖导入失败: ' + JSON.stringify(r.body))
  const v2 = await readFile(join(dshHome, 'skills', 'import-a', 'SKILL.md'), 'utf8')
  if (!v2.includes('v2')) fail('覆盖后内容未更新')
  await stat(join(dshHome, 'skills', 'import-a', 'SKILL.md.bak'))
  ok('覆盖导入生效并留下 .bak 备份')

  // 15. zip mode: real zip payload (deflate + stored), one new one conflicting
  const zipBuf = buildZip([
    { name: 'skills-pack/zip-skill/SKILL.md', method: 8, data: goodSkill('zip-skill', 'from zip') },
    { name: 'skills-pack/import-b/SKILL.md', method: 0, data: goodSkill('import-b', 'zip conflict') },
  ])
  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'global', rootKey: 'user-dsh', overwrite: false, mode: 'zip',
    zipBase64: zipBuf.toString('base64'),
  })
  if (!r.body.ok || r.body.imported.length !== 1 || r.body.imported[0].name !== 'zip-skill') fail('zip 导入失败: ' + JSON.stringify(r.body))
  if (!r.body.skipped.some((s) => s.name === 'import-b' && s.reason.includes('已存在'))) fail('zip 冲突策略错误: ' + JSON.stringify(r.body))
  const zipSkill = await readFile(join(dshHome, 'skills', 'zip-skill', 'SKILL.md'), 'utf8')
  if (!zipSkill.includes('from zip')) fail('zip 导入内容错误')
  ok('zip 模式导入成功（deflate+stored 均解析，冲突跳过）')

  // 16. zip mode with garbage payload
  r = await call('/skills-manager/skill/import', 'POST', { root: 'global', mode: 'zip', zipBase64: 'aGVsbG8=' })
  if (r.body.ok || r.status !== 400) fail('垃圾 zip 未被拒绝')
  ok('非法 zip 载荷被拒绝')

  // 17. preset target import works; shipped preset rejects
  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'preset', presetId: 'my-preset', mode: 'entries',
    entries: [{ path: 'preset-imp/SKILL.md', text: goodSkill('preset-imp', 'preset imported') }],
  })
  if (!r.body.ok || r.body.imported.length !== 1) fail('preset 导入失败: ' + JSON.stringify(r.body))
  await stat(join(userPresetDir, 'skills', 'preset-imp', 'SKILL.md'))
  ok('preset 层导入成功')

  r = await call('/skills-manager/skill/import', 'POST', {
    root: 'preset', presetId: 'shipped', mode: 'entries',
    entries: [{ path: 'nope/SKILL.md', text: goodSkill('nope', 'x') }],
  })
  if (r.body.ok) fail('随附 preset 导入未被拒绝')
  ok('随附 preset 导入被拒绝（只读）')

  // 18. unknown route
  r = await call('/skills-manager/nope')
  if (r.status !== 404) fail('未知路由未返回 404')
  ok('未知路由返回 404')

  console.log('\n全部 smoke 用例通过 ✔')
} catch (e) {
  console.error('✗ ' + (e && e.message ? e.message : e))
  await cleanup()
  process.exit(1)
}

await cleanup()
console.log('临时目录已清理: ' + base)
