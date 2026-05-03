// Mic listener: FFT -> peak detection -> frequency-range classification
// -> {word | letter | marker} match -> spelling state machine.

const MIN_PEAK_DB = -55;

const MARKER_FREQ_MIN = 240;
const MARKER_FREQ_MAX = 420;
const WORD_FREQ_MIN = 430;
const WORD_FREQ_MAX = 2050;
const LETTER_FREQ_MIN = 2060;
const LETTER_FREQ_MAX = 6700;

const MATCH_COOLDOWN_MS = 600;
const SPELL_SILENCE_TIMEOUT_MS = 1500;

function findPeaksInRange(binsDb, binHz, minHz, maxHz) {
  const peaks = [];
  const startBin = Math.max(3, Math.floor(minHz / binHz));
  const endBin = Math.min(binsDb.length - 3, Math.ceil(maxHz / binHz));
  for (let i = startBin; i < endBin; i++) {
    const v = binsDb[i];
    if (v < MIN_PEAK_DB) continue;
    if (v <= binsDb[i - 1] || v <= binsDb[i + 1]) continue;
    if (v <= binsDb[i - 2] || v <= binsDb[i + 2]) continue;
    peaks.push({ freq: i * binHz, db: v });
  }
  peaks.sort((a, b) => b.db - a.db);
  return peaks;
}

function snapToBank(freq, bank, toleranceOctaves = 0.045) {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < bank.length; i++) {
    const d = Math.abs(Math.log2(freq / bank[i]));
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestDist > toleranceOctaves) return -1;
  return bestIdx;
}

function matchWordChord(indices) {
  const set = new Set(indices);
  if (set.size < 5) return null;
  for (const entry of VOCAB_ENTRIES) {
    let ok = true;
    for (const i of entry.indices) if (!set.has(i)) { ok = false; break; }
    if (ok) return entry;
  }
  return null;
}

function matchLetterChord(indices) {
  const set = new Set(indices);
  if (set.size < 3) return null;
  for (const entry of LETTER_ENTRIES) {
    let ok = true;
    for (const i of entry.indices) if (!set.has(i)) { ok = false; break; }
    if (ok) return entry;
  }
  return null;
}

function matchMarkerChord(indices) {
  if (indices.length < 2) return null;
  const set = new Set(indices);
  for (const [name, pair] of Object.entries(MARKERS)) {
    if (set.has(pair[0]) && set.has(pair[1])) return { name, chord: MARKER_CHORDS[name] };
  }
  return null;
}

class EridianListener {
  constructor({ onWord, onLetter, onMarker, onSpellComplete, onLevels, onError, onModeChange }) {
    this.onWord = onWord || (() => {});
    this.onLetter = onLetter || (() => {});
    this.onMarker = onMarker || (() => {});
    this.onSpellComplete = onSpellComplete || (() => {});
    this.onLevels = onLevels || (() => {});
    this.onError = onError || ((e) => console.error(e));
    this.onModeChange = onModeChange || (() => {});

    this.running = false;
    this._stream = null;
    this._ctx = null;
    this._rafId = 0;

    this._mode = "IDLE";
    this._spellBuffer = [];
    this._lastLetterAt = 0;
    this._lastEmit = { key: null, at: 0 };
  }

  async start() {
    if (this.running) return;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
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
    this._enterMode("IDLE");
    this._spellBuffer = [];
  }

  _enterMode(mode) {
    if (this._mode === mode) return;
    this._mode = mode;
    this.onModeChange(mode);
  }

  _flushSpelling() {
    if (this._spellBuffer.length > 0) {
      const text = this._spellBuffer.join("");
      this._spellBuffer = [];
      this.onSpellComplete(text);
    }
    this._enterMode("IDLE");
  }

  _tryEmit(key, handler) {
    const now = performance.now();
    if (this._lastEmit.key === key && now - this._lastEmit.at < MATCH_COOLDOWN_MS) return false;
    this._lastEmit = { key, at: now };
    handler();
    return true;
  }

  _loop() {
    if (!this.running) return;
    this._analyser.getFloatFrequencyData(this._bins);
    const binHz = this._ctx.sampleRate / this._analyser.fftSize;

    const markerPeaks = findPeaksInRange(this._bins, binHz, MARKER_FREQ_MIN, MARKER_FREQ_MAX).slice(0, 4);
    const wordPeaks = findPeaksInRange(this._bins, binHz, WORD_FREQ_MIN, WORD_FREQ_MAX).slice(0, 10);
    const letterPeaks = findPeaksInRange(this._bins, binHz, LETTER_FREQ_MIN, LETTER_FREQ_MAX).slice(0, 6);

    this.onLevels({ bins: this._bins, binHz });

    // Markers: two-tone signal in the low band.
    if (markerPeaks.length >= 2) {
      const idx = markerPeaks.map((p) => snapToBank(p.freq, MARKER_BANK, 0.06)).filter((i) => i >= 0);
      const marker = matchMarkerChord(idx);
      if (marker) {
        this._tryEmit(`marker:${marker.name}`, () => {
          this.onMarker(marker);
          if (marker.name === "SPELL") {
            this._spellBuffer = [];
            this._enterMode("SPELLING");
          } else if (marker.name === "END") {
            this._flushSpelling();
          }
        });
      }
    }

    // Letters: only accept while in SPELLING mode.
    if (this._mode === "SPELLING" && letterPeaks.length >= 3) {
      const idx = letterPeaks.map((p) => snapToBank(p.freq, LETTER_BANK, 0.045)).filter((i) => i >= 0);
      const unique = Array.from(new Set(idx));
      const letter = matchLetterChord(unique);
      if (letter) {
        this._tryEmit(`letter:${letter.letter}`, () => {
          this._spellBuffer.push(letter.letter);
          this._lastLetterAt = performance.now();
          this.onLetter(letter, this._spellBuffer.join(""));
        });
      }
    }

    // Words: only in IDLE mode, otherwise spelling-time word-range noise can fire.
    if (this._mode === "IDLE" && wordPeaks.length >= 5) {
      const idx = wordPeaks.map((p) => snapToBank(p.freq, PITCH_BANK, 0.045)).filter((i) => i >= 0);
      const unique = Array.from(new Set(idx));
      const entry = matchWordChord(unique.slice(0, 8));
      if (entry) {
        this._tryEmit(`word:${entry.word}`, () => this.onWord(entry));
      }
    }

    // Silence timeout while spelling flushes the buffer.
    if (this._mode === "SPELLING" && this._spellBuffer.length > 0) {
      const since = performance.now() - this._lastLetterAt;
      if (since > SPELL_SILENCE_TIMEOUT_MS) this._flushSpelling();
    }

    this._rafId = requestAnimationFrame(() => this._loop());
  }
}
