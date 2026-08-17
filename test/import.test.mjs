// dsh-skills-manager — import pipeline tests (node:test, run standalone:
// `node test/import.test.mjs` — the test-runner child spawn is blocked by the
// sandbox's named-pipe boundary).

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseZip,
  selectImportCandidates,
  planImport,
  normalizeImportPath,
  IMPORT_MAX_FILE_BYTES,
} from '../lib/index.js'
import { buildZip } from './zip-fixture.mjs'

const skillText = (name) => '---\nname: ' + name + '\ndescription: imported ' + name + '\n---\n\n# ' + name + '\n'

test('normalizeImportPath rejects traversal, drives and absolute paths', () => {
  assert.equal(normalizeImportPath('a/b/SKILL.md'), 'a/b/SKILL.md')
  assert.equal(normalizeImportPath('a\\b\\SKILL.md'), 'a/b/SKILL.md')
  assert.equal(normalizeImportPath('../evil/SKILL.md'), null)
  assert.equal(normalizeImportPath('a/../../evil.md'), null)
  assert.equal(normalizeImportPath('C:/x/SKILL.md'), null)
  assert.equal(normalizeImportPath('/abs/SKILL.md'), null)
  assert.equal(normalizeImportPath(''), null)
  assert.equal(normalizeImportPath('.'), null)
})

test('parseZip extracts stored and deflate entries, skips dirs', () => {
  const zip = buildZip([
    { name: 'skills/', dir: true },
    { name: 'skills/alpha/SKILL.md', method: 0, data: skillText('alpha') },
    { name: 'skills/beta/SKILL.md', method: 8, data: skillText('beta') },
    { name: 'notes.md', method: 8, data: skillText('notes') },
  ])
  const parsed = parseZip(zip)
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.files.map((f) => f.path), ['skills/alpha/SKILL.md', 'skills/beta/SKILL.md', 'notes.md'])
  assert.equal(parsed.files[0].text.includes('name: alpha'), true)
  assert.equal(parsed.files[1].text.includes('name: beta'), true)
})

test('parseZip rejects traversal entries and garbage input', () => {
  const zip = buildZip([
    { name: '../evil/SKILL.md', method: 8, data: skillText('evil') },
    { name: 'ok/SKILL.md', method: 8, data: skillText('ok') },
  ])
  const parsed = parseZip(zip)
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.files.map((f) => f.path), ['ok/SKILL.md'])
  assert.ok(parsed.notes.some((n) => n.includes('不安全路径')))

  assert.ok(parseZip(Buffer.from('not a zip at all........')).error !== undefined)
  assert.ok(parseZip(Buffer.alloc(10)).error !== undefined)
})

test('parseZip rejects ZIP64 and oversized entries', () => {
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 16)
  const z64 = parseZip(eocd)
  assert.equal(z64.error, '不支持 ZIP64 压缩包')

  const big = buildZip([{ name: 'big/SKILL.md', method: 8, data: 'x'.repeat(IMPORT_MAX_FILE_BYTES + 1) }])
  const parsed = parseZip(big)
  assert.equal(parsed.files.length, 0)
  assert.ok(parsed.notes.some((n) => n.includes('超大')))
})

test('selectImportCandidates descends a single wrapper and picks bundles + root flats', () => {
  const files = [
    { path: 'MySkills/alpha/SKILL.md', text: skillText('alpha') },
    { path: 'MySkills/sub/beta/SKILL.md', text: skillText('beta') },
    { path: 'MySkills/flat-note.md', text: skillText('flat-note') },
    { path: 'MySkills/alpha/reference.md', text: '# reference (ignored)' },
    { path: 'MySkills/README.md', text: '# readme' },
    { path: 'MySkills/Bad_Name/SKILL.md', text: skillText('Bad_Name') },
  ]
  const { candidates, notes } = selectImportCandidates(files)
  assert.deepEqual(candidates.map((c) => c.name).sort(), ['alpha', 'beta', 'flat-note'].sort())
  assert.ok(notes.some((n) => n.includes('单一外层目录')))
  // README.md produces a non-kebab identity and must be skipped, not imported.
  assert.ok(notes.some((n) => n.includes('Bad_Name')))
  assert.ok(notes.some((n) => n.includes('README')))
  const beta = candidates.find((c) => c.name === 'beta')
  assert.equal(beta.kind, 'bundle')
  const flat = candidates.find((c) => c.name === 'flat-note')
  assert.equal(flat.kind, 'flat')
})

test('selectImportCandidates keys identity by frontmatter name and rejects unsafe paths', () => {
  const files = [
    { path: 'a/SKILL.md', text: skillText('dup') },
    { path: 'b/SKILL.md', text: skillText('dup') },
    { path: '../evil/SKILL.md', text: skillText('evil') },
  ]
  const { candidates, notes } = selectImportCandidates(files)
  // Identity is the frontmatter name (the official registry identity), so the
  // two directories collapse into one skill.
  assert.deepEqual(candidates.map((c) => c.name), ['dup'])
  assert.ok(notes.some((n) => n.includes('不一致')))
  assert.ok(notes.some((n) => n.includes('重复技能名')))
  assert.ok(notes.some((n) => n.includes('不安全路径')))
})

test('planImport applies validation, overwrite and flat-conflict policies', () => {
  const candidates = [
    { name: 'valid-a', kind: 'bundle', text: skillText('valid-a') },
    { name: 'bad-b', kind: 'bundle', text: '---\nname: bad-b\n---\nno description' },
    { name: 'valid-c', kind: 'flat', text: skillText('valid-c') },
  ]
  // fresh target: both valid candidates are planned, invalid one is skipped
  let r = planImport(candidates, {}, false)
  assert.deepEqual(r.plans.map((p) => p.name).sort(), ['valid-a', 'valid-c'])
  assert.equal(r.skips.some((s) => s.name === 'bad-b' && s.reason.includes('校验失败')), true)

  // existing bundle + no overwrite → skip; overwrite → plan
  r = planImport([{ name: 'valid-a', kind: 'bundle', text: skillText('valid-a') }], { 'valid-a': 'bundle' }, false)
  assert.equal(r.plans.length, 0)
  assert.equal(r.skips[0].reason.includes('未选择覆盖'), true)
  r = planImport([{ name: 'valid-a', kind: 'bundle', text: skillText('valid-a') }], { 'valid-a': 'bundle' }, true)
  assert.equal(r.plans.length, 1)

  // existing flat blocks a bundle import even with overwrite
  r = planImport([{ name: 'valid-c', kind: 'flat', text: skillText('valid-c') }], { 'valid-c': 'flat' }, true)
  assert.equal(r.plans.length, 0)
  assert.equal(r.skips[0].reason.includes('flat'), true)
})
