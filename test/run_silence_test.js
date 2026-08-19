// Minimal copy of computeSilenceRanges (JS) for local testing
function computeSilenceRanges(channels, opts) {
  const { sampleRate, windowSize, rmsThreshold, minSilenceDuration } = opts;
  const sampleThreshold = opts.sampleThreshold ?? 0.001;
  if (!channels.length) return [];
  const length = channels[0].length;
  const windowDur = windowSize / sampleRate;
  const minWindows = Math.ceil(minSilenceDuration / windowDur);
  const rmsVals = [];
  for (let i = 0; i < length; i += windowSize) {
    const end = Math.min(i + windowSize, length);
    let sumSq = 0;
    let count = 0;
    for (let j = i; j < end; j++) {
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][j];
        sumSq += v * v;
      }
      count += channels.length;
    }
    rmsVals.push(Math.sqrt(sumSq / count));
  }
  const silentFlags = rmsVals.map((v) => v < rmsThreshold);
  // Debug: print first few rmsVals and flags
  console.log('rmsVals (first 10):', rmsVals.slice(0, 10).map((v) => v.toExponential(3)));
  console.log('silentFlags (first 10):', silentFlags.slice(0, 10));
  const ranges = [];
  let runStart = -1;
  for (let i = 0; i < silentFlags.length; i++) {
    if (silentFlags[i]) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLen = i - runStart;
      console.log('Found silent run', runStart, 'to', i, 'len', runLen);
      if (runLen >= minWindows) {
        ranges.push({ start: runStart * windowDur, end: i * windowDur });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const runLen = silentFlags.length - runStart;
    console.log('Found trailing silent run', runStart, 'to', silentFlags.length, 'len', runLen);
    if (runLen >= minWindows) {
      ranges.push({ start: runStart * windowDur, end: silentFlags.length * windowDur });
    }
  }
  console.log('Ranges before merge/refine:', ranges);
  const merged = [];
  for (const r of ranges) {
    if (!merged.length) merged.push(r);
    else {
      const last = merged[merged.length - 1];
      if (Math.abs(r.start - last.end) < 1e-4) last.end = r.end;
      else merged.push(r);
    }
  }
  console.log('Merged ranges before refine:', merged);
  // refine boundaries per-sample
  for (const r of merged) {
    let startSample = Math.max(0, Math.floor(r.start * sampleRate));
    // Only tighten start within the originally-detected window (don't move start past r.end)
    const originalEndSample = Math.min(length, Math.ceil(r.end * sampleRate));
    let foundStart = false;
    for (let i = startSample; i < originalEndSample; i++) {
      let anyLoud = false;
      for (let c = 0; c < channels.length; c++) {
        if (Math.abs(channels[c][i]) > sampleThreshold) { anyLoud = true; break; }
      }
      if (anyLoud) { startSample = i; foundStart = true; break; }
    }
    // If no loud sample found inside original window, keep the original start (do not advance)
    if (!foundStart) startSample = Math.max(0, Math.floor(r.start * sampleRate));
    r.start = startSample / sampleRate;
    // Prefer forward search from the estimated end to find the first loud sample
    let endSample = Math.min(length, Math.ceil(r.end * sampleRate));
    let found = false;
    for (let i = Math.floor(r.end * sampleRate); i < length; i++) {
      let anyLoud = false;
      for (let c = 0; c < channels.length; c++) {
        if (Math.abs(channels[c][i]) > sampleThreshold) {
          anyLoud = true; break;
        }
      }
      if (anyLoud) { endSample = i + 1; found = true; break; }
    }
    // If forward search didn't find loud samples (e.g., range included louds earlier), fall back to backward scan
    if (!found) {
      endSample = Math.min(length, Math.ceil(r.end * sampleRate));
      while (endSample > 0) {
        let anyLoud = false;
        for (let c = 0; c < channels.length; c++) {
          if (Math.abs(channels[c][endSample - 1]) > sampleThreshold) {
            anyLoud = true; break;
          }
        }
        if (anyLoud) break;
        endSample--;
      }
    }
    r.end = endSample / sampleRate;
  }
  return merged.filter((r) => r.end - r.start > 1e-6);
}

// Load config
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let cfg = {
  windowSize: 1024,
  rmsThreshold: 0.001,
  minSilenceDuration: 0.05,
  sampleThreshold: 0.0005,
  edgeToleranceSeconds: 0.02
};
try {
  const text = fs.readFileSync('./.strip-silence.json','utf8');
  cfg = Object.assign(cfg, JSON.parse(text));
  console.log('Using .strip-silence.json:', cfg);
} catch (e) {
  console.log('No .strip-silence.json, using defaults');
}

// Create synthetic audio: 0.05s silence, then a short ramp into audio, then trailing silence
const sr = 44100;
const totalSec = 2.0;
const totalSamples = Math.floor(totalSec * sr);
const leadSilenceSec = 0.05; // 50ms silence
const leadSilenceSamples = Math.floor(leadSilenceSec * sr);
const trailSilenceSec = 0.05;
const trailSilenceSamples = Math.floor(trailSilenceSec * sr);
const audioStart = leadSilenceSamples;
const audioEnd = totalSamples - trailSilenceSamples;
const channel = new Float32Array(totalSamples);
for (let i = 0; i < totalSamples; i++) {
  if (i < audioStart) channel[i] = 0.0;
  else if (i >= audioEnd) channel[i] = 0.0;
  else {
    // simple sine with small amplitude
    channel[i] = 0.1 * Math.sin(2 * Math.PI * 440 * (i / sr));
    // add tiny noise near beginning to simulate low-level content
    if (i < audioStart + 50) channel[i] *= (i / 50);
  }
}

const ranges = computeSilenceRanges([channel], {
  sampleRate: sr,
  windowSize: cfg.windowSize,
  rmsThreshold: cfg.rmsThreshold,
  minSilenceDuration: cfg.minSilenceDuration,
  sampleThreshold: cfg.sampleThreshold,
});

console.log('Detected silence ranges:', ranges);
console.log('Leading silence end (seconds):', ranges.length ? ranges[0].end : 'none');
console.log('Expected leading silence end (approx):', leadSilenceSec);
