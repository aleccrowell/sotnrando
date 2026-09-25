# Fork CLI tooling

Local command-line helpers for this fork of the
[SotN randomizer](https://github.com/sotnrando/sotnrando). Everything
fork-specific lives in this `cli/` directory. Upstream files are left
untouched, so merging upstream updates never conflicts.

| Script | Purpose |
| --- | --- |
| `prepare-image.js` | Turn a SotN (USA) disc dump into the exact vanilla track 1 `.bin` the randomizer requires |
| `sotn-rando` | Wrapper around `node randomize` that handles the input and output paths and writes `.bin` + `.cue` + log |
| `sync-upstream` | Merge the latest upstream randomizer into this fork, then smoke-test it |

## One-time setup

```shell
cd sotnrando
npm ci                                   # install dependencies
mkdir -p ~/.local/share/sotn-rando
cli/prepare-image.js "path/to/Castlevania- Symphony of the Night.cue" \
    ~/.local/share/sotn-rando/vanilla.bin
```

### Why `prepare-image.js` is needed

The randomizer only accepts a disc image whose SHA-256 matches the vanilla
SotN (USA, SLUS-00067) **track 1** exactly. That track is 229020 sectors ×
2352 bytes = 538,655,040 bytes. Many dumps don't match as-is:

- **Multi-track single-file .bin**: track 1 and the audio track 2 are in one
  file. The script reads the `.cue` to find where track 1 ends.
- **Subchannel data**: the dump uses 2448-byte sectors (2352 + 96 bytes of
  subchannel). The script detects this from the sync headers and strips it.
  The dump in `~/archive/Castlevania- Symphony of the Night/` is this kind.

The script verifies the result against the randomizer's expected digest and
deletes the output if it doesn't match. It accepts either a `.cue` (preferred,
because it can then cut off track 2) or a bare `.bin`.

## Generating seeds: `sotn-rando`

```shell
cli/sotn-rando                         # default settings, random seed
cli/sotn-rando -p safe                 # preset
cli/sotn-rando -p nimble -s myseed     # preset + specific seed
cli/sotn-rando -p safe -t              # tournament mode (no spoilers)
cli/sotn-rando -p safe -vvv            # full spoiler output (relic locations)
cli/sotn-rando --out-dir ~/roms/sotn --name tonight -p casual
```

Output goes to `sotnrando/seeds/` by default. That directory is gitignored.
Each run writes:

- `NAME.bin`: the randomized track 1 image, playable in any PSX emulator or
  via POPStarter using the `.cue`. To burn a CD, see
  [Rebuilding a full disc image](#rebuilding-a-full-disc-image-after-randomizing).
- `NAME.cue`: a single-track cue sheet for it
- `NAME.log`: the console output (seed URL, seed, starting equipment, or more
  if you asked for more verbosity)

`NAME` defaults to `sotn-<preset>-<seed>`, for example
`sotn-safe-fe9c642b`.

Behavior:

- **Input image**: `$SOTN_VANILLA_BIN`, default
  `~/.local/share/sotn-rando/vanilla.bin`. You can't pass `-i`/`-o`; use
  `--out-dir`/`--name` instead.
- **Seed**: if you don't give `-s`, a random 8-hex-digit seed is generated
  and passed explicitly. That way the file name records it and the run can be
  reproduced.
- **Verbosity**: unless you pass `-v…`, `-r`, `-q` or `-t`, the wrapper adds
  `-r` (race mode: prints the seed URL and starting equipment).
- **Other options**: everything else is passed straight to `node randomize`.
  See `node randomize --help`, `node randomize --help preset` and
  `node randomize --help options` for the full list of presets and toggles,
  for example `-z` (anti-freeze), `-y` (my purse), `-9` (fast warp),
  `-l` (color rando), `-f presets/mypreset.json` (custom preset file).

A given preset + seed + options always produces a byte-identical image, the
same as a direct `node randomize -i … -o …` run.

### Known upstream issue: seed URLs

Passing a seed URL (`cli/sotn-rando https://sotn.io/?43a,abc`) currently fails
with `Checksum mismatch.`. The upstream `node randomize` fails the same way on
URLs it printed itself (as of upstream `711757a`), so this is not a wrapper
bug. Until upstream fixes it, reproduce a seed with its preset, seed and
options instead (`-p safe -s abc`).

## Rebuilding a full disc image after randomizing

`sotn-rando` outputs **track 1 only**, with a single-track `.cue`. That's
enough for emulators and POPStarter. The real disc also has a short audio
track 2 (the "don't play track 2 in a CD player" warning). To get a complete
disc image, for burning to CD-R or for an archive that matches the original
layout, put the randomized track 1 back in front of the original track 2.

These steps use [psxdr](https://github.com/aleccrowell/psxdr), checked out
next to this repo at `../psxdr`:

```shell
cd ../psxdr && poetry install --with iso && cd -     # once
PSXDR="$(realpath ../psxdr/.venv/bin/psxdr)"        # absolute, so it survives `cd`
DUMP="$HOME/archive/Castlevania- Symphony of the Night"
```

### 1. Make a 2352-byte copy of the full original disc (once)

The archived dump carries 96 bytes of subchannel per sector. Strip it so its
sectors line up with the randomizer's 2352-byte output:

```shell
$PSXDR convert "$DUMP/Castlevania- Symphony of the Night.bin" \
    ~/.local/share/sotn-rando/vanilla-full.bin --to-format strip
```

The result is 583,331,280 bytes: 248,015 sectors, track 1 followed by
track 2.

### 2. Replace track 1 with the randomized one

Track 1 is the first 538,655,040 bytes (229,020 sectors), exactly the size of
`sotn-rando`'s output. Keep everything after that from the original:

```shell
NAME=sotn-safe-fe9c642b                  # a seed made by cli/sotn-rando
cd seeds
{ cat "$NAME.bin"; tail -c +538655041 ~/.local/share/sotn-rando/vanilla-full.bin; } \
    > "$NAME-full.bin"
sed "s/^FILE \".*\"/FILE \"$NAME-full.bin\"/" \
    "$DUMP/Castlevania- Symphony of the Night.cue" > "$NAME-full.cue"
```

The `.cue` is the original two-track layout with the file name changed:

```
FILE "sotn-safe-fe9c642b-full.bin" BINARY
  TRACK 01 MODE2/2352
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    INDEX 00 50:53:45
    INDEX 01 50:55:45
```

### 3. Check it (optional)

```shell
$PSXDR verify "$NAME-full.bin"
```

Expect **track 02 to match Redump** and **track 01 to differ**, because it's
randomized. `verify` exits with status 1 and recommends `recover`/`salvage`.
Ignore that advice: the "damage" is the randomization.

The same splice with the vanilla track 1
(`~/.local/share/sotn-rando/vanilla.bin`) reproduces the original disc and
matches Redump on both tracks. That's how this procedure was checked.

### 4. Burn it

```shell
$PSXDR burn "$NAME-full.bin" --cue "$NAME-full.cue" --list-devices
$PSXDR burn "$NAME-full.bin" --cue "$NAME-full.cue" --device /dev/sr0 --speed 4 --simulate
$PSXDR burn "$NAME-full.bin" --cue "$NAME-full.cue" --device /dev/sr0 --speed 4
```

`burn` runs a preflight scan first. A rebuilt randomized image passes it
cleanly (0 EDC failures, 0 MSF mismatches), because the randomizer recomputes
EDC/ECC for every sector it touches. `--fix-msf` isn't needed. Burn at 4x
for original PS1 hardware.

### A note on `.iso`

```shell
$PSXDR convert "$NAME-full.bin" "$NAME.iso" --to-format iso --cue "$NAME-full.cue"   # needs bchunk
```

This produces a 2048-byte-per-sector ISO of track 1 (469,032,960 bytes), plus
`<name>02.cdr` with the raw track 2 audio. That's the layout of the `.iso`/`.cdr`
pair in `~/archive`.

**Don't play from the `.iso`.** SotN has 172,976 Mode 2 Form 2 sectors
(XA music and FMV) whose 2324-byte payloads get cut to 2048 bytes, so music
and cutscenes break. The ISO is only useful for browsing or extracting the
filesystem. For playing or burning, use the `.bin`/`.cue` from step 2.

## Keeping up to date with upstream: `sync-upstream`

```shell
cli/sync-upstream          # merge upstream/master into the current branch
cli/sync-upstream --push   # ...and push the result to origin
```

The script:

1. Adds the `upstream` remote (`https://github.com/sotnrando/sotnrando.git`)
   if it's missing.
2. Refuses to run on a dirty working tree.
3. Fetches and merges `upstream/master` into the current branch.
4. Runs `npm ci` if `package.json` or `package-lock.json` changed.
5. Runs a dry-run smoke test (`node randomize -s sync-smoke-test -p safe`,
   no image needed).

Merges should be conflict-free as long as fork changes stay inside `cli/`.
If you do change upstream files, keep those edits small so conflicts stay easy
to resolve.

When upstream changes the vanilla digest (it hasn't historically),
`sotn-rando` will report `Disc image is not a valid or vanilla backup`. In that
case, re-run `prepare-image.js`. If the new digest still doesn't match your
dump, upstream's supported disc version has changed.

## Optional: put `sotn-rando` on your PATH

```shell
ln -s "$PWD/cli/sotn-rando" ~/.local/bin/sotn-rando
```

The wrapper resolves symlinks to find the repo, so it works from any
directory.
