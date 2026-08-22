/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { ArrangementSelection, ExtensionContext } from "@ableton-extensions/sdk";
import {
  initialize,
  type ActivationContext,
  DataModelObject,
  AudioTrack,
} from "@ableton-extensions/sdk";

import * as fs from "fs/promises";
import decodeAudio from "audio-decode";
import dialogHtml from "../ui/dialog.html";

// For local builds, provide a fallback if the runtime shim is used and
// renderPreFxAudio isn't available. This fallback makes the command a no-op
// when running locally (avoids crashing the pack/build steps). In the real
// Ableton environment the SDK provides the actual implementation.
function isShimUnavailable(error: unknown): boolean {
  return !!(error && typeof error === "object" && (error as any).message && (error as any).message.includes("not available in the local shim"));
}


interface SilenceOptions {
  sampleRate: number;
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

export function computeSilenceRanges(
  channels: Float32Array[],
  opts: SilenceOptions,
): SilenceRange[] {
  // Noise-gate style silence detection (per-sample) — behaves like a gate:
  // Any sample with absolute amplitude >= sampleThreshold is considered "audio".
  // Consecutive runs of samples below the threshold that last at least
  // minSilenceDuration are reported as silent ranges (in seconds).
  const { sampleRate, minSilenceDuration } = opts;
  const sampleThreshold = opts.sampleThreshold ?? 0.001; // default ~ -60dB

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

// Everything the pipeline needs, in one place. The headless command fills this
// from .strip-silence.json (or defaults); the dialog command layers user edits on top.
interface StripSettings {
  minSilenceDuration: number; // seconds
  sampleThreshold: number; // linear amplitude
  safetyMilliseconds: number;
  headPaddingMs: number | undefined; // undefined = fall back to safetyMilliseconds
  tailPaddingMs: number | undefined; // undefined = fall back to safetyMilliseconds
  edgeToleranceSeconds: number;
  tailEpsilonSeconds: number;
  snapThresholdBeats: number;
  startSnapSeconds: number;
}

// Preserves explicit zeros; missing/invalid values return the fallback.
function parseNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultSettings(): StripSettings {
  return {
    minSilenceDuration: 0.25,
    sampleThreshold: 0.001, // ~ -60 dB
    safetyMilliseconds: 25,
    headPaddingMs: undefined,
    tailPaddingMs: undefined,
    edgeToleranceSeconds: 0.05,
    tailEpsilonSeconds: 0.05,
    snapThresholdBeats: 0.002,
    startSnapSeconds: 0.01,
  };
}

async function loadSettings(): Promise<StripSettings> {
  const settings = defaultSettings();
  try {
    const text = await fs.readFile(".strip-silence.json", "utf8");
    const cfg = JSON.parse(text) as Record<string, unknown>;
    settings.minSilenceDuration = parseNum(cfg.minSilenceDuration, settings.minSilenceDuration);
    settings.sampleThreshold = parseNum(cfg.sampleThreshold, settings.sampleThreshold);
    settings.edgeToleranceSeconds = parseNum(cfg.edgeToleranceSeconds, settings.edgeToleranceSeconds);
    settings.safetyMilliseconds = parseNum(cfg.safetyMilliseconds, 25);
    // Missing/invalid key -> NaN sentinel -> converted to undefined at this
    // boundary so the detector falls back to safetyMilliseconds.
    const head = parseNum(cfg.headPaddingMs, Number.NaN);
    const tail = parseNum(cfg.tailPaddingMs, Number.NaN);
    settings.headPaddingMs = Number.isNaN(head) ? undefined : head;
    settings.tailPaddingMs = Number.isNaN(tail) ? undefined : tail;
    settings.tailEpsilonSeconds = parseNum(cfg.tailEpsilonMs, 50) / 1000;
    settings.snapThresholdBeats = parseNum(cfg.snapThresholdBeats, settings.snapThresholdBeats);
    settings.startSnapSeconds = parseNum(cfg.startSnapMillis, 10) / 1000;
    console.log("Using settings from .strip-silence.json");
  } catch {
    console.log("No .strip-silence.json; using defaults");
  }
  return settings;
}

function resolveAudioTracks(
  context: ExtensionContext,
  selection: ArrangementSelection,
): AudioTrack<"1.0.0">[] {
  return selection.selected_lanes
    .map((handle) => context.getObjectFromHandle(handle, DataModelObject))
    .filter((obj) => obj instanceof AudioTrack);
}

// Renders each track pre-FX, detects silence, and clears it inside one
// transaction. Both menu commands funnel through here.
async function runStrip(
  context: ExtensionContext,
  tracks: AudioTrack<"1.0.0">[],
  selection: ArrangementSelection,
  settings: StripSettings,
): Promise<void> {
  await context.ui.withinProgressDialog("Strip Silence", {}, async (update, abortSignal) => {
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
            await fs.unlink(wavPath);
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
          minSilenceDuration: settings.minSilenceDuration,
          sampleThreshold: settings.sampleThreshold,
          safetyMilliseconds: settings.safetyMilliseconds,
          headPaddingMs: settings.headPaddingMs,
          tailPaddingMs: settings.tailPaddingMs,
        });

        console.log(`[${track.name}] ${decoded.duration.toFixed(3)}s, ${silence.length} silent region(s)`);

        if (silence.length) {
          results.push({ track, silence, duration: decoded.duration });
        }
      }

      if (abortSignal.aborted) return;

      // Phase 2: strip all silence in one transaction (only leading/trailing edges)
      if (!results.length) return;

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
              // Treat near-edge ranges as touching the edge within this tolerance
              const epsilonSeconds = Math.max(settings.edgeToleranceSeconds, settings.tailEpsilonSeconds);
              // Only snap the silence start to the selection start when the
              // detected silence is both near the beginning of the decoded audio
              // AND maps very close to the selection start in beats. This avoids
              // interior silences being incorrectly snapped to the front.
              const mappedStartBeats = mappedStart - selection.time_selection_start;
              const startSnapSeconds = Math.min(settings.edgeToleranceSeconds, settings.startSnapSeconds);
              if (r.start <= startSnapSeconds && mappedStartBeats <= settings.snapThresholdBeats) {
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
          } catch {
            console.log("[Strip Silence] mapped ranges (unable to show track name)");
          }

          const clears = mapped.map((p) => track.clearClipsInRange(p.start, p.end));

          // If any mapped range was snapped to the selection end, issue ONE extra
          // defensive clear pinned exactly to the selection bounds, so it can never
          // reach beyond the user's selection.
          const tailSnapped = mapped.some((p) => Math.abs(p.end - selection.time_selection_end) < 1e-9);
          if (tailSnapped) {
            const tailEpsSec = Math.max(settings.edgeToleranceSeconds, 0.05); // 50ms floor
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
    } catch (e) {
      if (abortSignal.aborted) return;
      throw e;
    }
  });
}

interface DialogFields {
  thresholdDb?: string;
  headPadMs?: string;
  tailPadMs?: string;
}

function linearToDbText(amplitude: number): string {
  return amplitude > 0 ? (20 * Math.log10(amplitude)).toFixed(1) : "";
}

// The dialog is a static HTML string, so current values are injected by
// replacing placeholder tokens before the data URL is built.
function prefillDialogHtml(template: string, settings: StripSettings): string {
  return template
    .split("__THRESHOLD_DB__").join(linearToDbText(settings.sampleThreshold))
    .split("__HEAD_PAD__").join(settings.headPaddingMs === undefined ? "" : String(settings.headPaddingMs))
    .split("__TAIL_PAD__").join(settings.tailPaddingMs === undefined ? "" : String(settings.tailPaddingMs));
}

// Empty padding field = "not set" -> falls back to safetyMilliseconds downstream.
// A non-numeric entry keeps whatever the config file had instead.
function parsePaddingField(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const n = Number(raw);
  return n >= 0 && Number.isFinite(n) ? n : fallback;
}

// Turns the dialog's JSON reply into final settings. Returns undefined when the
// dialog was cancelled or sent nothing usable, so callers can bail out cleanly.
function applyDialogOverrides(base: StripSettings, raw: string | null): StripSettings | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  let fields: DialogFields;
  try {
    fields = JSON.parse(raw) as DialogFields;
  } catch {
    return undefined;
  }
  if (!fields || typeof fields !== "object") return undefined;

  // Threshold arrives as dB; convert once here. Empty or nonsensical keeps base.
  // An empty threshold must NOT become 0 dB (= amplitude 1 = detect everything as silent).
  const dbText = typeof fields.thresholdDb === "string" ? fields.thresholdDb.trim() : "";
  const db = dbText === "" ? Number.NaN : Number(dbText);
  const sampleThreshold = Number.isFinite(db) && db <= 0 ? Math.pow(10, db / 20) : base.sampleThreshold;

  return {
    ...base,
    sampleThreshold,
    headPaddingMs: parsePaddingField(fields.headPadMs, base.headPaddingMs),
    tailPaddingMs: parsePaddingField(fields.tailPadMs, base.tailPaddingMs),
  };
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Headless entry point: runs with .strip-silence.json values (or built-in defaults).
  context.commands.registerCommand("example.stripSilence", (arg: unknown) =>
    void (async (selection: ArrangementSelection) => {
      try {
        const tracks = resolveAudioTracks(context, selection);
        if (!tracks.length) {
          console.log("No audio tracks selected.");
          return;
        }
        await runStrip(context, tracks, selection, await loadSettings());
      } catch (e) {
        console.error("Error running strip:", e);
      }
    })(arg as ArrangementSelection).catch((e) => console.error(e)),
  );

  // Interactive entry point: opens a small settings dialog first.
  // Esc or Cancel exits before any render or clear — nothing to undo.
  context.commands.registerCommand("example.stripSilenceEdit", (arg: unknown) =>
    void (async (selection: ArrangementSelection) => {
      try {
        const tracks = resolveAudioTracks(context, selection);
        if (!tracks.length) {
          console.log("No audio tracks selected.");
          return;
        }

        const base = await loadSettings();
        const url = `data:text/html,${encodeURIComponent(prefillDialogHtml(dialogHtml, base))}`;
        let raw: string | null;
        try {
          raw = await context.ui.showModalDialog(url, 320, 210);
        } catch (e) {
          console.log("Strip Silence Edit dialog closed without a result:", e);
          return;
        }

        const settings = applyDialogOverrides(base, raw);
        if (!settings) {
          console.log("Strip Silence Edit cancelled; nothing changed.");
          return;
        }

        await runStrip(context, tracks, selection, settings);
      } catch (e) {
        console.error("Error running strip with dialog:", e);
      }
    })(arg as ArrangementSelection).catch((e) => console.error(e)),
  );

  context.ui.registerContextMenuAction(
    "AudioTrack.ArrangementSelection",
    "Strip Silence",
    "example.stripSilence",
  );
  context.ui.registerContextMenuAction(
    "AudioTrack.ArrangementSelection",
    "Strip Silence Edit",
    "example.stripSilenceEdit",
  );
}
