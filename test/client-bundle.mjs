// dsh-skills-manager — client bundle smoke test.
//
// Simulates the browser module table (window.__ModuleLoader__) with a react
// stub, loads lib/client.js as a plain script, and verifies that apply()
// registers the settings.plugins.tab entry with the expected shape and that
// the view factory produces a React element tree without throwing.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function fail(msg) {
  throw new Error(msg)
}

// ---- simulated browser environment -------------------------------------------

const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(v) { return [v, () => {}] },
  useEffect() {},
}

let loadedId = null
let moduleExports = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loadedId = id
      moduleExports = factory((name) => {
        if (name === 'react') return reactStub
        throw new Error('unexpected module dependency: ' + name)
      })
    },
  },
}

const code = await readFile(join(here, '..', 'lib', 'client.js'), 'utf8')
new Function(code)()

if (loadedId !== 'dsh-skills-manager') fail('bundle id 错误: ' + loadedId)
if (typeof moduleExports?.apply !== 'function') fail('apply 未导出')
console.log('✓ bundle 以 id "dsh-skills-manager" 加载，仅依赖 react')

// ---- simulated slots service ---------------------------------------------------

let registered = null
const fakeSlots = {
  inject(slotName, cb) {
    if (slotName !== 'settings.plugins.tab') fail('注册了错误的 slot: ' + slotName)
    cb()
  },
  register(opts, factory) {
    registered = { opts, factory }
  },
}

const fakeCtx = { get: (name) => (name === 'slots' ? fakeSlots : undefined) }
moduleExports.apply(fakeCtx)

if (registered === null) fail('slots.register 未被调用')
const { opts, factory } = registered
if (opts.name !== 'settings.plugins.tab' || opts.id !== 'skills' || opts.order !== 120 || opts.label !== 'Skills 管理') {
  fail('注册参数错误: ' + JSON.stringify(opts))
}
console.log('✓ settings.plugins.tab 注册参数正确: ' + JSON.stringify(opts))

const view = factory()
if (view === null || typeof view !== 'object' || view.type === undefined) fail('视图工厂未返回 React 元素')
console.log('✓ 视图工厂返回 React 元素树（顶层 type: ' + (typeof view.type === 'string' ? view.type : 'ManagerView') + '）')

// slots 服务缺失时 apply 应静默退出
let threw = false
try {
  moduleExports.apply({ get: () => undefined })
} catch {
  threw = true
}
if (threw) fail('slots 缺失时 apply 不应抛错')
console.log('✓ slots 服务缺失时 apply 静默降级')

console.log('\n客户端 bundle 冒烟通过 ✔')
