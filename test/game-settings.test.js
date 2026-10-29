'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const abc = require('../src/game/abc')
const swf = require('../src/game/swf')

test('bytecode: assembler labels and "land on new code" jumps', () => {
  assert.deepEqual(abc.assemble([[0x26], { jump: 0x12, to: 'x' }, [0x02, 0x02], { label: 'x' }, [0x47]]), [0x26, 0x12, 2, 0, 0, 0x02, 0x02, 0x47])
  //  0: pushtrue | 1: iffalse -> 6 | 5: pushfalse | 6: returnvoid
  const code = Buffer.from([0x26, 0x12, 0x01, 0x00, 0x00, 0x27, 0x47])
  // Default: a jump to the insertion point skips the new code.
  assert.equal(abc.decode(abc.insertCode(code, 6, [0x02])).find(i => i.at === 1).branches[0].target, 7)
  // landOnNew: it runs it.
  assert.equal(abc.decode(abc.insertCode(code, 6, [0x02], { landOnNew: true })).find(i => i.at === 1).branches[0].target, 6)
})

test('bytecode: try/catch ranges move with the code they cover', () => {
  // A fake ABC method body: header, code, one handler (from 1, to 5, target 6).
  const code = [0x26, 0x02, 0x02, 0x02, 0x02, 0x27, 0x47]
  const bodyBytes = Buffer.from([4, 1, 0, 1, code.length, ...code, 1, 1, 5, 6, 0, 0])
  const body = { at: 0, maxStack: 4, locals: 1, initScope: 0, maxScope: 1, codeStart: 5, codeLength: code.length, handlers: [{ from: 1, to: 5, target: 6, type: 0, name: 0 }], exceptionsEnd: bodyBytes.length }
  const edit = abc.bodyInsert(bodyBytes, body, 1, [0x02, 0x02], { maxStack: 6 })
  const out = Buffer.from(edit.bytes)
  assert.equal(out[0], 6) // max stack raised
  assert.equal(out[4], code.length + 2) // code length
  assert.deepEqual([...out.subarray(5 + code.length + 2)], [1, 3, 7, 8, 0, 0]) // handler moved by 2
})

const SWF = process.env.AJ_SWF || path.join(__dirname, '..', 'ajclient-1830-jr3.swf')

test('JR rows in the game’s Settings window, on the real game file (if available)', { skip: !fs.existsSync(SWF) }, () => {
  const original = fs.readFileSync(SWF)
  const result = swf.patchClient(original, { itemHover: true, jrSettings: true })
  assert.equal(result.jrSettings, 'patched')
  assert.equal(result.itemHover, 'patched')
  const { body } = swf.unpack(result.swf)
  for (const tag of swf.tags(body)) {
    if (tag.code !== 82) continue
    let start = tag.dataStart + 4
    while (body[start] !== 0) start++
    start++
    const A = abc.parse(body, start)
    assert.equal(A.end, tag.dataStart + tag.length)
    for (const b of A.bodies.values()) {
      const list = abc.decode(body.subarray(b.codeStart, b.codeStart + b.codeLength))
      const starts = new Set(list.map(i => i.at))
      for (const i of list) for (const br of i.branches) assert.ok(starts.has(br.target))
      for (const h of b.handlers) assert.ok(starts.has(h.from) && starts.has(h.target) && (starts.has(h.to) || h.to === b.codeLength))
    }
    assert.ok(A.strings.includes('jrSettingsRows') && A.strings.includes('jrSettingToggle'))
    const click = abc.findMethod(A, 'ItemWindowToggle', 'handleMouseDown')
    const code = body.subarray(click.codeStart, click.codeStart + click.codeLength)
    // The JR check comes right after stopPropagation, before AJ's own handling.
    const list = abc.decode(code)
    const stop = list.findIndex(i => i.op === 0x4F && abc.nameOf(A, i.operands[0]) === 'stopPropagation')
    assert.equal(abc.nameOf(A, list[stop + 2].operands[0]), 'key')
  }
  // Applying it twice to a fresh copy gives the same file.
  assert.deepEqual(swf.patchClient(original, { itemHover: true, jrSettings: true }).swf, result.swf)
})
