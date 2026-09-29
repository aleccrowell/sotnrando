#!/usr/bin/env node
// Prepare the files `sotn-rando` needs from a SotN (USA) disc dump.
//
// Usage: cli/lib/setup.js <dump.cue|dump.bin> <data-dir>
//
// Writes to <data-dir>:
//   vanilla.bin  track 1, 2352 bytes/sector, verified against the vanilla
//                digest the randomizer requires
//   rest.bin     everything after track 1 (audio track 2), 2352 bytes/sector
//   disc.cue     the full disc's cue sheet as a single-file template, with
//                FILE "@BIN@" standing in for the image name
// rest.bin/disc.cue are only written when the dump has tracks after track 1.
//
// Handles single-file and split-track (one .bin per track) dumps, raw sectors
// carrying 96 bytes of subchannel (2448 bytes/sector), and data tracks stored
// MODE2/2336 (psxdr convert --data-sector-size 2336), whose 16-byte sync and
// header are rebuilt from each sector's position.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const constants = require('../../src/constants')

const RAW = 2352
const SUBCHANNEL = 96
const MODE2 = 2336
const SYNC = Buffer.from([0x00].concat(Array(10).fill(0xff), [0x00]))

function die(msg) {
  console.error('Error: ' + msg)
  process.exit(1)
}

function msfToFrames(msf) {
  const [m, s, f] = msf.split(':').map(Number)
  return (m * 60 + s) * 75 + f
}

const bcd = (n) => (Math.floor(n / 10) << 4) | (n % 10)

// The 16 bytes a MODE2/2336 sector leaves out: sync, then the sector's
// absolute time (LSN + 150) in BCD and mode 2.
function mode2Header(lsn) {
  const t = lsn + 150
  return Buffer.concat([SYNC, Buffer.from([
    bcd(Math.floor(t / 75 / 60)), bcd(Math.floor(t / 75) % 60), bcd(t % 75), 2,
  ])])
}

function framesToMsf(frames) {
  const pad = (n) => String(n).padStart(2, '0')
  return pad(Math.floor(frames / 75 / 60)) + ':'
    + pad(Math.floor(frames / 75) % 60) + ':' + pad(frames % 75)
}

// A sector is 2352 bytes unless sync headers repeat every 2448. Audio-only
// files have no sync headers, so fall back to whichever size divides evenly.
function detectSectorSize(file) {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const buf = Buffer.alloc(12)
  try {
    for (const s of [RAW, RAW + SUBCHANNEL]) {
      fs.readSync(fd, buf, 0, 12, 0)
      const first = buf.equals(SYNC)
      fs.readSync(fd, buf, 0, 12, s)
      if (first && buf.equals(SYNC)) {
        return s
      }
    }
  } finally {
    fs.closeSync(fd)
  }
  if (size % RAW === 0) {
    return RAW
  }
  if (size % (RAW + SUBCHANNEL) === 0) {
    return RAW + SUBCHANNEL
  }
  die('Could not detect sector size of ' + file)
}

// Returns a list of files, each { path, sectorSize, sectors, start } where
// start is the file's first sector on the concatenated disc, and a list of
// tracks, each { number, mode, indexes: [[n, absoluteFrames]] }.
function parseCue(cuePath) {
  const files = []
  const tracks = []
  let disc = 0
  for (const line of fs.readFileSync(cuePath, 'utf8').split(/\r?\n/)) {
    let m
    if ((m = line.match(/^\s*FILE\s+"(.+)"/i))) {
      if (files.length) {
        disc += files[files.length - 1].sectors
      }
      const file = path.resolve(path.dirname(cuePath), m[1])
      if (!fs.existsSync(file)) {
        die('Cue sheet references missing file ' + file)
      }
      // Sized at its first TRACK, whose mode says whether it is 2336.
      files.push({ path: file, start: disc })
    } else if ((m = line.match(/^\s*TRACK\s+(\d+)\s+(\S+)/i))) {
      tracks.push({ number: parseInt(m[1], 10), mode: m[2], indexes: [] })
      const file = files[files.length - 1]
      if (file && !file.sectorSize) {
        file.sectorSize = /\/2336$/.test(m[2]) ? MODE2 : detectSectorSize(file.path)
        file.sectors = Math.floor(fs.statSync(file.path).size / file.sectorSize)
      }
    } else if ((m = line.match(/^\s*INDEX\s+(\d+)\s+(\d+:\d+:\d+)/i))) {
      tracks[tracks.length - 1].indexes.push(
        [parseInt(m[1], 10), disc + msfToFrames(m[2])])
    }
  }
  if (!files.length || !tracks.length || files.some((f) => !f.sectorSize)) {
    die('No FILE/TRACK entries in ' + cuePath)
  }
  return { files, tracks }
}

// Stream sectors [from, to) of the concatenated disc as 2352-byte sectors.
function copySectors(files, from, to, out, hash) {
  const chunk = 1024
  for (const file of files) {
    const lo = Math.max(from, file.start)
    const hi = Math.min(to, file.start + file.sectors)
    if (lo >= hi) {
      continue
    }
    const fd = fs.openSync(file.path, 'r')
    const inBuf = Buffer.alloc(chunk * file.sectorSize)
    const outBuf = Buffer.alloc(chunk * RAW)
    for (let s = lo; s < hi; s += chunk) {
      const n = Math.min(chunk, hi - s)
      fs.readSync(fd, inBuf, 0, n * file.sectorSize,
                  (s - file.start) * file.sectorSize)
      for (let i = 0; i < n; i++) {
        if (file.sectorSize === MODE2) {
          mode2Header(s + i).copy(outBuf, i * RAW)
          inBuf.copy(outBuf, i * RAW + RAW - MODE2, i * MODE2, (i + 1) * MODE2)
        } else {
          inBuf.copy(outBuf, i * RAW, i * file.sectorSize,
                     i * file.sectorSize + RAW)
        }
      }
      const data = outBuf.subarray(0, n * RAW)
      if (hash) {
        hash.update(data)
      }
      fs.writeSync(out, data)
    }
    fs.closeSync(fd)
  }
}

const [input, dataDir] = process.argv.slice(2)
if (!input || !dataDir) {
  console.error('Usage: cli/lib/setup.js <dump.cue|dump.bin> <data-dir>')
  process.exit(2)
}
if (!fs.existsSync(input)) {
  die('No such file: ' + input)
}

let files
let tracks = []
if (/\.cue$/i.test(input)) {
  ({ files, tracks } = parseCue(input))
} else {
  const sectorSize = detectSectorSize(input)
  files = [{
    path: path.resolve(input),
    sectorSize,
    sectors: Math.floor(fs.statSync(input).size / sectorSize),
    start: 0,
  }]
  console.log('Note: no .cue given, so only track 1 can be prepared'
              + ' (no full-disc output).')
}
const total = files.reduce((n, f) => n + f.sectors, 0)
// Track 1 ends where track 2 begins: its pregap (INDEX 00) if it has one.
const track1End = tracks.length > 1 ? tracks[1].indexes[0][1] : total
const sizes = [...new Set(files.map((f) => f.sectorSize))]

console.log('Dump:        ' + files.map((f) => f.path).join('\n             '))
console.log('Sector size: ' + sizes.join('/')
            + (sizes.includes(RAW + SUBCHANNEL) ? ' (stripping subchannel)' : '')
            + (sizes.includes(MODE2) ? ' (rebuilding sector headers)' : ''))
console.log('Tracks:      ' + Math.max(tracks.length, 1)
            + ' (track 1: ' + track1End + ' sectors)')

fs.mkdirSync(dataDir, { recursive: true })
const vanilla = path.join(dataDir, 'vanilla.bin')
const hash = crypto.createHash('sha256')
let out = fs.openSync(vanilla, 'w')
copySectors(files, 0, track1End, out, hash)
fs.closeSync(out)
const digest = hash.digest('hex')
if (digest !== constants.digest) {
  fs.unlinkSync(vanilla)
  die('Track 1 is not a vanilla Castlevania: Symphony of the Night (USA)'
      + ' image.\n'
      + '  got:      ' + digest + '\n'
      + '  expected: ' + constants.digest)
}
console.log('Verified vanilla track 1  -> ' + vanilla)

const rest = path.join(dataDir, 'rest.bin')
const cue = path.join(dataDir, 'disc.cue')
if (track1End < total) {
  out = fs.openSync(rest, 'w')
  copySectors(files, track1End, total, out)
  fs.closeSync(out)
  const lines = ['FILE "@BIN@" BINARY']
  for (const track of tracks) {
    // Every track is written back at 2352 bytes per sector.
    lines.push('  TRACK ' + String(track.number).padStart(2, '0') + ' '
               + track.mode.replace(/\/2336$/, '/2352'))
    for (const [n, frames] of track.indexes) {
      lines.push('    INDEX ' + String(n).padStart(2, '0') + ' '
                 + framesToMsf(frames))
    }
  }
  fs.writeFileSync(cue, lines.join('\n') + '\n')
  console.log('Saved remaining tracks    -> ' + rest)
  console.log('Saved full-disc layout    -> ' + cue)
} else {
  // Don't leave a stale full-disc layout from an earlier setup.
  for (const f of [rest, cue]) {
    fs.rmSync(f, { force: true })
  }
}
