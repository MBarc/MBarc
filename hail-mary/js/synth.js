// Play a 5-note chord as simultaneous sine oscillators with a short envelope.
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  return sharedAudioCtx;
}

function playChord(frequencies, { duration = 0.9, peakGain = 0.18 } = {}) {
  const ctx = getAudioCtx();
  const t0 = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(peakGain, t0 + 0.06);
  master.gain.setValueAtTime(peakGain, t0 + duration - 0.1);
  master.gain.linearRampToValueAtTime(0, t0 + duration);
  master.connect(ctx.destination);

  for (const f of frequencies) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, t0);
    osc.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
}
