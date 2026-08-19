# Changelog

All notable changes to this project are documented in this file.

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

---

If you want a different changelog style (Keep a Changelog, semantic release, or a shorter release note), tell me and I will update it. If you'd like this added as a release artifact (zip) or committed to a git repository, I can do that next.