// Pangramble: pay 5 Buzz bucks, pick how much time you want, then find the
// pangram before the clock runs out. Less time pays more.
//
// The round in progress is saved, so closing or reloading the app doesn't
// stop the clock or give the coins back: the deadline is a fixed time.

const ROUND_KEY = "buzz-pangramble-round";
const HISTORY_KEY = "buzz-pangramble-history";
// The old list of every pangram seen, from before losses could come back
const OLD_SEEN_KEY = "buzz-pangramble-seen";

const ENTRY_FEE = 5;

// A pangram you missed can come up again, but only after this many more
// rounds, so you don't get an easy win from an answer you just saw
const LOSS_COOLDOWN_ROUNDS = 100;

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

// Which pangrams you've played: { roundsPlayed, won: [pangram, ...],
// lostAtRound: { pangram: round number when you missed it } }
function loadHistory() {
  const history = loadJson(HISTORY_KEY, null) ?? {
    roundsPlayed: 0,
    won: [],
    lostAtRound: {},
  };
  localStorage.removeItem(OLD_SEEN_KEY);
  return history;
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Picks a pangram you can play now:
// - never one you've already found (until you've found them all)
// - not one you missed in the last LOSS_COOLDOWN_ROUNDS rounds
function pickPuzzle(pool, history) {
  const won = new Set(history.won);
  const isCoolingDown = (pangram) =>
    pangram in history.lostAtRound &&
    history.roundsPlayed - history.lostAtRound[pangram] < LOSS_COOLDOWN_ROUNDS;

  let choices = pool.filter((p) => !won.has(p.pangram) && !isCoolingDown(p.pangram));

  if (choices.length === 0) {
    const notWon = pool.filter((p) => !won.has(p.pangram));
    if (notWon.length === 0) {
      // You've found every pangram: start the whole pool over
      history.won = [];
      history.lostAtRound = {};
      choices = pool;
    } else {
      // Only recent misses are left: use the one you missed longest ago
      notWon.sort(
        (a, b) => history.lostAtRound[a.pangram] - history.lostAtRound[b.pangram]
      );
      choices = [notWon[0]];
    }
  }

  return choices[Math.floor(Math.random() * choices.length)];
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
    this.endIfTimeRanOut();
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.round = loadJson(ROUND_KEY, null);
        this.endIfTimeRanOut();
      }
    });
  },

  // A round whose clock ran out while the app was closed is a loss
  endIfTimeRanOut() {
    if (this.isPlaying && this.timeLeft() === 0) {
      this.lose();
    }
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

  // Pays the entry fee, picks a puzzle you can play, and starts the clock.
  // Returns false if you can't afford it.
  async start(seconds) {
    const option = this.timeOptions.find((o) => o.seconds === seconds);
    const buzz = Alpine.store("buzz");
    if (!option || this.isPlaying || this.isStarting) return false;
    if (!buzz.canAfford(ENTRY_FEE)) return false;

    this.isStarting = true;
    try {
      const pool = await loadWagerPool();

      const history = loadHistory();
      const puzzle = pickPuzzle(pool, history);
      history.roundsPlayed++;
      saveHistory(history);

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

    // Found it: this pangram won't come up again
    const history = loadHistory();
    history.won = [...history.won, this.round.pangram];
    delete history.lostAtRound[this.round.pangram];
    saveHistory(history);

    Alpine.store("buzz").earn(this.round.payout, `pangramble-${this.round.id}`);
    window.dispatchEvent(new CustomEvent("pangramble-ended"));
  },

  // Time ran out: the entry fee is already gone
  lose() {
    if (!this.isPlaying) return;
    this.round = { ...this.round, result: "lost" };
    this.save();

    // Missed it: it can come back after LOSS_COOLDOWN_ROUNDS more rounds
    const history = loadHistory();
    history.lostAtRound[this.round.pangram] = history.roundsPlayed;
    saveHistory(history);

    window.dispatchEvent(new CustomEvent("pangramble-ended"));
  },
});
