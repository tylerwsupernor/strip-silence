/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { ArrangementSelection } from "@ableton-extensions/sdk";
import {
  initialize,
  type ActivationContext,
  DataModelObject,
  AudioTrack,
} from "@ableton-extensions/sdk";

import * as fs from "fs/promises";
import decodeAudio from "audio-decode";

// For local builds, provide a fallback if the runtime shim is used and
// renderPreFxAudio isn't available. This fallback makes the command a no-op
// when running locally (avoids crashing the pack/build steps). In the real
// Ableton environment the SDK provides the actual implementation.
function isShimUnavailable(error: unknown): boolean {
  return !!(error && typeof error === "object" && (error as any).message && (error as any).message.includes("not available in the local shim"));
}


interface SilenceOptions {
  sampleRate: number;
  windowSize: number; // in samples
  rmsThreshold: number; // below this = silence
  minSilenceDuration: number; // in seconds
  sampleThreshold?: number; // optional per-sample amplitude threshold for boundary refinement
  safetyMilliseconds?: number; // default padding preserved on both sides of each silent gap
  headPaddingMs?: number | undefined; // quiet lead-in kept before each remaining clip's start (overrides safetyMilliseconds)
  tailPaddingMs?: number | undefined; // quiet decay kept after each remaining clip's end (overrides safetyMilliseconds)
}

interface SilenceRange {
  start: number; // seconds
  end: number; // seconds
}

// WARNING! ALL THIS CODE IS WRITTEN BY COPILOT! I DID NOT CARE ABOUT THE DETAILS AT ALL.
export function computeSilenceRanges(
  channels: Float32Array[],
  opts: SilenceOptions,
): SilenceRange[] {
  // Noise-gate style silence detection (per-sample) — behaves like a gate:
  // Any sample with absolute amplitude >= sampleThreshold is considered "audio".
  // Consecutive runs of samples below the threshold that last at least
  // minSilenceDuration are reported as silent ranges (in seconds).
  const { sampleRate, minSilenceDuration } = opts as SilenceOptions & { sampleThreshold?: number };
  const sampleThreshold = (opts as any).sampleThreshold ?? 0.001; // default ~ -60dB

  if (!channels.length) return [];
  const length = channels[0]!.length;
  if (length === 0) return [];

  const minSamples = Math.max(1, Math.floor((minSilenceDuration ?? 0.25) * sampleRate));
  const isLoud = new Uint8Array(length);

  // Mark samples loud if any channel exceeds the threshold
  for (let i = 0; i < length; i++) {
    let maxAbs = 0;
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c]![i] || 0;
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
    }
    isLoud[i] = maxAbs >= sampleThreshold ? 1 : 0;
  }

  // Find silent runs (consecutive samples where isLoud === 0)
  const ranges: SilenceRange[] = [];
  let runStart = -1;
  for (let i = 0; i < length; i++) {
    if (!isLoud[i]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLen = i - runStart;
      if (runLen >= minSamples) {
        ranges.push({ start: runStart / sampleRate, end: i / sampleRate });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const runLen = length - runStart;
    if (runLen >= minSamples) ranges.push({ start: runStart / sampleRate, end: length / sampleRate });
  }

  // Merge adjacent or touching ranges
  const merged: SilenceRange[] = [];
  for (const r of ranges) {
    if (!merged.length) merged.push(r);
    else {
      const last = merged[merged.length - 1]!;
      if (Math.abs(r.start - last.end) < 1e-4) last.end = r.end;
      else merged.push(r);
    }
  }

  // Apply a small safety padding around every silent range so audio on both sides
  // of each gap is preserved (avoids clipping transients at range edges).
  // headPaddingMs = quiet lead-in kept before each remaining clip's start.
  // tailPaddingMs = quiet decay kept after each remaining clip's end.
  // Each falls back to safetyMilliseconds (default 25ms) when not configured.
  const fallbackMs = Math.max(0, opts.safetyMilliseconds ?? 25);
  const headSeconds = Math.max(0, (opts.headPaddingMs ?? fallbackMs) / 1000);
  const tailSeconds = Math.max(0, (opts.tailPaddingMs ?? fallbackMs) / 1000);

  for (const r of merged) {
    // Shrink each silent range inward: tail pad on the start side, head pad on the end side.
    r.start = Math.min(r.end, r.start + tailSeconds);
    r.end = Math.max(r.start, r.end - headSeconds);
  }

  return merged.filter((r) => r.end - r.start > 1e-6);
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");


  context.commands.registerCommand("example.stripSilence", (arg: unknown) =>
    void (async (selection: ArrangementSelection) => {
      const tracks = selection.selected_lanes
        .map((handle) => context.getObjectFromHandle(handle, DataModelObject))
        .filter((obj) => obj instanceof AudioTrack);

      if (!tracks.length) {
        console.log("No audio tracks selected.");
        return;
      }

      // Skip the interactive UI and read project config if available. Use defaults otherwise.
      try {
        let windowSize = 2048;
        let rmsThreshold = 0.01;
        let minSilenceDuration = 0.25;
        let sampleThreshold = 0.001;
        let edgeToleranceSeconds = 0.05;

        // Helper that preserves 0 and treats NaN as fallback
        const parseNum = (v: unknown, fallback: number) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : fallback;
        };

        // Defaults for additional, configurable safety thresholds
        let cfgSafetyMs = 25;
        let cfgHeadPaddingMs = Number.NaN; // NaN = not set -> falls back to cfgSafetyMs
        let cfgTailPaddingMs = Number.NaN; // NaN = not set -> falls back to cfgSafetyMs
        let cfgTailEpsilonSeconds = 0.05;
        let cfgSnapThresholdBeats = 0.002;
        let cfgStartSnapSeconds = 0.01;
        // Attempt to read project-level config: .strip-silence.json
        try {
        const cfgText = await fs.readFile('.strip-silence.json', 'utf8');
        const cfg = JSON.parse(cfgText);
        windowSize = parseNum(cfg.windowSize, windowSize);
        rmsThreshold = parseNum(cfg.rmsThreshold, rmsThreshold);
        minSilenceDuration = parseNum(cfg.minSilenceDuration, minSilenceDuration);
        sampleThreshold = parseNum(cfg.sampleThreshold, sampleThreshold);
        edgeToleranceSeconds = parseNum(cfg.edgeToleranceSeconds, edgeToleranceSeconds);
        // additional, configurable safety thresholds
        cfgSafetyMs = parseNum(cfg.safetyMilliseconds, 25);
        // parseNum returns the fallback (NaN here) when a key is missing/invalid,
        // which we treat as "not set" so the detector falls back to safetyMilliseconds.
        cfgHeadPaddingMs = parseNum(cfg.headPaddingMs, Number.NaN);
        cfgTailPaddingMs = parseNum(cfg.tailPaddingMs, Number.NaN);
        const tailEpsilonMs = parseNum(cfg.tailEpsilonMs, 50);
        const snapThresholdBeatsCfg = parseNum(cfg.snapThresholdBeats, 0.002);
        const startSnapMs = parseNum(cfg.startSnapMillis, 10);
        // normalize to seconds where needed and assign
        cfgTailEpsilonSeconds = tailEpsilonMs / 1000;
        cfgSnapThresholdBeats = snapThresholdBeatsCfg;
        cfgStartSnapSeconds = startSnapMs / 1000;
        console.log('Using settings from .strip-silence.json');
        } catch {
        console.log('No .strip-silence.json; using defaults');
        }

        await context.ui.withinProgressDialog("Strip Silence", {}, async (update: (text: string, progress?: number) => Promise<void>, abortSignal: AbortSignal) => {
          try {
            // Phase 1: render and analyze all tracks
            const results: { track: AudioTrack<"1.0.0">; silence: SilenceRange[]; duration: number }[] = [];

            for (let i = 0; i < tracks.length; i++) {
              if (abortSignal.aborted) return;

              const track = tracks[i]!;
              await update(`Analyzing track ${i + 1}/${tracks.length}: ${track.name}`, (i / tracks.length) * 50);

              // renderPreFxAudio may be unavailable in the local shim — handle gracefully
              let wavPath: string | undefined;
              try {
                wavPath = await context.resources.renderPreFxAudio(
                  track,
                  selection.time_selection_start,
                  selection.time_selection_end,
                );
              } catch (err: any) {
                if (isShimUnavailable(err)) {
                  console.warn("renderPreFxAudio not available in the local shim; skipping track analysis");
                  continue; // skip this track in local/dev mode
                }
                throw err;
              }

              if (abortSignal.aborted) return;

              if (!wavPath) continue;

              const buf = await fs.readFile(wavPath);
              let decoded;
              try {
                decoded = await decodeAudio(buf);
              } finally {
                // attempt to remove temporary file created by the host (best-effort)
                try {
                  if (wavPath) await fs.unlink(wavPath);
                } catch {
                  // ignore cleanup errors
                }
              }

              const channelData = Array.from(
                { length: decoded.numberOfChannels },
                (_, j) => decoded.getChannelData(j),
              );

              const silence = computeSilenceRanges(channelData, {
                sampleRate: decoded.sampleRate,
                windowSize: windowSize,
                rmsThreshold: rmsThreshold,
                minSilenceDuration: minSilenceDuration,
                sampleThreshold: sampleThreshold,
                safetyMilliseconds: cfgSafetyMs,
                headPaddingMs: Number.isNaN(cfgHeadPaddingMs) ? undefined : cfgHeadPaddingMs,
                tailPaddingMs: Number.isNaN(cfgTailPaddingMs) ? undefined : cfgTailPaddingMs,
              });

              console.log(`[${track.name}] ${decoded.duration.toFixed(3)}s, ${silence.length} silent region(s)`);

              if (silence.length) {
                results.push({ track, silence, duration: decoded.duration });
              }
            }

            if (abortSignal.aborted) return;

            // Phase 2: strip all silence in one transaction (only leading/trailing edges)
            if (results.length) {
              const promises = context.withinTransaction(() => {
                return results.flatMap(({ track, silence, duration }) => {
                  const selectionBeats = selection.time_selection_end - selection.time_selection_start;
                  // defensive guards
                  if (!(duration > 0) || !(selectionBeats > 0)) return [];
                  const beatsPerSecond = selectionBeats / duration; // beats per second averaged over the rendered selection
                  // Map silence ranges to clip-beat ranges, clamp, then sort descending so
                  // clearing earlier ranges doesn't invalidate later ones.
                  const mapped = silence
                    .map((r) => {
                      const mappedStart = selection.time_selection_start + r.start * beatsPerSecond;
                      const mappedEnd = selection.time_selection_start + r.end * beatsPerSecond;
                      // clamp within the selection bounds
                      let startClamped = Math.max(selection.time_selection_start, mappedStart);
                      let endClamped = Math.min(selection.time_selection_end, mappedEnd);
                      // Use epsilon derived from config to treat near-edge ranges as touching the edge
                      const epsilonSeconds = Math.max(edgeToleranceSeconds, (typeof cfgTailEpsilonSeconds !== 'undefined' ? cfgTailEpsilonSeconds : 0.05));
                      // Only snap the silence start to the selection start when the
                      // detected silence is both near the beginning of the decoded audio
                      // AND maps very close to the selection start in beats. This avoids
                      // interior silences being incorrectly snapped to the front.
                      const mappedStartBeats = mappedStart - selection.time_selection_start;
                      // Make snapping stricter using config-driven threshold
                      const snapThresholdBeatsLocal = typeof cfgSnapThresholdBeats !== 'undefined' ? cfgSnapThresholdBeats : 0.002;
                      const startSnapSecondsLocal = Math.min(edgeToleranceSeconds, (typeof cfgStartSnapSeconds !== 'undefined' ? cfgStartSnapSeconds : 0.01));
                      if (r.start <= startSnapSecondsLocal && mappedStartBeats <= snapThresholdBeatsLocal) {
                        startClamped = selection.time_selection_start;
                      }
                      try {
                        // debug log of the mapped and clamped values
                        // (wrapped in try to avoid any issues in production hosts)
                        console.log(`[Strip Silence][${track.name}] r.start=${r.start.toFixed(6)}s mappedStart=${mappedStart.toFixed(6)} beats startClamped=${startClamped.toFixed(6)}s`);
                      } catch {}
                      if (duration - r.end <= epsilonSeconds) endClamped = selection.time_selection_end;
                      return { start: startClamped, end: endClamped };
                    })
                    .filter((p) => p.end - p.start > 1e-6)
                    .sort((a, b) => b.start - a.start);

                  // Log mapped ranges to help debug lingering end-of-clip slivers
                  try {
                    console.log(`[Strip Silence][${track.name}] mapped ranges before clear:`, mapped.map((m) => ({ start: m.start.toFixed(6), end: m.end.toFixed(6) })));
                  } catch (e) {
                    console.log('[Strip Silence] mapped ranges (unable to show track name)');
                  }

                  const clears = mapped.map((p) => track.clearClipsInRange(p.start, p.end));

                  // If any mapped range was snapped to the selection end, issue ONE extra
                  // defensive clear pinned exactly to the selection bounds, so it can never
                  // reach beyond the user's selection.
                  const tailSnapped = mapped.some((p) => Math.abs(p.end - selection.time_selection_end) < 1e-9);
                  if (tailSnapped) {
                    const tailEpsSec = Math.max(edgeToleranceSeconds, 0.05); // 50ms
                    const tailEpsBeats = tailEpsSec * beatsPerSecond;
                    const extraStart = Math.max(
                      selection.time_selection_start,
                      selection.time_selection_end - tailEpsBeats,
                    );
                    try {
                      console.log(`[Strip Silence][${track.name}] performing extra tail clear: ${extraStart.toFixed(6)} -> ${selection.time_selection_end.toFixed(6)} (beats)`);
                    } catch {}
                    clears.push(track.clearClipsInRange(extraStart, selection.time_selection_end));
                  }

                  return clears;
                });
              });
              await Promise.all(promises);
            }
          } catch (e) {
            if (abortSignal.aborted) return;
            throw e;
          }
        });
      } catch (e) {
        console.error("Error showing settings dialog or running strip:", e);
      }
    })(arg as ArrangementSelection).catch((e) => console.error(e)),
  );

  context.ui.registerContextMenuAction(
    "AudioTrack.ArrangementSelection",
    "Strip Silence",
    "example.stripSilence",
  );
}
