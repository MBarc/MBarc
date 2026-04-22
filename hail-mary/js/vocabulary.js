// ---------- Word bank ----------
// 16 pitches in ~440 Hz .. ~1975 Hz, five simultaneous pitches = one "word" chord.
const PITCH_BANK = (() => {
  const base = 440;
  const semitones = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26];
  return semitones.map((s) => +(base * Math.pow(2, s / 12)).toFixed(2));
})();

// ---------- Letter bank ----------
// 12 pitches in ~2093 Hz .. ~5274 Hz (above the word bank so the listener
// can tell a spelled letter from a full word chord by spectral range).
// Three simultaneous pitches = one letter.
const LETTER_BANK = (() => {
  const base = 2093.0;
  const semitones = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19];
  return semitones.map((s) => +(base * Math.pow(2, s / 12)).toFixed(2));
})();

// ---------- Marker bank ----------
// Six low pitches. Each marker = a distinct pair of tones, placed below the
// word bank so spell/question/negate/past/plural markers never collide with
// word or letter chords.
const MARKER_BANK = (() => {
  const base = 261.63;
  const semitones = [0, 2, 4, 5, 7, 9];
  return semitones.map((s) => +(base * Math.pow(2, s / 12)).toFixed(2));
})();

const MARKERS = {
  SPELL:    [0, 3],
  END:      [0, 5],
  QUESTION: [1, 4],
  NEGATE:   [2, 5],
  PAST:     [0, 2],
  PLURAL:   [3, 5],
};
const MARKER_CHORDS = Object.fromEntries(
  Object.entries(MARKERS).map(([name, idx]) => [name, idx.map((i) => MARKER_BANK[i])])
);

// ---------- Hashing helpers ----------
function hashWord(word) {
  let h = 2166136261 >>> 0;
  const s = word.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndices(seedKey, bankSize, pickCount) {
  const rng = mulberry32(hashWord(seedKey));
  const pool = Array.from({ length: bankSize }, (_, i) => i);
  for (let i = 0; i < pickCount; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, pickCount).sort((a, b) => a - b);
}

// ---------- Word chords ----------
function chordIndicesForWord(word, salt = 0) {
  const key = salt === 0 ? word : `${word}#${salt}`;
  return pickIndices(key, PITCH_BANK.length, 5);
}
function chordForWord(word) {
  return chordIndicesForWord(word).map((i) => PITCH_BANK[i]);
}

// ---------- Letter chords ----------
function letterChordIndices(ch, salt = 0) {
  const key = `letter:${ch.toLowerCase()}${salt ? "#" + salt : ""}`;
  return pickIndices(key, LETTER_BANK.length, 3);
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const LETTER_ENTRIES = (() => {
  const used = new Set();
  const out = [];
  for (const ch of ALPHABET) {
    let salt = 0;
    let indices;
    while (true) {
      indices = letterChordIndices(ch, salt);
      const key = indices.join(",");
      if (!used.has(key)) { used.add(key); break; }
      salt++;
      if (salt > 10000) throw new Error("Cannot place letter: " + ch);
    }
    out.push({
      letter: ch,
      indices,
      chord: indices.map((i) => LETTER_BANK[i]),
    });
  }
  return out;
})();
const LETTER_BY_CHAR = new Map(LETTER_ENTRIES.map((e) => [e.letter, e]));

function chordForLetter(ch) {
  const entry = LETTER_BY_CHAR.get(ch.toLowerCase());
  return entry ? entry.chord : null;
}

// ---------- Curated vocabulary (~200 words) ----------
// Book-specific terms, common English, and STEM words Grace and Rocky
// negotiate in Project Hail Mary. Anything outside this list falls through
// to spelling mode.
const VOCABULARY = [
  // Project Hail Mary proper nouns and book-specific terms
  "Grace", "Rocky", "Eridian", "Erid", "human", "Earth", "ship", "HailMary",
  "Stratt", "astrophage", "taumoeba", "xenonite", "beetle", "Tau",
  "sun", "star", "system", "planet", "moon", "space", "home",

  // Social / communication
  "yes", "no", "question", "answer", "hello", "goodbye", "please", "thanks",
  "friend", "enemy", "help", "name", "word", "language", "understand",
  "confused", "again", "amaze", "idea", "think", "know", "believe",

  // Pronouns / determiners
  "me", "you", "us", "them", "he", "she", "it", "this", "that",
  "here", "there", "who", "what", "why", "how", "where", "when",
  "and", "or", "not", "with", "without", "before", "after",

  // Common verbs
  "go", "come", "see", "hear", "speak", "say", "make", "do", "work", "rest",
  "sleep", "eat", "drink", "live", "die", "give", "take", "find", "lose",
  "try", "wait", "stop", "start", "build", "break", "fix", "learn", "teach",
  "want", "need", "use", "have", "be", "become", "move", "stay", "open", "close",

  // Adjectives
  "good", "bad", "big", "small", "fast", "slow", "hot", "cold", "warm", "cool",
  "strong", "weak", "new", "old", "young", "safe", "dangerous", "hard", "soft",
  "full", "empty", "true", "false", "same", "different", "ready", "broken",

  // Nouns
  "food", "water", "air", "fire", "ice", "metal", "stone", "wood", "sand",
  "body", "hand", "eye", "head", "heart", "life", "death",
  "day", "night", "year", "hour", "minute", "second",
  "tool", "machine", "engine", "light", "sound", "heat", "pressure",
  "place", "way", "road", "door", "room", "world",

  // Numbers
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "hundred", "thousand", "million", "billion",

  // STEM
  "science", "gravity", "mass", "speed", "distance", "temperature", "energy",
  "power", "motion", "atom", "element", "liquid", "gas", "solid", "radiation",
  "oxygen", "hydrogen", "carbon", "nitrogen", "chemical", "biology", "physics",
  "math", "measure", "equal", "more", "less",

  // Time / direction
  "now", "later", "soon", "forever", "time",
  "up", "down", "in", "out", "near", "far", "left", "right",
];

const VOCAB_SALTS = new Map();

const VOCAB_ENTRIES = (() => {
  const used = new Set();
  const entries = [];
  for (const word of VOCABULARY) {
    let salt = 0;
    let indices;
    while (true) {
      indices = chordIndicesForWord(word, salt);
      const key = indices.join(",");
      if (!used.has(key)) {
        used.add(key);
        VOCAB_SALTS.set(word.toLowerCase(), salt);
        break;
      }
      salt++;
      if (salt > 10000) throw new Error("Cannot place word in pitch space: " + word);
    }
    entries.push({
      word,
      indices,
      chord: indices.map((i) => PITCH_BANK[i]),
    });
  }
  return entries;
})();
const VOCAB_BY_WORD = new Map(VOCAB_ENTRIES.map((e) => [e.word.toLowerCase(), e]));
