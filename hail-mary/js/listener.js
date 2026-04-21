// Microphone listener: FFT -> peak detection -> snap to PITCH_BANK -> match vocabulary.
const MIN_PEAK_DB = -55;
const MIN_FREQ_HZ = 300;
const MAX_FREQ_HZ = 2200;
const MATCH_COOLDOWN_MS = 1200;

function findPeaks(binsDb, binHz) {
  const peaks = [];
  for (let i = 3; i < binsDb.length - 3; i++) {
    const v = binsDb[i];
    if (v < MIN_PEAK_DB) continue;
    if (v <= binsDb[i - 1] || v <= binsDb[i + 1]) continue;
    if (v <= binsDb[i - 2] || v <= binsDb[i + 2]) continue;
    const freq = i * binHz;
    if (freq < MIN_FREQ_HZ || freq > MAX_FREQ_HZ) continue;
    peaks.push({ freq, db: v });
  }
  peaks.sort((a, b) => b.db - a.db);
  return peaks;
}

function snapToBankIndex(freq) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PITCH_BANK.length; i++) {
    const d = Math.abs(Math.log2(freq / PITCH_BANK[i]));
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  // Reject matches further than ~half a semitone (log2 ~= 0.042).
  if (bestDist > 0.045) return -1;
  return bestIdx;
}

function matchChordIndices(indices) {
  const set = new Set(indices);
  if (set.size < 5) return null;
  for (const entry of VOCAB_ENTRIES) {
    let ok = true;
    for (const i of entry.indices) {
      if (!set.has(i)) { ok = false; break; }
    }
    if (ok) return entry;
  }
  return null;
}

class EridianListener {
  constructor({ onMatch, onLevels, onError }) {
    this.onMatch = onMatch || (() => {});
    this.onLevels = onLevels || (() => {});
    this.onError = onError || ((e) => console.error(e));
    this.running = false;
    this._stream = null;
    this._ctx = null;
    this._rafId = 0;
    this._lastMatchAt = 0;
    this._lastMatchWord = null;
  }

  async start() {
    if (this.running) return;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      this.onError(err);
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this._ctx = new Ctx();
    const src = this._ctx.createMediaStreamSource(this._stream);
    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.2;
    src.connect(analyser);
    this._analyser = analyser;
    this._bins = new Float32Array(analyser.frequencyBinCount);
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
      this._stream = null;
    }
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }
  }

  _loop() {
    if (!this.running) return;
    this._analyser.getFloatFrequencyData(this._bins);
    const binHz = this._ctx.sampleRate / this._analyser.fftSize;
    const peaks = findPeaks(this._bins, binHz);
    this.onLevels({ bins: this._bins, binHz });

    if (peaks.length >= 5) {
      const top = peaks.slice(0, 8);
      const indices = top.map((p) => snapToBankIndex(p.freq)).filter((i) => i >= 0);
      const unique = Array.from(new Set(indices));
      if (unique.length >= 5) {
        const entry = matchChordIndices(unique.slice(0, 8));
        const now = performance.now();
        if (entry && (entry.word !== this._lastMatchWord || now - this._lastMatchAt > MATCH_COOLDOWN_MS)) {
          this._lastMatchAt = now;
          this._lastMatchWord = entry.word;
          this.onMatch(entry);
        }
      }
    }
    this._rafId = requestAnimationFrame(() => this._loop());
  }
}
