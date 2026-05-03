(function () {
  // ---------- Tabs ----------
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

  // ---------- Vocabulary grid + datalist ----------
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
      renderWord(document.getElementById("speak-output"), entry);
    });
    li.appendChild(b);
    vocabGrid.appendChild(li);
  }

  // ---------- Alphabet + markers chart ----------
  const letterGrid = document.getElementById("letter-grid");
  for (const entry of LETTER_ENTRIES) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "letter-btn";
    b.textContent = entry.letter.toUpperCase();
    b.title = entry.chord.map((f) => f.toFixed(0) + " Hz").join(", ");
    b.addEventListener("click", () => playChord(entry.chord, { duration: 0.4 }));
    li.appendChild(b);
    letterGrid.appendChild(li);
  }

  const markerGrid = document.getElementById("marker-grid");
  for (const [name, chord] of Object.entries(MARKER_CHORDS)) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "marker-btn";
    b.textContent = name;
    b.title = chord.map((f) => f.toFixed(0) + " Hz").join(", ");
    b.addEventListener("click", () => playChord(chord, { duration: 0.5 }));
    li.appendChild(b);
    markerGrid.appendChild(li);
  }

  // ---------- Speak side ----------
  const speakForm = document.getElementById("speak-form");
  const speakInput = document.getElementById("speak-input");
  const speakOutput = document.getElementById("speak-output");
  speakForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = speakInput.value.trim();
    if (!text) return;
    const result = speakEnglish(text);
    if (result.kind === "word") {
      renderWord(speakOutput, result.entry);
    } else if (result.kind === "spelled") {
      renderSpelled(speakOutput, result.text);
    }
  });

  function renderWord(target, entry) {
    target.innerHTML = "";
    const w = document.createElement("div");
    w.className = "word";
    w.textContent = entry.word;
    const c = document.createElement("div");
    c.className = "chord";
    c.textContent = entry.chord.map((f) => f.toFixed(1) + " Hz").join("   ");
    target.appendChild(w);
    target.appendChild(c);
  }

  function renderSpelled(target, text) {
    target.innerHTML = "";
    const w = document.createElement("div");
    w.className = "word";
    w.textContent = text;
    const note = document.createElement("div");
    note.className = "chord";
    note.textContent = `Not in curated vocabulary - spelled as: SPELL  ${text.toUpperCase().split("").join(" ")}  END`;
    target.appendChild(w);
    target.appendChild(note);
  }

  // ---------- Listen side ----------
  const toggle = document.getElementById("listen-toggle");
  const statusEl = document.getElementById("listen-status");
  const listenOutput = document.getElementById("listen-output");
  const spellBox = document.getElementById("spell-box");
  const canvas = document.getElementById("spectrum");
  const cctx = canvas.getContext("2d");

  function updateSpellBox(mode, buffer) {
    if (mode === "SPELLING") {
      spellBox.classList.add("active");
      spellBox.textContent = "Spelling: " + (buffer || "_");
    } else {
      spellBox.classList.remove("active");
      spellBox.textContent = "";
    }
  }

  function prependLogRow(labelHtml, detailText) {
    const row = document.createElement("div");
    row.innerHTML = labelHtml;
    if (detailText) {
      const d = document.createElement("div");
      d.className = "chord";
      d.textContent = detailText;
      row.appendChild(d);
    }
    listenOutput.prepend(row);
    while (listenOutput.children.length > 10) listenOutput.removeChild(listenOutput.lastChild);
  }

  const listener = new EridianListener({
    onWord(entry) {
      prependLogRow(
        `<span class="word">${entry.word}</span><span class="timestamp">${new Date().toLocaleTimeString()}</span>`,
        entry.chord.map((f) => f.toFixed(1) + " Hz").join("   ")
      );
    },
    onLetter(entry, bufferSoFar) {
      updateSpellBox("SPELLING", bufferSoFar);
    },
    onMarker(marker) {
      prependLogRow(
        `<span class="marker">[${marker.name}]</span><span class="timestamp">${new Date().toLocaleTimeString()}</span>`
      );
    },
    onSpellComplete(text) {
      prependLogRow(
        `<span class="word">${text}</span> <span class="spelled-tag">(spelled)</span><span class="timestamp">${new Date().toLocaleTimeString()}</span>`
      );
      updateSpellBox("IDLE", "");
    },
    onModeChange(mode) {
      if (mode === "SPELLING") updateSpellBox("SPELLING", "");
      else updateSpellBox("IDLE", "");
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
      updateSpellBox("IDLE", "");
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

  // ---------- Spectrum visualizer ----------
  const SPECTRUM_MAX_HZ = 6800;
  function drawSpectrum(bins, binHz) {
    const w = canvas.width;
    const h = canvas.height;
    cctx.fillStyle = "#060918";
    cctx.fillRect(0, 0, w, h);

    function freqToX(f) { return Math.round((f / SPECTRUM_MAX_HZ) * w); }

    // Band backgrounds.
    const bands = [
      { from: MARKER_FREQ_MIN, to: MARKER_FREQ_MAX, color: "rgba(255, 107, 138, 0.08)" },
      { from: WORD_FREQ_MIN, to: WORD_FREQ_MAX, color: "rgba(110, 231, 255, 0.06)" },
      { from: LETTER_FREQ_MIN, to: LETTER_FREQ_MAX, color: "rgba(255, 184, 107, 0.06)" },
    ];
    for (const b of bands) {
      cctx.fillStyle = b.color;
      const x0 = freqToX(b.from);
      const x1 = freqToX(b.to);
      cctx.fillRect(x0, 0, x1 - x0, h);
    }

    // Guide lines at every bank pitch.
    const guides = [
      { bank: MARKER_BANK, color: "rgba(255, 107, 138, 0.25)" },
      { bank: PITCH_BANK, color: "rgba(110, 231, 255, 0.22)" },
      { bank: LETTER_BANK, color: "rgba(255, 184, 107, 0.22)" },
    ];
    cctx.lineWidth = 1;
    for (const g of guides) {
      cctx.strokeStyle = g.color;
      for (const f of g.bank) {
        const x = freqToX(f);
        cctx.beginPath();
        cctx.moveTo(x, 0);
        cctx.lineTo(x, h);
        cctx.stroke();
      }
    }

    // FFT magnitude curve.
    const endBin = Math.min(bins.length, Math.floor(SPECTRUM_MAX_HZ / binHz));
    cctx.strokeStyle = "#e8ecf7";
    cctx.lineWidth = 1.2;
    cctx.beginPath();
    for (let i = 1; i < endBin; i++) {
      const freq = i * binHz;
      const x = freqToX(freq);
      const db = bins[i];
      const norm = Math.max(0, (db + 100) / 80);
      const y = h - norm * h;
      if (i === 1) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }
    cctx.stroke();
  }
})();
