// A bank of 16 distinct pitches spanning ~440 Hz .. ~1864 Hz.
// Eridians perceive tones as overlapping chords; five simultaneous pitches
// from this bank form one "word" in the translator's shared language.
const PITCH_BANK = (() => {
  const base = 440;
  const semitones = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26];
  return semitones.map((s) => +(base * Math.pow(2, s / 12)).toFixed(2));
})();

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

// Deterministic: same word always picks the same 5 pitch-bank indices,
// optionally with a salt suffix (used by the vocabulary build below to
// resolve collisions while keeping every word's chord reproducible).
function chordIndicesForWord(word, salt = 0) {
  const key = salt === 0 ? word : `${word}#${salt}`;
  const rng = mulberry32(hashWord(key));
  const pool = PITCH_BANK.map((_, i) => i);
  for (let i = 0; i < 5; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 5).sort((a, b) => a - b);
}

function chordForWord(word) {
  return chordIndicesForWord(word).map((i) => PITCH_BANK[i]);
}

// The vocabulary build stores (word -> salt) so improvised runtime words
// reuse the same salt-0 mapping the listener also uses for unknown input.
const VOCAB_SALTS = new Map();

// Curated set of words from the book's shared lexicon between Grace and Rocky.
const VOCABULARY = [
  "yes", "no", "question", "answer",
  "good", "bad", "friend", "enemy",
  "me", "you", "human", "Eridian",
  "Grace", "Rocky", "ship", "Earth", "Erid",
  "food", "sleep", "work", "science",
  "fast", "slow", "now", "later", "time",
  "small", "big", "hot", "cold",
  "amaze", "understand", "hello", "goodbye",
];

// Build VOCAB_ENTRIES with collision-free salting.
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
