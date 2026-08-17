// dsh-skills-manager — Host half.
//
// A formal (composition-mounted) plugin that manages agent skills at the three
// official hierarchy levels defined by the skill registry's scope layering
// (@deepseek-ai/dsh-skill + @deepseek-ai/dsh-scope):
//
//   global — the host layer: skills the deployment registers globally. Its
//            writable file roots are <dshHome>/skills (owned by
//            dsh-skill-filesystem) and <agentsHome>/skills.
//   preset — one agent preset's standing layer: <preset-dir>/skills, wired
//            into discovery by the preset's own `skill-filesystem` row with
//            customSkillDirs. Shipped presets are read-only; user presets
//            (under <dshHome>/.agent-presets) are writable.
//   agent  — one live agent's own layer: runtime skills registered through
//            that agent's scoped context (e.g. dynamic Cordis plugins of that
//            session). Process-local and read-only from this panel.
//
// The host half serves a same-origin JSON API under /skills-manager/* for the
// client half. File management mirrors the official skill format from
// dsh-skill-filesystem: directory bundles (<name>/SKILL.md) or flat Markdown
// files (<name>.md), frontmatter with required `name`/`description` and
// optional `whenToUse`, `disable-model-invocation`, `user-invocable`.
//
// Trust: the routes are served on the same host/port as the Web UI itself and
// perform the same mutations a user could make by editing files under their
// own DSH home. No auth is added beyond that boundary; keep this plugin on
// loopback hosts.

import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

export const name = 'skills-manager'
export const inject = ['webServer']

// Official skill-name grammar (@deepseek-ai/dsh-skill isSkillName).
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function errText(e) {
  if (e == null) return 'unknown error'
  if (typeof e === 'object' && e.message != null) return String(e.message)
  return String(e)
}

export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_RE.test(name)
}

// ---- light YAML-scalar parsing (for frontmatter display/validation) ---------
//
// The official provider parses frontmatter with the full `yaml` package. This
// plugin never round-trips YAML: files are read and written verbatim, and this
// parser only extracts the small set of top-level scalar fields the official
// Skill Format defines. Anything it cannot parse is kept untouched.

export function parseScalarValue(raw) {
  const t = String(raw ?? '').trim()
  if (t === '') return ''
  if (/^(true|yes|on)$/i.test(t)) return true
  if (/^(false|no|off)$/i.test(t)) return false
  if (/^(null|~)$/i.test(t)) return null
  if (/^-?\d+$/.test(t)) return parseInt(t, 10)
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t)
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'")
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t) } catch { return t.slice(1, -1) }
  }
  return t
}

export function parseFrontmatter(text) {
  const s = String(text ?? '')
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n[\s\S]*)?$/.exec(s)
  if (!m) return { present: false, data: {}, body: s }
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const km = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (!km) continue
    data[km[1]] = parseScalarValue(km[2])
  }
  return { present: true, data, body: m[2] == null ? '' : m[2] }
}

// Validate a skill file the way the official provider consumes it. `address`
// is the directory/file name the skill is addressed by.
export function validateSkillText(address, text) {
  const errors = []
  const warnings = []
  const fm = parseFrontmatter(text)
  if (!isSkillName(address)) {
    errors.push('技能名必须匹配官方 kebab-case 语法 [a-z0-9]+(-[a-z0-9]+)*: ' + address)
  }
  if (!fm.present) {
    errors.push('缺少 YAML frontmatter（文件需以 --- 开头并以 --- 结束 frontmatter 块）')
  } else {
    if (Object.hasOwn(fm.data, 'disableModelInvocation') || Object.hasOwn(fm.data, 'userInvocable')) {
      errors.push('不支持驼峰拼写 disableModelInvocation / userInvocable，官方字段是 disable-model-invocation / user-invocable')
    }
    if (Object.hasOwn(fm.data, 'disable-model-invocation') && typeof fm.data['disable-model-invocation'] !== 'boolean') {
      errors.push('frontmatter 字段 disable-model-invocation 必须是布尔值（true/false）')
    }
    if (Object.hasOwn(fm.data, 'user-invocable') && typeof fm.data['user-invocable'] !== 'boolean') {
      errors.push('frontmatter 字段 user-invocable 必须是布尔值（true/false）')
    }
    const fmName = fm.data.name
    if (fmName === undefined || String(fmName).trim() === '') {
      errors.push('frontmatter 缺少必填字段 name')
    } else if (!isSkillName(String(fmName))) {
      errors.push('frontmatter name 必须匹配官方 kebab-case 语法: ' + fmName)
    } else if (String(fmName) !== address) {
      warnings.push('frontmatter name "' + fmName + '" 与目录/文件名 "' + address + '" 不一致；官方发现以 frontmatter name 为准，建议保持一致')
    }
    if (fm.data.description === undefined || String(fm.data.description).trim() === '') {
      errors.push('frontmatter 缺少必填字段 description')
    }
    if (Object.hasOwn(fm.data, 'whenToUse') && typeof fm.data.whenToUse !== 'string') {
      warnings.push('可选的 whenToUse 字段不是字符串，官方 provider 会忽略该字段')
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

// ---- skill file addressing ---------------------------------------------------
//
// Official discovery recognizes <root>/<name>/SKILL.md (bundle) and
// <root>/<name>.md (flat), one level deep.

function bundleDir(root, name) { return join(root, name) }
function bundleFile(root, name) { return join(root, name, 'SKILL.md') }
function flatFile(root, name) { return join(root, name + '.md') }

async function fileExists(p) {
  try { await readFile(p); return true } catch { return false }
}

async function listSkillsRoot(rootPath) {
  const out = []
  let entries
  try {
    entries = await readdir(rootPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return { exists: false, skills: [] }
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const sf = join(rootPath, entry.name, 'SKILL.md')
      if (!(await fileExists(sf))) continue
      out.push(await describeSkill(entry.name, 'bundle', sf))
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name.length > 3) {
      const f = join(rootPath, entry.name)
      out.push(await describeSkill(entry.name.slice(0, -3), 'flat', f))
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return { exists: true, skills: out }
}

async function describeSkill(name, kind, file) {
  let fm = { present: false, data: {} }
  try {
    fm = parseFrontmatter(await readFile(file, 'utf8'))
  } catch {
    // unreadable file: still list it, without frontmatter details
  }
  const d = fm.data
  return {
    name,
    kind,
    file,
    fmName: typeof d.name === 'string' ? d.name : null,
    description: typeof d.description === 'string' ? d.description : null,
    whenToUse: typeof d.whenToUse === 'string' ? d.whenToUse : null,
    disableModelInvocation: d['disable-model-invocation'] === true,
    userInvocable: d['user-invocable'] !== false,
    frontmatterPresent: fm.present,
  }
}

async function findSkillFile(rootPath, name) {
  const b = bundleFile(rootPath, name)
  if (await fileExists(b)) return { kind: 'bundle', file: b, dir: bundleDir(rootPath, name) }
  const f = flatFile(rootPath, name)
  if (await fileExists(f)) return { kind: 'flat', file: f, dir: rootPath }
  return null
}

// ---- composition wiring check -------------------------------------------------
//
// A preset's skills/ directory is only scanned when its composition mounts
// dsh-skill-filesystem with customSkillDirs referencing it (the shipped
// `standard`/`cordis` presets wire a `skills/` directory relative to the
// preset's own baseUrl). This is a textual check, mirroring the row shape; the
// live registry remains the authoritative view.

export function parseCompositionRows(text) {
  const lines = String(text).split(/\r?\n/)
  const rows = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^- id:\s*(\S+)\s*$/.exec(line)
    if (m) {
      current = { rowId: m[1], name: '', start: i, end: i }
      rows.push(current)
      continue
    }
    if (current === null) continue
    current.end = i
    if (/^\s{2}name:\s*.*$/.test(line) && current.name === '') {
      current.name = line.slice(2).replace(/^name:\s*/, '').replace(/^['"]|['"]$/g, '').trim()
    }
  }
  return rows
}

export function presetWiring(text) {
  const lines = String(text).split(/\r?\n/)
  const rows = parseCompositionRows(text)
  const sf = rows.filter((r) => r.name.includes('dsh-skill-filesystem'))
  if (sf.length === 0) {
    return { status: 'absent', note: '该预设没有 dsh-skill-filesystem 行，skills/ 目录不会被扫描', dirs: [], wired: false }
  }
  const dirs = []
  for (const r of sf) {
    for (let i = r.start + 1; i <= r.end; i++) {
      const line = lines[i]
      if (/^\s{4}customSkillDirs:\s*$/.test(line)) {
        for (let j = i + 1; j <= r.end; j++) {
          const item = lines[j]
          if (/^\s*$/.test(item)) continue
          if (!/^\s{5,}-/.test(item)) break
          dirs.push(item.replace(/^\s*-\s*/, '').trim())
        }
        break
      }
    }
  }
  const wired = dirs.some((d) => /skills[\\/]/.test(d))
  if (dirs.length === 0) {
    return { status: 'default-only', note: '有 dsh-skill-filesystem 行但没有 customSkillDirs，只扫描默认根，不包含本预设的 skills/ 目录', dirs: [], wired: false }
  }
  return { status: 'custom', note: 'dsh-skill-filesystem 行配置了 customSkillDirs', dirs, wired }
}

// ---- official root resolution --------------------------------------------------

function dshHome() {
  const v = process.env.DSH_HOME
  return v && v.trim() ? v.trim() : join(homedir(), '.dsh')
}

function agentsHome() {
  const v = process.env.DSH_AGENTS_HOME
  return v && v.trim() ? v.trim() : join(homedir(), '.agents')
}

function trashRoot() {
  return join(dshHome(), '.dsh-skills-trash')
}

// ---- registry (scope-layered) views --------------------------------------------

function plainSkill(s) {
  return {
    name: String(s.name),
    description: String(s.description ?? ''),
    whenToUse: s.whenToUse == null ? null : String(s.whenToUse),
    modelInvocable: !!(s.invocation && s.invocation.modelInvocable),
    userInvocable: !!(s.invocation && s.invocation.userInvocable),
    source: String(s.source ?? ''),
    provider: String(s.provider ?? ''),
    resourceBasePath: s.resourceBase && s.resourceBase.kind === 'directory' ? String(s.resourceBase.path) : null,
  }
}

async function registryView(registry, cwd, scope) {
  if (registry === undefined) return { available: false, complete: false, skills: [], error: null }
  try {
    const snap = await registry.snapshot({ cwd, scope })
    return { available: true, complete: snap.complete, skills: snap.skills.map(plainSkill), error: null }
  } catch (e) {
    return { available: true, complete: false, skills: [], error: errText(e) }
  }
}

export function diffNames(view, base) {
  const baseNames = new Set((base || []).map((s) => s.name))
  return (view || []).filter((s) => !baseNames.has(s.name)).map((s) => s.name)
}

// ---- skill import (zip archive / folder entries) --------------------------------
//
// Two input modes normalize into the same shape — [{ path, text }] — before one
// candidate-selection pass:
//   - zip: base64 archive parsed here with a minimal, zero-dependency ZIP
//     reader (EOCD → central directory → local headers; stored + deflate).
//   - entries: the browser reads a picked folder (webkitdirectory) and sends
//     file paths + contents directly.
// Candidate rules mirror the official discovery shape: any **/SKILL.md is a
// bundle named by its parent directory, and *.md directly at the archive root
// (or under a single wrapper directory) is a flat skill. Everything else is
// ignored with a note. Every candidate is validated with the official Skill
// Format checks before being written as a <name>/SKILL.md bundle.

const ZIP_EOCD_SIG = 0x06054b50
const ZIP_CENTRAL_SIG = 0x02014b50
const ZIP_LOCAL_SIG = 0x04034b50
export const IMPORT_MAX_FILES = 2048
export const IMPORT_MAX_FILE_BYTES = 8 * 1024 * 1024
export const IMPORT_MAX_TOTAL_BYTES = 64 * 1024 * 1024

export function normalizeImportPath(p) {
  const s = String(p).replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(s) || s.startsWith('/')) return null
  const segs = s.split('/').filter((x) => x !== '' && x !== '.')
  if (segs.length === 0 || segs.some((x) => x === '..')) return null
  return segs.join('/')
}

export function parseZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return { error: '不是有效的 zip 文件（内容太短）' }
  let eocd = -1
  const minEocd = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) return { error: '找不到 zip 结束标记（EOCD），不是标准的 zip 压缩包' }
  const total = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdOffset === 0xffffffff) return { error: '不支持 ZIP64 压缩包' }
  if (total > IMPORT_MAX_FILES) return { error: 'zip 内条目过多（超过 ' + IMPORT_MAX_FILES + '）' }
  const files = []
  const notes = []
  let p = cdOffset
  let totalBytes = 0
  for (let n = 0; n < total; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== ZIP_CENTRAL_SIG) return { error: 'zip 中央目录损坏（第 ' + (n + 1) + ' 条）' }
    const flags = buffer.readUInt16LE(p + 8)
    const method = buffer.readUInt16LE(p + 10)
    const compSize = buffer.readUInt32LE(p + 20)
    const uncompSize = buffer.readUInt32LE(p + 24)
    const fnLen = buffer.readUInt16LE(p + 28)
    const extraLen = buffer.readUInt16LE(p + 30)
    const commentLen = buffer.readUInt16LE(p + 32)
    const localOffset = buffer.readUInt32LE(p + 42)
    const name = buffer.subarray(p + 46, p + 46 + fnLen).toString(flags & 0x800 ? 'utf8' : 'utf8')
    const isDir = name.endsWith('/') || (buffer.readUInt16LE(p + 38) & 0x10) !== 0
    p += 46 + fnLen + extraLen + commentLen
    if (isDir) continue
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) return { error: '不支持 ZIP64 条目: ' + name }
    if (uncompSize > IMPORT_MAX_FILE_BYTES) { notes.push('跳过超大条目（> ' + IMPORT_MAX_FILE_BYTES + ' 字节）: ' + name); continue }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) return { error: 'zip 本地文件头损坏: ' + name }
    const lfnLen = buffer.readUInt16LE(localOffset + 26)
    const lextraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lfnLen + lextraLen
    if (dataStart + compSize > buffer.length) return { error: 'zip 数据越界: ' + name }
    let content
    if (method === 0) {
      content = buffer.subarray(dataStart, dataStart + compSize)
    } else if (method === 8) {
      try {
        content = inflateRawSync(buffer.subarray(dataStart, dataStart + compSize))
      } catch {
        notes.push('解压失败，跳过: ' + name)
        continue
      }
    } else {
      notes.push('不支持的压缩方法 ' + method + '，跳过: ' + name)
      continue
    }
    if (content.length > IMPORT_MAX_FILE_BYTES) { notes.push('跳过超大条目（> ' + IMPORT_MAX_FILE_BYTES + ' 字节）: ' + name); continue }
    totalBytes += content.length
    if (totalBytes > IMPORT_MAX_TOTAL_BYTES) return { error: 'zip 解压总量超过 ' + IMPORT_MAX_TOTAL_BYTES + ' 字节' }
    const path = normalizeImportPath(name)
    if (path === null) { notes.push('跳过不安全路径: ' + name); continue }
    files.push({ path, text: content.toString('utf8') })
  }
  return { files, notes }
}

export function selectImportCandidates(files) {
  const notes = []
  const entries = []
  for (const f of files) {
    const path = normalizeImportPath(f && f.path)
    if (path === null) { notes.push('跳过不安全路径: ' + (f && f.path)); continue }
    entries.push({ path, text: String((f && f.text) ?? '') })
  }
  if (entries.length === 0) return { candidates: [], notes }
  // Bundle candidates are self-describing at any depth: every **/SKILL.md is a
  // bundle named by its parent directory. Flat candidates are ambiguous, so
  // their view root follows a wrapper heuristic: with exactly one root
  // directory and no root files, *.md directly inside that directory counts.
  const rootFiles = entries.filter((e) => !e.path.includes('/'))
  const rootDirs = new Set(entries.filter((e) => e.path.includes('/')).map((e) => e.path.split('/')[0]))
  const flatRoot = rootFiles.length === 0 && rootDirs.size === 1 ? [...rootDirs][0] + '/' : ''
  if (flatRoot !== '') notes.push('检测到单一外层目录，自动进入: ' + flatRoot)
  const candidates = []
  const seen = new Set()
  for (const e of entries) {
    const segs = e.path.split('/')
    let rawName = null
    let kind = null
    if (segs.length >= 2 && segs[segs.length - 1] === 'SKILL.md') {
      rawName = segs[segs.length - 2]
      kind = 'bundle'
    } else {
      const rel = flatRoot !== '' && e.path.startsWith(flatRoot) ? e.path.slice(flatRoot.length) : e.path
      if (!rel.includes('/') && rel.endsWith('.md') && rel !== 'SKILL.md') {
        rawName = rel.slice(0, -3)
        kind = 'flat'
      }
    }
    if (rawName === null) continue
    // The official identity is the frontmatter `name`, not the address (dir
    // or file name). Import under the frontmatter name when it is present
    // and valid; otherwise fall back to the address name.
    const fm = parseFrontmatter(e.text)
    const fmName = typeof fm.data.name === 'string' && isSkillName(fm.data.name) ? fm.data.name : null
    const name = fmName ?? rawName
    if (!isSkillName(name)) { notes.push('跳过非法技能名: ' + e.path + '（官方 kebab-case）'); continue }
    if (fmName !== null && fmName !== rawName) notes.push('源目录/文件名 "' + rawName + '" 与 frontmatter name "' + fmName + '" 不一致，按 frontmatter name 导入')
    if (seen.has(name)) { notes.push('重复技能名（保留第一个）: ' + name); continue }
    seen.add(name)
    candidates.push({ name, kind, text: e.text, sourcePath: e.path })
  }
  return { candidates, notes }
}

// Pure import plan: validates each candidate and applies the conflict policy.
// `existing` maps target names to their current kind ('bundle'|'flat').
// Everything is imported as a bundle (<name>/SKILL.md), the manager's canonical
// form; a same-name flat file would shadow it, so that case is skipped.
export function planImport(candidates, existing, overwrite) {
  const plans = []
  const skips = []
  const have = new Map()
  for (const [k, v] of Object.entries(existing || {})) have.set(k, v)
  for (const c of candidates || []) {
    const check = validateSkillText(c.name, c.text)
    if (!check.ok) { skips.push({ name: c.name, reason: '校验失败: ' + check.errors.join('; ') }); continue }
    if (have.has(c.name) && have.get(c.name) === 'flat') { skips.push({ name: c.name, reason: '已存在同名 flat 技能文件（与 bundle 形态互相遮蔽），请先删除 flat 形态' }); continue }
    if (have.has(c.name) && !overwrite) { skips.push({ name: c.name, reason: '同名技能已存在（未选择覆盖）' }); continue }
    plans.push({ name: c.name, text: c.text, warnings: check.warnings })
  }
  return { plans, skips }
}


export function apply(ctx) {
  const skills = ctx.get('skills')
  const ap = ctx.get('agentPresets')
  const agents = ctx.get('agents')

  function sendJson(res, status, payload) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(JSON.stringify(payload))
  }

  function readBody(req, maxBytes = 4 << 20) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        chunks.push(chunk)
        size += chunk.length
        if (size > maxBytes) {
          reject(new Error('请求体过大（上限 ' + (maxBytes >> 20) + ' MB）'))
          req.destroy()
        }
      })
      req.on('end', () => {
        if (chunks.length === 0) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('请求体不是合法 JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  // ---- root resolution (writes only into official roots) ------------------------

  async function resolveTargetRoot(root, rootKey, presetId) {
    if (root === 'preset') {
      if (ap === undefined) return { error: 'agentPresets 服务不可用' }
      const list = await ap.list()
      const preset = list.find((p) => p.id === presetId)
      if (preset === undefined) return { error: 'preset 不存在: ' + presetId }
      return {
        label: 'preset ' + preset.id,
        dir: join(dirname(preset.path), 'skills'),
        writable: preset.trust === 'user',
        preset,
      }
    }
    if (root === 'global') {
      const key = rootKey === 'user-agents' ? 'user-agents' : 'user-dsh'
      const dir = key === 'user-agents' ? join(agentsHome(), 'skills') : join(dshHome(), 'skills')
      return { label: key, dir, writable: true, key }
    }
    return { error: 'root 只能是 global 或 preset' }
  }

  async function writeSkill(target, name, text) {
    const bf = bundleFile(target.dir, name)
    const ff = flatFile(target.dir, name)
    const bExists = await fileExists(bf)
    const fExists = await fileExists(ff)
    if (fExists && !bExists) {
      return { ok: false, error: '已存在同名 flat 技能文件 ' + name + '.md；官方发现规则下两种形态同名会互相遮蔽，请先删除 flat 形态再保存 bundle' }
    }
    try {
      await mkdir(dirname(bf), { recursive: true })
      if (bExists) {
        try { await writeFile(bf + '.bak', await readFile(bf)) } catch { /* backup is best-effort */ }
      }
      await writeFile(bf, text, 'utf8')
      return { ok: true, path: bf, kind: 'bundle' }
    } catch (e) {
      return { ok: false, error: errText(e) }
    }
  }

  async function deleteSkill(target, name) {
    const found = await findSkillFile(target.dir, name)
    if (found === null) return { ok: false, error: '技能不存在: ' + name }
    const trash = join(trashRoot(), name + '-' + Date.now())
    try {
      await mkdir(trashRoot(), { recursive: true })
      const src = found.kind === 'bundle' ? found.dir : found.file
      try {
        await rename(src, trash)
      } catch (e) {
        if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
          await mkdir(trash, { recursive: true })
          await writeFile(join(trash, found.kind === 'bundle' ? 'SKILL.md' : basename(found.file)), await readFile(found.file), 'utf8')
          await rm(src, { recursive: true, force: true })
        } else {
          throw e
        }
      }
      return { ok: true, trash }
    } catch (e) {
      return { ok: false, error: errText(e) }
    }
  }

  // ---- route handlers --------------------------------------------------------------

  async function handleLevels() {
    const globalRoots = []
    for (const key of ['user-dsh', 'user-agents']) {
      const dir = key === 'user-agents' ? join(agentsHome(), 'skills') : join(dshHome(), 'skills')
      globalRoots.push({ key, label: key, path: dir, ...(await listSkillsRoot(dir)) })
    }
    const presets = []
    if (ap !== undefined) {
      for (const p of await ap.list()) {
        let text = ''
        try { text = await ap.read(p.id) } catch { /* broken preset: wiring unavailable */ }
        presets.push({
          id: p.id,
          trust: p.trust,
          path: p.path,
          broken: p.broken == null ? null : String(p.broken),
          skillsDir: join(dirname(p.path), 'skills'),
          wiring: text === '' ? { status: 'unreadable', note: '无法读取组合文件', dirs: [], wired: false } : presetWiring(text),
          ...(await listSkillsRoot(join(dirname(p.path), 'skills'))),
        })
      }
    }
    const live = []
    if (agents !== undefined) {
      for (const agent of agents.list()) {
        let preset = null
        if (ap !== undefined) {
          try { preset = ap.composedPreset(agent.ctx) ?? null } catch { preset = null }
        }
        live.push({ id: String(agent.id), status: String(agent.status), preset })
      }
    }
    return {
      ok: true,
      meta: {
        dshHome: dshHome(),
        agentsHome: agentsHome(),
        bundledDir: process.env.DSH_BUNDLED_SKILL_DIR || '',
        hasRegistry: skills !== undefined,
        hasPresets: ap !== undefined,
        authorable: ap !== undefined && !!ap.authorable,
        defaultId: ap !== undefined && ap.defaultId != null ? String(ap.defaultId) : null,
      },
      global: {
        roots: globalRoots,
        registry: await registryView(skills, undefined, undefined),
      },
      presets,
      agents: live,
    }
  }

  async function handleRegistry(scope) {
    if (skills === undefined) return { available: false, complete: false, skills: [], base: null, exclusive: [], error: 'skill 注册表服务不可用' }
    if (scope === 'global') {
      const view = await registryView(skills, undefined, undefined)
      return { ...view, base: null, exclusive: diffNames(view.skills, []) }
    }
    const pm = /^preset:(.+)$/.exec(scope)
    if (pm) {
      if (ap === undefined) return { available: false, complete: false, skills: [], base: null, exclusive: [], error: 'agentPresets 服务不可用' }
      let key
      try {
        key = await ap.standingKeyFor(pm[1])
      } catch (e) {
        return { available: false, complete: false, skills: [], base: null, exclusive: [], error: errText(e) }
      }
      const base = await registryView(skills, undefined, undefined)
      const view = await registryView(skills, undefined, key)
      return { ...view, base: base.skills, exclusive: diffNames(view.skills, base.skills) }
    }
    const am = /^agent:(.+)$/.exec(scope)
    if (am) {
      if (agents === undefined) return { available: false, complete: false, skills: [], base: null, exclusive: [], error: 'agents 服务不可用' }
      const agent = agents.get(am[1])
      if (agent === undefined) return { available: false, complete: false, skills: [], base: null, exclusive: [], error: '会话不在内存中: ' + am[1] }
      const cwd = agent.session && agent.session.header ? agent.session.header.cwd : undefined
      const scopedRegistry = ap !== undefined ? ap.serviceFor(agent, 'skills') ?? skills : skills
      let baseSkills = []
      let presetName = null
      if (ap !== undefined) {
        try { presetName = ap.composedPreset(agent.ctx) ?? null } catch { presetName = null }
      }
      if (presetName != null) {
        try {
          const key = await ap.standingKeyFor(presetName)
          baseSkills = (await registryView(scopedRegistry, cwd, key)).skills
        } catch { baseSkills = [] }
      } else {
        baseSkills = (await registryView(scopedRegistry, cwd, undefined)).skills
      }
      const view = await registryView(scopedRegistry, cwd, agent)
      return { ...view, preset: presetName, cwd: cwd ?? '', base: baseSkills, exclusive: diffNames(view.skills, baseSkills) }
    }
    return { available: false, complete: false, skills: [], base: null, exclusive: [], error: 'scope 只能是 global / preset:<id> / agent:<id>' }
  }

  async function handleReadSkill(query) {
    const target = await resolveTargetRoot(query.get('root'), query.get('rootKey'), query.get('presetId'))
    if (target.error) return { ok: false, error: target.error }
    const name = String(query.get('name') || '')
    if (!isSkillName(name)) return { ok: false, error: '非法的技能名: ' + name }
    const found = await findSkillFile(target.dir, name)
    if (found === null) return { ok: false, error: '技能不存在: ' + name + '（' + target.dir + '）' }
    let text = ''
    try { text = await readFile(found.file, 'utf8') } catch (e) { return { ok: false, error: errText(e) } }
    const check = validateSkillText(name, text)
    return {
      ok: true,
      name,
      kind: found.kind,
      path: found.file,
      rootDir: target.dir,
      rootLabel: target.label,
      writable: target.writable,
      text,
      validation: check,
    }
  }

  async function handleSaveSkill(body) {
    const name = String(body.name || '').trim()
    if (!isSkillName(name)) return { ok: false, error: '技能名必须匹配官方 kebab-case 语法 [a-z0-9]+(-[a-z0-9]+)*: ' + name }
    const text = String(body.text ?? '')
    const check = validateSkillText(name, text)
    if (!check.ok) return { ok: false, error: check.errors.join('; '), validation: check }
    const target = await resolveTargetRoot(body.root, body.rootKey, body.presetId)
    if (target.error) return { ok: false, error: target.error }
    if (!target.writable) return { ok: false, error: '该层级只读（随附 preset 的 skills 只读，请先复制为 user preset）' }
    const result = await writeSkill(target, name, text)
    return result.ok ? { ok: true, name, path: result.path, kind: result.kind, validation: check } : result
  }

  async function handleDeleteSkill(body) {
    const name = String(body.name || '').trim()
    if (!isSkillName(name)) return { ok: false, error: '非法的技能名: ' + name }
    const target = await resolveTargetRoot(body.root, body.rootKey, body.presetId)
    if (target.error) return { ok: false, error: target.error }
    if (!target.writable) return { ok: false, error: '该层级只读' }
    return deleteSkill(target, name)
  }

  async function handleValidate(body) {
    const check = validateSkillText(String(body.name || '').trim(), String(body.text ?? ''))
    return { ok: check.ok, ...check }
  }

  // Import a batch of skills. Body: { root, rootKey?, presetId?, overwrite?,
  // mode: 'entries'|'zip', entries?: [{path, text}], zipBase64? }.
  async function handleImport(body) {
    const target = await resolveTargetRoot(body.root, body.rootKey, body.presetId)
    if (target.error) return { ok: false, error: target.error }
    if (!target.writable) return { ok: false, error: '该层级只读（随附 preset 的 skills 只读）' }

    let files
    let zipNotes = []
    if (body.mode === 'zip') {
      const b64 = String(body.zipBase64 || '')
      if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length % 4 !== 0) return { ok: false, error: 'zip 的 base64 数据无效' }
      let buf
      try {
        buf = Buffer.from(b64.replace(/\s/g, ''), 'base64')
      } catch {
        return { ok: false, error: 'zip 的 base64 解码失败' }
      }
      const parsed = parseZip(buf)
      if (parsed.error) return { ok: false, error: parsed.error }
      files = parsed.files
      zipNotes = parsed.notes
    } else if (body.mode === 'entries') {
      if (!Array.isArray(body.entries)) return { ok: false, error: '缺少 entries 数组' }
      if (body.entries.length > IMPORT_MAX_FILES) return { ok: false, error: '文件数超过上限 ' + IMPORT_MAX_FILES }
      files = body.entries.map((e) => ({
        path: e && e.path,
        text: String((e && e.text) ?? '').slice(0, IMPORT_MAX_FILE_BYTES),
      }))
    } else {
      return { ok: false, error: 'mode 只能是 entries 或 zip' }
    }

    const listed = await listSkillsRoot(target.dir)
    const existing = {}
    for (const s of listed.skills) existing[s.name] = s.kind
    const { candidates, notes } = selectImportCandidates(files)
    const { plans, skips } = planImport(candidates, existing, !!body.overwrite)
    const imported = []
    for (const plan of plans) {
      const result = await writeSkill(target, plan.name, plan.text)
      if (result.ok) imported.push({ name: plan.name, path: result.path, warnings: plan.warnings })
      else skips.push({ name: plan.name, reason: result.error })
    }
    return { ok: true, imported, skipped: skips, notes: [...zipNotes, ...notes] }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/skills-manager',
    handler: async (req, res) => {
      let pathname = req.url || '/'
      const q = pathname.indexOf('?')
      let queryString = ''
      if (q >= 0) {
        queryString = pathname.slice(q + 1)
        pathname = pathname.slice(0, q)
      }
      const query = new URLSearchParams(queryString)
      const method = req.method || 'GET'
      try {
        if (pathname === '/skills-manager/meta' && method === 'GET') {
          const lv = await handleLevels()
          return sendJson(res, 200, { meta: lv.meta })
        }
        if (pathname === '/skills-manager/levels' && method === 'GET') {
          return sendJson(res, 200, await handleLevels())
        }
        if (pathname === '/skills-manager/registry' && method === 'GET') {
          return sendJson(res, 200, await handleRegistry(query.get('scope') || 'global'))
        }
        if (pathname === '/skills-manager/skill' && method === 'GET') {
          const result = await handleReadSkill(query)
          return sendJson(res, result.ok ? 200 : 404, result)
        }
        if (pathname === '/skills-manager/skill' && method === 'POST') {
          const result = await handleSaveSkill(await readBody(req))
          return sendJson(res, result.ok ? 200 : 400, result)
        }
        if (pathname === '/skills-manager/skill/delete' && method === 'POST') {
          const result = await handleDeleteSkill(await readBody(req))
          return sendJson(res, result.ok ? 200 : 400, result)
        }
        if (pathname === '/skills-manager/validate' && method === 'POST') {
          return sendJson(res, 200, await handleValidate(await readBody(req)))
        }
        if (pathname === '/skills-manager/skill/import' && method === 'POST') {
          const result = await handleImport(await readBody(req, 64 << 20))
          return sendJson(res, result.ok ? 200 : 400, result)
        }
        return sendJson(res, 404, { ok: false, error: '未知的 /skills-manager 路由: ' + method + ' ' + pathname })
      } catch (e) {
        console.error('skills-manager route failed: %s %s — %s', method, pathname, errText(e))
        return sendJson(res, 500, { ok: false, error: errText(e) })
      }
    },
  }), 'skills-manager: /skills-manager routes')
}
