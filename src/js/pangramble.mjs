// Pangramble: pay 5 Buzz bucks, pick how much time you want, then find the
// pangram before the clock runs out. Less time pays more.
//
// The round in progress is saved, so closing or reloading the app doesn't
// stop the clock or give the coins back: the deadline is a fixed time.

const ROUND_KEY = "buzz-pangramble-round";
const SEEN_KEY = "buzz-pangramble-seen";

const ENTRY_FEE = 5;

// Each choice: seconds on the clock, and what a win pays back
const TIME_OPTIONS = [
  { seconds: 60, multiplier: 2 },
  { seconds: 40, multiplier: 3 },
  { seconds: 20, multiplier: 4 },
];

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

// Reads the gzipped wager pool: [{ pangram, letterSet, words }, ...]
async function loadWagerPool() {
  const response = await fetch("/words/wager-pool.json.gz");
  const unzipped = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(unzipped).json();
}

Alpine.store("pangramble", {
  entryFee: ENTRY_FEE,
  timeOptions: TIME_OPTIONS.map((option) => ({
    ...option,
    payout: ENTRY_FEE * option.multiplier,
  })),
  // The saved round: { id, pangram, letterSet, words, seconds, payout,
  // deadline, result: "playing" | "won" | "lost" } or null
  round: loadJson(ROUND_KEY, null),
  isStarting: false,

  init() {
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.round = loadJson(ROUND_KEY, null);
      }
    });
  },

  save() {
    localStorage.setItem(ROUND_KEY, JSON.stringify(this.round));
  },

  get isPlaying() {
    return this.round?.result === "playing";
  },

  // Milliseconds left on the clock (0 once time is up)
  timeLeft() {
    if (!this.isPlaying) return 0;
    return Math.max(0, this.round.deadline - Date.now());
  },

  // Pays the entry fee, picks a puzzle you haven't seen, and starts the clock.
  // Returns false if you can't afford it.
  async start(seconds) {
    const option = this.timeOptions.find((o) => o.seconds === seconds);
    const buzz = Alpine.store("buzz");
    if (!option || this.isPlaying || this.isStarting) return false;
    if (!buzz.canAfford(ENTRY_FEE)) return false;

    this.isStarting = true;
    try {
      const pool = await loadWagerPool();

      // Pick a puzzle you haven't played. Once you've seen them all, start over.
      let seen = new Set(loadJson(SEEN_KEY, []));
      let unseen = pool.filter((p) => !seen.has(p.pangram));
      if (unseen.length === 0) {
        seen = new Set();
        unseen = pool;
      }
      const puzzle = unseen[Math.floor(Math.random() * unseen.length)];
      seen.add(puzzle.pangram);
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));

      // The fee is taken now, so leaving mid-round counts as a loss
      buzz.spend(ENTRY_FEE);

      // Forget the guesses saved for earlier rounds ("pangramble-<id>-v2")
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith("pangramble-") && key.endsWith("-v2")) {
          localStorage.removeItem(key);
        }
      }

      const startedAt = Date.now();
      this.round = {
        id: startedAt,
        pangram: puzzle.pangram,
        letterSet: puzzle.letterSet,
        words: puzzle.words,
        seconds: option.seconds,
        payout: option.payout,
        deadline: startedAt + option.seconds * 1000,
        result: "playing",
      };
      this.save();
      return true;
    } finally {
      this.isStarting = false;
    }
  },

  // Found the pangram in time: pay out
  win() {
    if (!this.isPlaying) return;
    if (this.timeLeft() === 0) {
      this.lose();
      return;
    }
    this.round = { ...this.round, result: "won" };
    this.save();
    Alpine.store("buzz").earn(this.round.payout, `pangramble-${this.round.id}`);
    window.dispatchEvent(new CustomEvent("pangramble-ended"));
  },

  // Time ran out: the entry fee is already gone
  lose() {
    if (!this.isPlaying) return;
    this.round = { ...this.round, result: "lost" };
    this.save();
    window.dispatchEvent(new CustomEvent("pangramble-ended"));
  },
});
