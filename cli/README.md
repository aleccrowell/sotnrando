# sotn-rando: command-line randomizing

This fork adds one command, `cli/sotn-rando`. It takes a
Castlevania: Symphony of the Night disc dump and produces randomized discs
that you can play in an emulator or burn to CD-R. It also keeps the fork up to
date with the [upstream randomizer](https://github.com/sotnrando/sotnrando).

```shell
cli/sotn-rando setup path/to/sotn.cue   # once
cli/sotn-rando -p safe                  # make a randomized disc
cli/sotn-rando burn <seed> --device /dev/sr0
cli/sotn-rando sync                     # pull in upstream updates
```

Run `cli/sotn-rando help` for a summary of all commands and options.

## 1. Setup (once)

You need Node.js 15+ and a dump of **Castlevania: Symphony of the Night
(USA)**. Point `setup` at the dump's `.cue` sheet:

```shell
cli/sotn-rando setup "$HOME/archive/Castlevania- Symphony of the Night/Castlevania- Symphony of the Night.cue"
```

`setup` installs the randomizer's dependencies if needed. It then checks the
dump and saves what later commands need in `~/.local/share/sotn-rando/`:

| File | What it is |
| --- | --- |
| `vanilla.bin` | Track 1 (the game data), the input the randomizer requires |
| `rest.bin` | The remaining track (the audio track 2), used to rebuild the full disc |
| `disc.cue` | The original disc's track layout |

Your dump itself is never modified. Most dump formats work:

- a single `.bin` holding every track, or one `.bin` per track
- 2352-byte sectors, or 2448-byte sectors that include subchannel data (as
  [psxdr](https://github.com/aleccrowell/psxdr) captures produce)

If the data doesn't match an unmodified SotN (USA) disc, `setup` reports an
error and saves nothing. The randomizer only works from a clean original.

Passing a bare `.bin` instead of a `.cue` also works. Only track 1 is saved
in that case, so randomized discs come out without the audio track.

## 2. Randomize

```shell
cli/sotn-rando                          # default settings, random seed
cli/sotn-rando -p safe                  # choose a preset
cli/sotn-rando -p nimble -s myseed      # choose a preset and seed
cli/sotn-rando -p safe -t               # tournament mode: no spoilers
cli/sotn-rando -p safe -vvv             # full spoilers (relic locations)
cli/sotn-rando presets                  # list the presets
```

Each run writes three files to `seeds/` in this repo. That directory is
gitignored.

| File | Contents |
| --- | --- |
| `sotn-<preset>-<seed>.bin` | The randomized disc |
| `sotn-<preset>-<seed>.cue` | Its cue sheet: **open this in your emulator** |
| `sotn-<preset>-<seed>.log` | Seed URL, seed and starting equipment (or full spoilers with `-vvv`) |

The output is a complete copy of the disc: the randomized data track plus the
original audio track, in the original layout. Use it for emulators and for
burning. For POPStarter on a PS2 (see the [main README](../README.md#console)),
add `--track1-only`, which matches the single-track cue that guide uses.

Options:

- `-p/--preset NAME` and `-s/--seed SEED`: without `-s`, a random seed is
  picked and recorded in the file name. The same preset, seed and options
  always produce the same disc.
- `--out-dir DIR` and `--name NAME` control where output goes and what it's
  called.
- `--track1-only` writes just the data track, without audio track 2. The
  disc is 45 MB smaller and still plays fine.
- Every other option goes straight to the randomizer. For example, `-z`
  (no level-up freezes), `-y` (Death doesn't take your gear), `-9` (fast
  warps), `-l` (random colors), or `-f my-preset.json` (your own preset). See
  `node randomize --help` and `node randomize --help options` for the full
  list.

## 3. Burn to CD-R (optional)

`burn` uses [psxdr](https://github.com/aleccrowell/psxdr) to write a seed to
a blank CD-R. It finds psxdr through `$PSXDR`, then your `PATH`, then a
checkout next to this repo (`../psxdr`, after `poetry install` there).

```shell
cli/sotn-rando burn sotn-safe-1a2b3c4d --list-devices          # find your burner
cli/sotn-rando burn sotn-safe-1a2b3c4d --device /dev/sr0 --simulate
cli/sotn-rando burn sotn-safe-1a2b3c4d --device /dev/sr0
```

You can name a seed from `seeds/` by its name, or pass the path to any
`.cue`. Burns run at 4x unless you pass `--speed`, because slow burns read
more reliably on original PlayStation hardware. Any other options go to
`psxdr burn`.

Before writing, psxdr checks the image for errors. Randomized discs pass
cleanly.

### Checking a disc (optional)

```shell
../psxdr/.venv/bin/psxdr verify seeds/sotn-safe-1a2b3c4d.bin
```

This compares the disc with the Redump database. For a randomized disc, expect
track 2 to match and track 1 to differ. `verify` then exits with status 1 and
suggests recovery commands. Ignore that advice: the difference is the
randomization.

### About `.iso` files

`psxdr convert <disc>.bin <disc>.iso --to-format iso --cue <disc>.cue` (needs
`bchunk`) produces a 2048-byte-per-sector ISO. **Don't play or burn it.** SotN
stores its music and cutscenes in sectors that an ISO cuts short, so they
break. An ISO is only useful for browsing the disc's files.

## Keeping up to date with upstream

```shell
cli/sotn-rando sync          # merge the latest upstream into this branch
cli/sotn-rando sync --push   # ...and push it to your fork
```

`sync` does the following:

1. Adds the `upstream` remote if it's missing.
2. Merges `sotnrando/sotnrando`'s `master` branch.
3. Reinstalls dependencies if they changed.
4. Runs a quick test generation to make sure the randomizer still works.

It needs a clean working tree. All of this fork's files live in `cli/`, so
upstream merges don't conflict with them.

If a future upstream version stops accepting your dump
(`Disc image is not a valid or vanilla backup`), run `setup` again. If
`setup` then fails too, upstream has changed which disc version it supports.

## Tips

- **Put it on your PATH:** `ln -s "$PWD/cli/sotn-rando" ~/.local/bin/`.
  Then run `sotn-rando -p safe` from any directory.
- **Keep the data somewhere else:** set `SOTN_RANDO_DATA=/some/dir` for both
  `setup` and later runs.

## Known issue: seed URLs

Passing a seed URL (`cli/sotn-rando https://sotn.io/?43a,abc`) currently fails
with `Checksum mismatch.`. The upstream randomizer fails the same way on URLs
it printed itself (as of upstream `711757a`), so this is an upstream bug.
Until it's fixed, recreate a seed from its preset and seed instead:
`-p safe -s abc`.
