// Play chords (single or sequence) via the Web Audio API.
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  return sharedAudioCtx;
}

function scheduleChord(ctx, frequencies, startAt, { duration = 0.5, peakGain = 0.18 } = {}) {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, startAt);
  master.gain.linearRampToValueAtTime(peakGain, startAt + 0.04);
  master.gain.setValueAtTime(peakGain, startAt + duration - 0.08);
  master.gain.linearRampToValueAtTime(0, startAt + duration);
  master.connect(ctx.destination);

  for (const f of frequencies) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, startAt);
    osc.connect(master);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }
}

function playChord(frequencies, opts = {}) {
  const ctx = getAudioCtx();
  const duration = opts.duration ?? 0.85;
  scheduleChord(ctx, frequencies, ctx.currentTime + 0.03, { ...opts, duration });
  return duration;
}

// Play a sequence of chords separated by short gaps.
// `chords` is an array of { frequencies, duration?, gapAfter? }.
function playSequence(chords, { defaultDuration = 0.45, defaultGap = 0.15, peakGain = 0.18 } = {}) {
  const ctx = getAudioCtx();
  let t = ctx.currentTime + 0.05;
  for (const step of chords) {
    const d = step.duration ?? defaultDuration;
    scheduleChord(ctx, step.frequencies, t, { duration: d, peakGain });
    t += d + (step.gapAfter ?? defaultGap);
  }
  return t - ctx.currentTime;
}

// Convert text to a chord sequence: SPELL marker, each letter as a 3-chord,
// then END marker. Unknown characters (punctuation, whitespace) are skipped.
function buildSpellingSequence(text) {
  const steps = [{ frequencies: MARKER_CHORDS.SPELL, duration: 0.35, gapAfter: 0.25 }];
  for (const rawCh of text) {
    const ch = rawCh.toLowerCase();
    const entry = LETTER_BY_CHAR.get(ch);
    if (!entry) continue;
    steps.push({ frequencies: entry.chord, duration: 0.35, gapAfter: 0.18 });
  }
  steps.push({ frequencies: MARKER_CHORDS.END, duration: 0.35, gapAfter: 0.1 });
  return steps;
}

function speakEnglish(text) {
  const normalized = text.trim();
  if (!normalized) return { kind: "empty" };
  const entry = VOCAB_BY_WORD.get(normalized.toLowerCase());
  if (entry) {
    playChord(entry.chord);
    return { kind: "word", entry };
  }
  const sequence = buildSpellingSequence(normalized);
  playSequence(sequence);
  return { kind: "spelled", text: normalized, sequence };
}

function playMarker(name) {
  const chord = MARKER_CHORDS[name];
  if (chord) playChord(chord, { duration: 0.45 });
}
