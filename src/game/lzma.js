'use strict'

/**
 * A compact LZMA decoder (the "LZMA1" format used by compressed SWF files).
 * Decodes `size` bytes from `input` starting at `offset`, using the 5-byte
 * properties block that precedes the stream.
 */

const kNumBitModelTotalBits = 11
const kBitModelTotal = 1 << kNumBitModelTotalBits
const kNumMoveBits = 5
const kTopValue = 1 << 24
const kNumStates = 12
const kEndPosModelIndex = 14
const kNumFullDistances = 1 << (kEndPosModelIndex >> 1)
const kNumAlignBits = 4
const kMatchMinLen = 2

class RangeDecoder {
  constructor (buf, pos) {
    this.buf = buf
    this.pos = pos
    this.range = 0xFFFFFFFF
    this.code = 0
    if (buf[this.pos++] !== 0) throw new Error('Bad LZMA stream')
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | buf[this.pos++]) >>> 0
  }

  normalize () {
    if (this.range < kTopValue) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.buf[this.pos++]) >>> 0
    }
  }

  direct (numBits) {
    let res = 0
    while (numBits--) {
      this.range >>>= 1
      let t = 0
      if (this.code >= this.range) { this.code = (this.code - this.range) >>> 0; t = 1 }
      res = ((res << 1) | t) >>> 0
      this.normalize()
    }
    return res
  }

  bit (probs, i) {
    const p = probs[i]
    const bound = (this.range >>> kNumBitModelTotalBits) * p
    let symbol
    if (this.code < bound) {
      probs[i] = p + ((kBitModelTotal - p) >>> kNumMoveBits)
      this.range = bound >>> 0
      symbol = 0
    } else {
      probs[i] = p - (p >>> kNumMoveBits)
      this.code = (this.code - bound) >>> 0
      this.range = (this.range - bound) >>> 0
      symbol = 1
    }
    this.normalize()
    return symbol
  }
}

const probs = (n) => new Uint16Array(n).fill(kBitModelTotal >>> 1)

function bitTree (rc, p, base, numBits) {
  let m = 1
  for (let i = 0; i < numBits; i++) m = (m << 1) + rc.bit(p, base + m)
  return m - (1 << numBits)
}

function bitTreeReverse (rc, p, base, numBits) {
  let m = 1
  let sym = 0
  for (let i = 0; i < numBits; i++) {
    const b = rc.bit(p, base + m)
    m = (m << 1) + b
    sym |= b << i
  }
  return sym
}

class LenDecoder {
  constructor () {
    this.choice = probs(2)
    this.low = probs(16 << 3)
    this.mid = probs(16 << 3)
    this.high = probs(256)
  }

  decode (rc, posState) {
    if (rc.bit(this.choice, 0) === 0) return bitTree(rc, this.low, posState << 3, 3)
    if (rc.bit(this.choice, 1) === 0) return 8 + bitTree(rc, this.mid, posState << 3, 3)
    return 16 + bitTree(rc, this.high, 0, 8)
  }
}

/**
 * @param {Buffer} props 5 bytes: lc/lp/pb byte + 4-byte dictionary size
 * @param {Buffer} input
 * @param {number} offset where the compressed stream starts
 * @param {number} size how many bytes to produce
 */
function decode (props, input, offset, size) {
  let d = props[0]
  if (d >= 9 * 5 * 5) throw new Error('Bad LZMA properties')
  const lc = d % 9; d = (d / 9) | 0
  const lp = d % 5
  const pb = (d / 5) | 0

  const out = Buffer.alloc(size)
  let outPos = 0
  const rc = new RangeDecoder(input, offset)

  const literal = probs(0x300 << (lc + lp))
  const isMatch = probs(kNumStates << 4)
  const isRep = probs(kNumStates)
  const isRepG0 = probs(kNumStates)
  const isRepG1 = probs(kNumStates)
  const isRepG2 = probs(kNumStates)
  const isRep0Long = probs(kNumStates << 4)
  const posSlot = probs(4 << 6)
  const posDecoders = probs(1 + kNumFullDistances - kEndPosModelIndex)
  const align = probs(1 << kNumAlignBits)
  const lenDec = new LenDecoder()
  const repLenDec = new LenDecoder()

  let state = 0
  let rep0 = 0; let rep1 = 0; let rep2 = 0; let rep3 = 0
  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1

  const getByte = (dist) => out[outPos - dist - 1]

  while (outPos < size) {
    const posState = outPos & pbMask
    if (rc.bit(isMatch, (state << 4) + posState) === 0) {
      const prev = outPos > 0 ? out[outPos - 1] : 0
      const litState = ((outPos & lpMask) << lc) + (prev >>> (8 - lc))
      const base = 0x300 * litState
      let symbol = 1
      if (state >= 7) {
        let matchByte = getByte(rep0)
        do {
          const matchBit = (matchByte >>> 7) & 1
          matchByte <<= 1
          const bit = rc.bit(literal, base + ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | bit
          if (matchBit !== bit) break
        } while (symbol < 0x100)
      }
      while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literal, base + symbol)
      out[outPos++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }

    let len
    if (rc.bit(isRep, state) !== 0) {
      if (outPos === 0) throw new Error('Bad LZMA stream')
      if (rc.bit(isRepG0, state) === 0) {
        if (rc.bit(isRep0Long, (state << 4) + posState) === 0) {
          state = state < 7 ? 9 : 11
          out[outPos] = getByte(rep0)
          outPos++
          continue
        }
      } else {
        let dist
        if (rc.bit(isRepG1, state) === 0) {
          dist = rep1
        } else {
          if (rc.bit(isRepG2, state) === 0) {
            dist = rep2
          } else {
            dist = rep3
            rep3 = rep2
          }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = dist
      }
      len = repLenDec.decode(rc, posState)
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0
      len = lenDec.decode(rc, posState)
      state = state < 7 ? 7 : 10
      // distance
      const lenState = len < 3 ? len : 3
      const slot = bitTree(rc, posSlot, lenState << 6, 6)
      if (slot < 4) {
        rep0 = slot
      } else {
        const numDirect = (slot >>> 1) - 1
        let dist = ((2 | (slot & 1)) << numDirect) >>> 0
        if (slot < kEndPosModelIndex) {
          dist += bitTreeReverse(rc, posDecoders, dist - slot, numDirect)
        } else {
          dist += rc.direct(numDirect - kNumAlignBits) << kNumAlignBits
          dist += bitTreeReverse(rc, align, 0, kNumAlignBits)
        }
        rep0 = dist >>> 0
        if (rep0 === 0xFFFFFFFF) break // end marker
      }
      if (rep0 >= outPos) throw new Error('Bad LZMA distance')
    }

    len += kMatchMinLen
    if (outPos + len > size) len = size - outPos
    for (let i = 0; i < len; i++, outPos++) out[outPos] = out[outPos - rep0 - 1]
  }

  return out
}

module.exports = { decode }
