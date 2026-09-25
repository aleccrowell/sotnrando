#!/usr/bin/env node
// Extract a clean, randomizer-ready track 1 .bin from a SotN (USA) disc dump.
//
// Handles the common dump variants the randomizer rejects as-is:
//   - multi-track single-file .bin (track 1 + audio track 2 concatenated)
//   - raw sectors with subchannel data (2448 bytes/sector instead of 2352)
//
// Usage: cli/prepare-image.js <dump.cue|dump.bin> <out.bin>

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const constants = require('../src/constants')

const RAW = 2352
const SUBCHANNEL = 96
const SYNC = Buffer.from([0x00].concat(Array(10).fill(0xff), [0x00]))

function die(msg) {
  console.error('Error: ' + msg)
  process.exit(1)
}

function msfToFrames(msf) {
  const [m, s, f] = msf.split(':').map(Number)
  return (m * 60 + s) * 75 + f
}

// Returns { bin, track1Frames } where track1Frames is undefined when track 1
// runs to the end of the file.
function parseCue(cuePath) {
  const lines = fs.readFileSync(cuePath, 'utf8').split(/\r?\n/)
  let bin
  let track = 0
  let track1Frames
  for (const line of lines) {
    let m
    if ((m = line.match(/^\s*FILE\s+"(.+)"/i))) {
      if (bin) {
        // Track 1 lives in its own file; nothing to cut.
        break
      }
      bin = path.resolve(path.dirname(cuePath), m[1])
    } else if ((m = line.match(/^\s*TRACK\s+(\d+)/i))) {
      track = parseInt(m[1], 10)
    } else if (track === 2 && track1Frames === undefined
               && (m = line.match(/^\s*INDEX\s+0[01]\s+(\d+:\d+:\d+)/i))) {
      // INDEX 00 (pregap) comes first when present, which is where track 1
      // data ends.
      track1Frames = msfToFrames(m[1])
    }
  }
  if (!bin) {
    die('No FILE entry in ' + cuePath)
  }
  return { bin, track1Frames }
}

function detectSectorSize(fd) {
  const buf = Buffer.alloc(12)
  for (const size of [RAW, RAW + SUBCHANNEL]) {
    fs.readSync(fd, buf, 0, 12, size)
    if (buf.equals(SYNC)) {
      return size
    }
  }
  die('Could not detect sector size (no sync header at sector 1)')
}

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('Usage: cli/prepare-image.js <dump.cue|dump.bin> <out.bin>')
  process.exit(2)
}

let binPath = input
let track1Frames
if (/\.cue$/i.test(input)) {
  ({ bin: binPath, track1Frames } = parseCue(input))
}

const fd = fs.openSync(binPath, 'r')
const sectorSize = detectSectorSize(fd)
const fileSectors = Math.floor(fs.fstatSync(fd).size / sectorSize)
const sectors = track1Frames || fileSectors
if (sectors > fileSectors) {
  die('Cue sheet says track 1 has ' + sectors + ' sectors but file only has '
      + fileSectors)
}

console.log('Input:       ' + binPath)
console.log('Sector size: ' + sectorSize
            + (sectorSize !== RAW ? ' (stripping subchannel)' : ''))
console.log('Track 1:     ' + sectors + ' sectors')

const hash = crypto.createHash('sha256')
const out = fs.openSync(output, 'w')
const chunkSectors = 1024
const inBuf = Buffer.alloc(chunkSectors * sectorSize)
const outBuf = Buffer.alloc(chunkSectors * RAW)
for (let done = 0; done < sectors; done += chunkSectors) {
  const n = Math.min(chunkSectors, sectors - done)
  fs.readSync(fd, inBuf, 0, n * sectorSize, done * sectorSize)
  for (let i = 0; i < n; i++) {
    inBuf.copy(outBuf, i * RAW, i * sectorSize, i * sectorSize + RAW)
  }
  const chunk = outBuf.subarray(0, n * RAW)
  hash.update(chunk)
  fs.writeSync(out, chunk)
}
fs.closeSync(out)
fs.closeSync(fd)

const digest = hash.digest('hex')
if (digest !== constants.digest) {
  fs.unlinkSync(output)
  die('Extracted track 1 does not match the vanilla SotN (USA) digest.\n'
      + '  got:      ' + digest + '\n'
      + '  expected: ' + constants.digest)
}
console.log('Verified vanilla image -> ' + output)
