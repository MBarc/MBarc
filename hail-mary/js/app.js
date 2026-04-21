(function () {
  const tabButtons = document.querySelectorAll(".tabs button");
  const panels = {
    speak: document.getElementById("tab-speak"),
    listen: document.getElementById("tab-listen"),
    vocab: document.getElementById("tab-vocab"),
  };
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.tab;
      tabButtons.forEach((b) => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
      Object.entries(panels).forEach(([k, el]) => el.classList.toggle("active", k === name));
    });
  });

  const datalist = document.getElementById("vocab-list");
  const vocabGrid = document.getElementById("vocab-grid");
  for (const entry of VOCAB_ENTRIES) {
    const opt = document.createElement("option");
    opt.value = entry.word;
    datalist.appendChild(opt);

    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = entry.word;
    b.addEventListener("click", () => {
      playChord(entry.chord);
      renderMatch(document.getElementById("speak-output"), entry);
    });
    li.appendChild(b);
    vocabGrid.appendChild(li);
  }

  const speakForm = document.getElementById("speak-form");
  const speakInput = document.getElementById("speak-input");
  const speakOutput = document.getElementById("speak-output");
  speakForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const word = speakInput.value.trim();
    if (!word) return;
    const known = VOCAB_ENTRIES.find((v) => v.word.toLowerCase() === word.toLowerCase());
    const entry = known || { word, chord: chordForWord(word), indices: chordIndicesForWord(word) };
    playChord(entry.chord);
    renderMatch(speakOutput, entry, !known);
  });

  function renderMatch(target, entry, improvised = false) {
    target.innerHTML = "";
    const w = document.createElement("div");
    w.className = "word";
    w.textContent = entry.word + (improvised ? "  (improvised)" : "");
    const c = document.createElement("div");
    c.className = "chord";
    c.textContent = entry.chord.map((f) => f.toFixed(1) + " Hz").join("   ");
    target.appendChild(w);
    target.appendChild(c);
  }

  const toggle = document.getElementById("listen-toggle");
  const statusEl = document.getElementById("listen-status");
  const listenOutput = document.getElementById("listen-output");
  const canvas = document.getElementById("spectrum");
  const cctx = canvas.getContext("2d");

  const listener = new EridianListener({
    onMatch(entry) {
      const row = document.createElement("div");
      row.innerHTML = `<span class="word">${entry.word}</span><span class="timestamp">${new Date().toLocaleTimeString()}</span>`;
      const chord = document.createElement("div");
      chord.className = "chord";
      chord.textContent = entry.chord.map((f) => f.toFixed(1) + " Hz").join("   ");
      row.appendChild(chord);
      listenOutput.prepend(row);
      while (listenOutput.children.length > 8) listenOutput.removeChild(listenOutput.lastChild);
    },
    onLevels({ bins, binHz }) {
      drawSpectrum(bins, binHz);
    },
    onError(err) {
      statusEl.textContent = "Microphone error: " + (err.message || err.name || err);
      statusEl.classList.remove("active");
      statusEl.classList.add("error");
      toggle.textContent = "Start listening";
    },
  });

  toggle.addEventListener("click", async () => {
    if (listener.running) {
      listener.stop();
      toggle.textContent = "Start listening";
      statusEl.textContent = "Idle";
      statusEl.classList.remove("active", "error");
      return;
    }
    statusEl.textContent = "Requesting microphone...";
    statusEl.classList.remove("error");
    await listener.start();
    if (listener.running) {
      toggle.textContent = "Stop listening";
      statusEl.textContent = "Listening...";
      statusEl.classList.add("active");
    }
  });

  function drawSpectrum(bins, binHz) {
    const w = canvas.width;
    const h = canvas.height;
    cctx.fillStyle = "#060918";
    cctx.fillRect(0, 0, w, h);

    // Highlight pitch-bank frequencies as vertical guide lines.
    cctx.strokeStyle = "rgba(110, 231, 255, 0.18)";
    cctx.lineWidth = 1;
    for (const f of PITCH_BANK) {
      const x = Math.round((f / (MAX_FREQ_HZ + 200)) * w);
      cctx.beginPath();
      cctx.moveTo(x, 0);
      cctx.lineTo(x, h);
      cctx.stroke();
    }

    // Plot dB magnitude up to MAX_FREQ_HZ + a little headroom.
    const endFreq = MAX_FREQ_HZ + 200;
    const endBin = Math.min(bins.length, Math.floor(endFreq / binHz));
    cctx.strokeStyle = "#ffb86b";
    cctx.lineWidth = 1.4;
    cctx.beginPath();
    for (let i = 0; i < endBin; i++) {
      const x = (i / endBin) * w;
      const db = bins[i];
      const norm = Math.max(0, (db + 100) / 80); // -100..-20 dB -> 0..1
      const y = h - norm * h;
      if (i === 0) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }
    cctx.stroke();
  }
})();
