# Changelog

All notable changes to this project are documented in this file.

## [0.0.4-beta] - 2026-08-22
### Changed
- New field-tested base defaults: threshold stays at -60 dB, tail padding keeps falling back to the 25 ms safety padding, and the built-in head pad drops to 0 instead of "use the safety padding". At -60 dB the cut already lands at the start of each sound; repeated testing showed even half a sample (0.01228 ms) of extra lead-in made no difference. The README example config shows these values as the recommended starting point, and the project's `.strip-silence.json` matches them.

## [0.0.3-beta] - 2026-08-22
### Added
- Second right-click command, **Strip Silence Edit**, which opens a small settings dialog before running. Three fields: Threshold (dB), Head pad (ms), Tail pad (ms). Enter or the Strip button runs; Esc or Cancel closes without rendering or clearing anything.
- Dialog values prefill from `.strip-silence.json` when present, otherwise from built-in defaults. Dialog entries apply to that run only and never write back to the file.
- Threshold is typed in dB and converted to linear amplitude once where the dialog result arrives. Empty padding fields fall back to `safetyMilliseconds`, same rule as the config file.

### Changed
- The strip pipeline (render, detect, clear) moved into one shared function. Both commands run identical code; **Strip Silence** remains fully headless and reads only the config file, exactly as before.

### Unchanged
- Detection algorithm, beat mapping, single transaction with descending clears, strict clamping to the time selection, and all other `.strip-silence.json` keys.

### Known issues
- When the time selection starts flush with the first clip's start (no lead-in selected before it), a few milliseconds of silence can remain at the very beginning of the selection after stripping. Host beat↔time rounding at the selection edge is the cause; the selection end has an extra defensive clear but the selection start does not yet. Workaround: extend the selection slightly before the first clip.

## [0.0.2-beta] - 2026-08-21
### Added
- Separate padding controls in `.strip-silence.json`: `headPaddingMs` (quiet lead-in kept before each remaining clip's start) and `tailPaddingMs` (quiet decay kept after each remaining clip's end). Each falls back to `safetyMilliseconds` when omitted, preserving existing config behavior.

### Fixed
- Safety padding (`safetyMilliseconds`) now shrinks each detected silent range inward on **both** sides, preserving audio at both edges of every gap (previously only the range end was padded).
- `safetyMilliseconds` from `.strip-silence.json` is now forwarded to `computeSilenceRanges`; previously the config value was parsed but silently ignored (the detector always used its 25 ms default).
- Removed a second padding pass in the beat-mapping stage that moved clear ranges in the wrong direction (deleting extra audio before gaps) and mixed seconds with beats.
- Removed an unconditional epsilon expansion of clear-range ends that could eat into audio following a silent gap.
- Tail-clear workaround now issues a single defensive clear pinned to the selection end instead of two overlapping clears, one of which overshot past the user's selection; all clears are strictly clamped to `[time_selection_start, time_selection_end]`.

### Unchanged
- Silence detection remains per-sample noise-gate based (`computeSilenceRanges`); only boundary bookkeeping changed.
- Tempo mapping is still linear over the rendered selection.
- The whole strip operation still runs as one Live transaction (single undo step), with descending-order clearing.

## [0.0.1-beta] - 2026-08-18
### Added
- Initial beta release published as `0.0.1-beta`.
- Noise-gate style silence detection implemented (computeSilenceRanges): per-sample amplitude gate where any sample with absolute amplitude >= `sampleThreshold` is preserved; contiguous runs below the threshold longer than `minSilenceDuration` are removed.
- Headless operation: removed blocking settings UI and local shim; configuration is read from `.strip-silence.json`.
- Exported computeSilenceRanges for easier local testing and unit conversion.
- Project-level configuration via `.strip-silence.json` (examples: `sampleThreshold`, `minSilenceDuration`, `safetyMilliseconds`, `windowSize`, `rmsThreshold`, `edgeToleranceSeconds`).
- Safety padding (`safetyMilliseconds`) to avoid trimming very early transients (default 23 ms in this build).
- Extra tail-clear logic to mitigate host rounding/quantization that can leave tiny slivers at clip ends.

### Fixed
- Ensured temporary WAV files are unlinked after rendering (try/finally cleanup).
- Replaced tempo-based seconds→beats mapping with mapping derived from the rendered selection (selectionBeats / decoded.duration) to avoid global tempo assumptions.
- Robust numeric parsing helper to preserve explicit zero-valued configs.
- Wrapped host calls and shim fallbacks to avoid crashes when running in local shim.

### Known issues
- Some clips may still show a small visual buffer (~4 ms) at sliced starts due to host beat↔time mapping and display rounding. Safety padding and extra-clears reduce risk but may not perfectly match every host/clip combination.
- No interactive settings UI in this beta; configuration is file-based via `.strip-silence.json`.

### Notes / Usage
- Edit `.strip-silence.json` to tune behavior. Example:

```json
{
  "sampleThreshold": 0.0001,
  "minSilenceDuration": 0.02,
  "safetyMilliseconds": 23,
  "windowSize": 512,
  "rmsThreshold": 0.001
}
```

- `sampleThreshold` is a linear amplitude threshold. To use dB values: amplitude = 10^(dB/20) (e.g. -60 dB ≈ 0.001).
- Run the extension in Ableton as usual; the extension operates headless and uses `.strip-silence.json` for configuration.
