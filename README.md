# Strip Silence

> A beta Ableton Live Extension that scans selected audio tracks in the Arrangement view and automatically clears out silent regions, so you don't have to manually trim dead air from every clip.

**Strip Silence** is an Ableton Live Extension for cleaning up recorded or bounced audio by detecting and removing silent stretches from selected tracks within an arrangement selection.

Built to remove the repetitive task of manually zooming in and trimming silence at the heads/tails (and gaps) of recorded audio: select a time range on one or more audio tracks, run the command, and the Extension analyzes the audio and clears the silent parts automatically.

## Features

- Noise-gate style silence detection: any sample at or above a configurable amplitude threshold counts as "audio," and silent runs longer than a minimum duration get flagged for removal.
- Works across multiple selected audio tracks in one pass.
- Headless in this beta — no settings dialog yet; all tuning is done via a project-level `.strip-silence.json` config file.
- Safety padding around detected silence (default ~23ms) so quiet early transients aren't accidentally clipped.
- Extra tail-clearing logic to reduce leftover slivers at clip ends caused by host rounding.
- Runs as a single Live transaction, so the whole pass can be undone in one step.
- Limitation: it does not currently expose an in-app UI for adjusting settings — you must edit the JSON config file directly.
- Limitation: silence detection is amplitude/noise-gate based only in this beta (no RMS/windowed detection yet, even though those config fields exist).

## Requirements

This Extension currently requires:

- **Ableton Live 12 Suite Beta (minimum version TBD) or later**
- macOS tested (Tyler's M-series MacBook Pro); Windows not yet tested
- The packaged extension file: `Strip-Silence-0.0.1.ablx`

> [!IMPORTANT]
> Ableton Extensions are currently part of Ableton Live's public beta workflow. They do not work in Live Standard, Intro, Lite, or earlier Live versions. You do **not** need the Ableton Extensions SDK or Node.js just to install and use the `.ablx` file. [Ableton Extensions FAQ](https://help.ableton.com/hc/en-us/articles/27303428331420-Ableton-Extensions-FAQ)

## Disclaimer

This project was developed with help from AI tools (including Copilot for parts of the silence-detection logic), which assisted with parts of the code, troubleshooting, and documentation. I remain responsible for the design, testing, and final decisions, but it may not be written in the most elegant way — this is an early beta.

If AI-assisted development isn't your thing, no hard feelings at all. Thanks for giving it a look anyway.

## Installation

1. Download `Strip-Silence-0.0.1.ablx` from this repository's [Releases](../../releases) page.
2. Open **Ableton Live 12 Suite Beta**.
3. Open **Settings/Preferences**:
   - macOS: press `Cmd + ,`
   - Windows: open **Options → Preferences**
4. Select **Extensions**.
5. Drag `Strip-Silence-0.0.1.ablx` into the Extensions settings page.
6. Restart Live when prompted.

For normal use of the installed `.ablx`, make sure **Developer Mode is turned off**.

## How to Use

1. Go to the **Arrangement view**.
2. Select one or more **audio tracks** and make a **time selection** covering the region you want cleaned up.
3. Right-click the selection.
4. Choose **Extensions → Strip Silence**.
5. (Optional, beta only) Edit `.strip-silence.json` in your project folder beforehand to tune thresholds — there is no in-app prompt yet.
6. The Extension analyzes the selection and clears detected silent regions automatically.

Ableton renders each selected track's pre-FX audio, analyzes it for silence, then clears the silent ranges from the arrangement in one transaction, track by track.

## Example workflow

Say you recorded a vocal take with a few long gaps between phrases and want to quickly tighten it up before comping.

1. Select the vocal track and drag a time selection over the whole take.
2. Right-click → **Extensions → Strip Silence**.
3. The Extension renders the audio, detects the silent gaps between phrases, and clears them out.
4. The clip(s) update in place, with silence removed and a small safety pad left around each phrase:

```text
[Before] |----phrase----silence----phrase----silence----phrase----|
[After]  |----phrase----phrase----phrase----|
```

5. Zoom in to check the edges of each remaining phrase for any leftover slivers (a known beta issue).
6. If a threshold was too aggressive or too lenient, adjust `.strip-silence.json` and re-run on a fresh copy of the clip.

This saves the manual work of scrubbing through a long take and slicing out every silent gap by hand.

## Undo

The whole strip-silence operation is performed as one Ableton Live transaction.

Press:

- macOS: `Cmd + Z`
- Windows: `Ctrl + Z`

...once to restore the affected clips from that run.

## Safety

Strip Silence changes **only the clips within the tracks and time range you selected when you ran the command**.

It does not change:

- Tracks or clips outside the selected time range
- Tracks that weren't included in the selection
- Clip gain, effects, or routing
- Tempo or arrangement markers
- Any MIDI tracks or clips
- Project-level settings outside of `.strip-silence.json`

Still, as with any tool that changes a Live Set, test it first in a duplicate or saved version of an important project — this is a beta build with known edge cases around clip-end slivers.

## Troubleshooting

### I do not see "Extensions" in the right-click menu

Check all of the following:

- You are running **Ableton Live 12 Suite Beta (minimum version TBD) or later**
- You installed the `.ablx` file in **Settings/Preferences → Extensions**
- You restarted Live after installation
- **Developer Mode is off** when using the packaged `.ablx`
- You are in the **Arrangement view**, not **Session view**
- You have an audio track and a time selection made — Strip Silence won't appear without both

Extensions are context-sensitive: Live only shows them when the selected item matches the Extension's supported context.

### I installed it but an older version appears to run

Remove the old version from **Settings/Preferences → Extensions**, install `Strip-Silence-0.0.1.ablx`, then restart Live.

### I still see a tiny sliver of audio/silence at the start or end of a clip

This is a known beta issue (~4ms) caused by host beat↔time rounding. Try adjusting `safetyMilliseconds` or `edgeToleranceSeconds` in `.strip-silence.json`, and note it may not be fully resolved in this build.

### Can I use this in Live Standard, Intro, or Lite?

No. The Ableton Extensions public beta currently requires **Live 12 Suite Beta (minimum version TBD) or later**.

## Building From Source

If you want to edit or develop the Extension yourself:

```bash
npm install
npm start
```

Build an installable package with:

```bash
npm run package
```

This produces an `.ablx` file in the project folder.

Development requires the Ableton Extensions SDK, Node.js, and a compatible Ableton Live 12 Suite Beta installation. See the [official Ableton Extensions SDK documentation](https://ableton.github.io/extensions-sdk/).

## Configuration (beta)

Since this beta has no settings UI, create a `.strip-silence.json` file in your project folder to tune behavior:

```json
{
  "sampleThreshold": 0.0001,
  "minSilenceDuration": 0.02,
  "safetyMilliseconds": 23,
  "windowSize": 512,
  "rmsThreshold": 0.001
}
```

- `sampleThreshold` — linear amplitude threshold; anything above this counts as audio. To convert from dB: amplitude = 10^(dB/20) (e.g. -60 dB ≈ 0.001).
- `minSilenceDuration` — minimum length (in seconds) a quiet stretch must be to count as silence.
- `safetyMilliseconds` — padding left around detected audio to avoid clipping transients.
- `windowSize`, `rmsThreshold` — reserved for future RMS-based detection; not fully used by this beta's noise-gate logic yet.

## Version History

### v0.0.1-beta

- Initial beta release.
- Noise-gate style silence detection (`computeSilenceRanges`) with configurable amplitude threshold and minimum silence duration.
- Headless operation via `.strip-silence.json` config (no in-app settings UI yet).
- Safety padding and extra tail-clear logic to reduce rounding artifacts at clip boundaries.
- Known issue: small (~4ms) visual slivers may remain at sliced clip starts in some host/clip combinations.

## License

MIT License. See [`LICENSE`](./LICENSE) for details.

## Credits

Built by Tyler W. Supernor with the [Ableton Extensions SDK](https://ableton.github.io/extensions-sdk/).

Silence-detection logic drafted with AI (Copilot) assistance and refined by hand.

Ableton Live is a trademark of Ableton AG. This project is an independent community tool and is not affiliated with or endorsed by Ableton AG.