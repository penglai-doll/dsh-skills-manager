// dsh-skills-manager — pure-helper tests (node --test).
// These cover the validation, frontmatter parsing, composition-wiring checks,
// and registry-view diffing that the host half serves; no Cordis runtime is
// required.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isSkillName,
  parseFrontmatter,
  parseScalarValue,
  validateSkillText,
  parseCompositionRows,
  presetWiring,
  diffNames,
} from '../lib/index.js'

test('isSkillName mirrors the official kebab-case grammar', () => {
  assert.equal(isSkillName('cordis-plugin-development'), true)
  assert.equal(isSkillName('a'), true)
  assert.equal(isSkillName('a1-b2'), true)
  assert.equal(isSkillName('1abc'), true)
  assert.equal(isSkillName('abc_1'), false)
  assert.equal(isSkillName('Abc'), false)
  assert.equal(isSkillName('-abc'), false)
  assert.equal(isSkillName('abc-'), false)
  assert.equal(isSkillName(''), false)
  assert.equal(isSkillName(undefined), false)
})

test('parseScalarValue covers the official invocation boolean forms', () => {
  assert.equal(parseScalarValue('true'), true)
  assert.equal(parseScalarValue('FALSE'), false)
  assert.equal(parseScalarValue('yes'), true)
  assert.equal(parseScalarValue('off'), false)
  assert.equal(parseScalarValue('1'), 1)
  assert.equal(parseScalarValue('0'), 0)
  assert.equal(parseScalarValue('2.5'), 2.5)
  assert.equal(parseScalarValue("'a b'"), 'a b')
  assert.equal(parseScalarValue('"x\\n"'), 'x\n')
  assert.equal(parseScalarValue('plain text'), 'plain text')
})

test('parseFrontmatter extracts scalar fields and body', () => {
  const text = '---\nname: demo-skill\ndescription: does things\nwhenToUse: when needed\ndisable-model-invocation: false\nuser-invocable: true\n---\n# Body\n\ninstructions'
  const fm = parseFrontmatter(text)
  assert.equal(fm.present, true)
  assert.equal(fm.data.name, 'demo-skill')
  assert.equal(fm.data.description, 'does things')
  assert.equal(fm.data['disable-model-invocation'], false)
  assert.equal(fm.data['user-invocable'], true)
  assert.ok(fm.body.includes('instructions'))
})

test('parseFrontmatter reports missing frontmatter', () => {
  const fm = parseFrontmatter('# Just a markdown file')
  assert.equal(fm.present, false)
})

test('validateSkillText accepts a canonical skill', () => {
  const text = '---\nname: demo-skill\ndescription: does things\n---\nbody'
  const v = validateSkillText('demo-skill', text)
  assert.equal(v.ok, true)
  assert.deepEqual(v.errors, [])
})

test('validateSkillText rejects missing name/description and bad grammar', () => {
  const v = validateSkillText('demo-skill', '---\ndescription: x\n---\nbody')
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('name')))
  const v2 = validateSkillText('Demo_Skill', '---\nname: Demo_Skill\ndescription: x\n---\nbody')
  assert.equal(v2.ok, false)
})

test('validateSkillText rejects camelCase invocation fields (official fail-closed)', () => {
  const text = '---\nname: demo-skill\ndescription: x\ndisableModelInvocation: true\n---\nbody'
  const v = validateSkillText('demo-skill', text)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('驼峰')))
})

test('validateSkillText rejects non-boolean invocation values', () => {
  const text = '---\nname: demo-skill\ndescription: x\ndisable-model-invocation: maybe\n---\nbody'
  const v = validateSkillText('demo-skill', text)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('disable-model-invocation')))
})

test('validateSkillText warns on frontmatter name / address mismatch', () => {
  const text = '---\nname: other-name\ndescription: x\n---\nbody'
  const v = validateSkillText('demo-skill', text)
  assert.equal(v.ok, true)
  assert.ok(v.warnings.some((w) => w.includes('不一致')))
})

test('parseCompositionRows finds top-level rows only', () => {
  const text = '- id: persona\n  name: \'@deepseek-ai/dsh-persona\'\n- id: skill-filesystem\n  name: \'@deepseek-ai/dsh-skill-filesystem\'\n  config:\n    customSkillDirs:\n      - !!js "process.getBuiltinModule(\'node:url\').fileURLToPath(new URL(\'skills/\', baseUrl))"\n- id: tool-skill\n  name: \'@deepseek-ai/dsh-tool-skill\'\n'
  const rows = parseCompositionRows(text)
  assert.deepEqual(rows.map((r) => r.rowId), ['persona', 'skill-filesystem', 'tool-skill'])
  assert.equal(rows[1].name.includes('dsh-skill-filesystem'), true)
})

test('presetWiring detects custom dirs wired at the preset skills path', () => {
  const text = '- id: skill-filesystem\n  name: \'@deepseek-ai/dsh-skill-filesystem\'\n  config:\n    customSkillDirs:\n      - !!js "process.getBuiltinModule(\'node:url\').fileURLToPath(new URL(\'skills/\', baseUrl))"\n'
  const w = presetWiring(text)
  assert.equal(w.status, 'custom')
  assert.equal(w.wired, true)
})

test('presetWiring reports default-only and absent compositions', () => {
  const def = presetWiring('- id: skill-filesystem\n  name: \'@deepseek-ai/dsh-skill-filesystem\'\n')
  assert.equal(def.status, 'default-only')
  assert.equal(def.wired, false)
  const absent = presetWiring('- id: tool-skill\n  name: \'@deepseek-ai/dsh-tool-skill\'\n')
  assert.equal(absent.status, 'absent')
})

test('diffNames computes nearest-layer exclusives along the official chain', () => {
  const view = [{ name: 'global-a' }, { name: 'preset-b' }, { name: 'agent-c' }]
  const base = [{ name: 'global-a' }, { name: 'global-d' }]
  assert.deepEqual(diffNames(view, base), ['preset-b', 'agent-c'])
  assert.deepEqual(diffNames([], base), [])
})
