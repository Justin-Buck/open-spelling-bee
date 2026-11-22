const GENIUS_PERCENT_THRESHOLD = 0.7;
const GENIUS_COIN_REWARD = 25;

/**
 * @param {string} timestamp
 * @returns {string}
 */
const getLocalStorageKey = (timestamp) => `${timestamp}-v2`;

// The puzzle play page is /puzzles/play/?n=3. On any other page,
// the game plays the daily puzzle (or Pangramble's round, below).
const getPuzzleNumberFromPage = () =>
  location.pathname.startsWith("/puzzles/play")
    ? Number(new URLSearchParams(location.search).get("n"))
    : null;

const isPangramblePage = () => location.pathname.startsWith("/pangramble/play");

// Turns a letter set like "ehLnopt" (capital = center letter) into letters
const splitLetterSet = (letterSet) => {
  const centerLetter = [...letterSet]
    .find((letter) => letter !== letter.toLowerCase())
    .toLowerCase();
  const outerLetters = [...letterSet.toLowerCase()].filter(
    (letter) => letter !== centerLetter
  );
  return { centerLetter, outerLetters };
};

Alpine.store("game", {
  // "daily", "puzzle" on the puzzle play page, or "pangramble"
  mode: "daily",
  // In puzzle mode: { order, difficulty, reward, clue, pangram, letterSet, words }
  puzzle: null,
  // In puzzle mode: whether its pangram has been found, and the coins it paid
  isPuzzleSolved: false,
  puzzleCoinsEarned: 0,
  timestamp: null,
  centerLetter: "",
  outerLetters: new Array(6).fill(""),
  validWordSet: new Set(),
  // Shared Set used for calculating word scores to avoid
  // re-creating one every time we need to calculate a word score
  uniqueCharSet: new Set(),
  guessedWordSet: new Set(),
  guessedWords: [],
  clearGuessedWords() {
    this.guessedWordSet.clear();
    this.guessedWords = [];
  },
  addGuessedWord(word) {
    this.guessedWordSet.add(word);
    this.guessedWords.push(word);
  },
  previousGame: null,
  totalPossibleScore: 0,
  currentScore: 0,
  invalidWordRegex: null,
  validWordRegex: null,
  notifications: [],
  currentRank: null,
  nextRank: null,
  isGenius: false,
  isMaster: false,
  geniusScoreThreshold: 0,
  ranks: [
    {
      percent: 0,
      name: "Beginner",
    },
    {
      percent: 0.02,
      name: "Good start",
    },
    {
      percent: 0.05,
      name: "Moving up",
    },
    {
      percent: 0.08,
      name: "Good",
    },
    {
      percent: 0.15,
      name: "Solid",
    },
    {
      percent: 0.25,
      name: "Nice",
    },
    {
      percent: 0.4,
      name: "Great",
    },
    {
      percent: 0.5,
      name: "Amazing",
    },
    {
      percent: GENIUS_PERCENT_THRESHOLD,
      name: "Genius",
    },
    {
      percent: 1,
      name: "Master",
    },
  ],
  isWordPanagramCache: {},
  getIsWordPanagram(word) {
    if (this.isWordPanagramCache.hasOwnProperty(word)) {
      return this.isWordPanagramCache[word];
    }

    const wordLength = word.length;
    if (wordLength < 7) {
      return false;
    }

    this.uniqueCharSet.clear();

    for (let i = 0; i < wordLength; ++i) {
      this.uniqueCharSet.add(word[i]);
    }

    this.isWordPanagramCache[word] = this.uniqueCharSet.size === 7;

    return this.isWordPanagramCache[word];
  },
  getWordScore(word) {
    const wordLength = word.length;
    // 4-letter words are worth 1 point, but all longer words are worth their length (ie, 5-letter words are worth 5 points)
    const wordLengthScore = wordLength > 4 ? wordLength : 1;

    if (word.length < 7) {
      // If the word is less than 7 characters long, it can't be a panagram
      // so we won't bother to check
      return wordLengthScore;
    }

    return wordLengthScore + this.getIsWordPanagram(word) * 7;
  },
  async syncWithLocalStorage() {
    try {
      const guessedWordsString = localStorage.getItem(
        getLocalStorageKey(this.timestamp)
      );

      if (guessedWordsString) {
        /**
         * @type {string[]}
         */
        const guessedWords = guessedWordsString
          ? JSON.parse(guessedWordsString)
          : [];

        // Sanitize the user's persisted list of guessed words to ensure there aren't duplicate words
        this.clearGuessedWords();
        let currentScore = 0;
        for (const word of guessedWords) {
          this.addGuessedWord(word);
          // Calculate the user's current score based on their initial persisted list of guessed words
          currentScore += this.getWordScore(word);
        }
        this.updateScore(currentScore);
        this.updateLocalStorage();
      } else {
        await this.getNewLetterSet();
      }
    } catch (e) {
      console.error("Error retrieving existing data for today's game", e);
      // If something goes wrong while attempting to hydrate the data,
      // something may have been tampered with so we'll just bail out and get a new
      // letter set.
      await this.getNewLetterSet(this.timestamp);
    }
  },
  async updateLocalStorage() {
    if (!this._hasRequestedPersistence) {
      this._hasRequestedPersistence = true;

      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          // Ask for persistent storage so it won't be lost when the browser is closed
          await navigator.storage.persist();
        }
      }
    }

    queueMicrotask(() => {
      localStorage.setItem(
        getLocalStorageKey(this.timestamp),
        JSON.stringify(this.guessedWords)
      );
    });
  },
  cleanUpLocalStorage() {
    const todayLocalStorageKey = getLocalStorageKey(this.timestamp);
    const yesterdayLocalStorageKey = this.previousGame
      ? getLocalStorageKey(this.previousGame.timestamp)
      : null;

    for (let i = localStorage.length; i >= 0; --i) {
      const key = localStorage.key(i);
      if (
        // Only daily games are cleaned up. Their keys look like "20261021-v2".
        // Everything else (Buzz's wallet, puzzle progress) is left alone.
        /^\d+-v2$/.test(key) &&
        // Remove daily games that aren't for today or yesterday
        key !== todayLocalStorageKey &&
        key !== yesterdayLocalStorageKey
      ) {
        localStorage.removeItem(key);
      }
    }
  },
  updateLetterSet(centerLetter, outerLetters) {
    this.centerLetter = centerLetter;
    this.outerLetters = outerLetters;

    const letterSetString = `${this.centerLetter}${this.outerLetters.join("")}`;
    this.invalidWordRegex = new RegExp(`[^${letterSetString}]`, "g");
    this.validWordRegex = new RegExp(
      `^[${letterSetString}]*${this.centerLetter}+[${letterSetString}]*$`
    );
  },
  updateValidWords(newValidWords) {
    this.validWordSet.clear();
    let totalPossibleScore = 0;
    for (const word of newValidWords) {
      this.validWordSet.add(word);
      totalPossibleScore += this.getWordScore(word);
    }
    this.totalPossibleScore = totalPossibleScore;
    this.geniusScoreThreshold = Math.floor(
      GENIUS_PERCENT_THRESHOLD * this.totalPossibleScore
    );
  },
  async getPreviousGame() {
    /**
     * @type {{
     *  ts: number,
     *  centerLetter: string,
     *  outerLetters: string[],
     *  validWords: string[]
     * }}
     */
    const { ts, centerLetter, outerLetters, validWords } = await fetch(
      "/words/en?d=yesterday"
    ).then((res) => res.json());

    const yesterdayGuessedWordsString = localStorage.getItem(
      getLocalStorageKey(ts)
    );

    /**
     * @type {string[]}
     */
    const yesterdayGuessedWords = yesterdayGuessedWordsString
      ? JSON.parse(yesterdayGuessedWordsString)
      : [];

    let score = 0;
    let totalPossibleScore = 0;

    const normalWords = [];
    const panagrams = [];

    const prevGuessedWordSet = new Set(yesterdayGuessedWords);

    for (const word of validWords) {
      const wordScore = this.getWordScore(word);
      const isPanagram = wordScore > word.length;
      const guessed = prevGuessedWordSet.has(word);

      totalPossibleScore += wordScore;
      if (guessed) {
        score += wordScore;
      }
      const wordEntry = { word, guessed, isPanagram };
      if (isPanagram) {
        panagrams.push(wordEntry);
      } else {
        normalWords.push(wordEntry);
      }
    }

    const achievedRankPercent = score / totalPossibleScore;

    let achievedRankName = this.ranks[0].name;

    for (let i = this.ranks.length - 1; i >= 0; --i) {
      const rank = this.ranks[i];
      if (achievedRankPercent >= rank.percent || i === 0) {
        achievedRankName = rank.name;
        break;
      }
    }

    this.previousGame = {
      timestamp: ts,
      centerLetter,
      outerLetters,
      words: panagrams.concat(normalWords),
      score,
      achievedRankName,
      guessedWordCount: prevGuessedWordSet.size,
    };
  },
  // Loads puzzle number `order` from puzzles.json, in the same shape as the
  // daily puzzle. Sends you back to the puzzle list if it's locked or missing.
  async loadPuzzle(order) {
    const puzzles = await fetch("/words/puzzles.json").then((res) =>
      res.json()
    );
    const puzzle = puzzles.find((p) => p.order === order);

    if (!puzzle || !Alpine.store("puzzleProgress").isUnlocked(order)) {
      location.replace("/puzzles/");
      return null;
    }

    this.mode = "puzzle";
    this.puzzle = puzzle;
    this.isPuzzleSolved = Alpine.store("puzzleProgress").isSolved(order);

    const { centerLetter, outerLetters } = splitLetterSet(puzzle.letterSet);

    return {
      // Saved guesses go under "puzzle-3-v2", apart from daily games
      ts: `puzzle-${order}`,
      centerLetter,
      outerLetters,
      validWords: puzzle.words,
    };
  },
  // Loads Pangramble's current round. With no round, goes back to
  // the Pangramble page to start one.
  loadPangrambleRound() {
    const round = Alpine.store("pangramble").round;
    if (!round) {
      location.replace("/pangramble/");
      return null;
    }

    this.mode = "pangramble";
    const { centerLetter, outerLetters } = splitLetterSet(round.letterSet);

    return {
      ts: `pangramble-${round.id}`,
      centerLetter,
      outerLetters,
      validWords: round.words,
    };
  },
  async init() {
    // Alpine runs this as soon as the game store is created, which can be
    // before the other stores (pangramble, puzzleProgress) exist. Waiting
    // one tick lets them all get created first.
    await Promise.resolve();

    const puzzleNumber = getPuzzleNumberFromPage();
    let gameData;
    if (puzzleNumber) {
      gameData = await this.loadPuzzle(puzzleNumber);
    } else if (isPangramblePage()) {
      gameData = this.loadPangrambleRound();
    } else {
      gameData = await fetch("/words/en").then((res) => res.json());
    }

    // A locked puzzle or a missing round is on its way to another page
    if (!gameData) return;

    const { ts, centerLetter, outerLetters, validWords } = gameData;

    this.timestamp = ts;

    this.updateLetterSet(centerLetter, outerLetters);
    this.updateValidWords(validWords);
    // Shuffle the letters once up front
    this.shuffleOuterLetters();

    this.syncWithLocalStorage();
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.syncWithLocalStorage();
      }
    });

    // Yesterday's answers and old-game cleanup are only for the daily game
    if (this.mode === "daily") {
      await this.getPreviousGame();
      this.cleanUpLocalStorage();
    }
  },
  validateWord(word) {
    if (word.length < 4) {
      return {
        isValid: false,
        reason: "Words must be at least 4 letters long.",
      };
    }

    if (this.invalidWordRegex.test(word)) {
      return {
        isValid: false,
        reason: "Words can only contain the center letter and outer letters.",
      };
    }

    if (!this.validWordRegex.test(word)) {
      return {
        isValid: false,
        reason: "Words must include the center letter.",
      };
    }

    if (!this.validWordSet.has(word)) {
      return {
        isValid: false,
        reason: "Not a valid word.",
      };
    }

    if (this.guessedWordSet.has(word)) {
      return {
        isValid: false,
        reason: "You've already guessed that word.",
      };
    }

    const score = this.getWordScore(word);
    const isPanagram = score > word.length;

    return {
      isValid: true,
      score,
      isPanagram,
    };
  },
  showNotification(notificationConfig) {
    const id = Math.random().toString(36);
    const aliveTime = 1500 + notificationConfig.message.length * 50;

    this.notifications.push({
      id,
      aliveTime,
      show: false,
      ...notificationConfig,
    });

    setTimeout(() => {
      this.notifications = this.notifications.filter((n) => n.id !== id);
    }, aliveTime);
  },
  updateScore(newScore) {
    this.currentScore = newScore;

    const totalPossibleScore = this.totalPossibleScore;
    const ranks = this.ranks;

    if (!totalPossibleScore) return;

    this.isGenius = newScore >= this.geniusScoreThreshold;
    this.isMaster = newScore === totalPossibleScore;

    // Only the daily game pays for Genius. Puzzles pay for the pangram.
    if (this.isGenius && this.mode === "daily") {
      this.payGeniusReward();
    }

    for (let i = ranks.length - 1; i >= 0; --i) {
      const rank = ranks[i];
      if (
        newScore >= Math.floor(rank.percent * totalPossibleScore) ||
        i === 0
      ) {
        this.currentRank = rank;
        this.nextRank = ranks[i + 1];
        break;
      }
    }
  },
  // Reaching Genius pays Buzz bucks, once per daily puzzle
  payGeniusReward() {
    if (!this.timestamp) return;
    const wasPaid = Alpine.store("buzz").earn(
      GENIUS_COIN_REWARD,
      `genius-${this.timestamp}`
    );
    if (wasPaid) {
      this.showNotification({
        class: "valid-guess gradient-bg",
        message: `Genius! +${GENIUS_COIN_REWARD} Buzz bucks`,
        ariaLabel: `You reached Genius and earned ${GENIUS_COIN_REWARD} Buzz bucks.`,
      });
    }
  },
  submitGuess(guessWord) {
    if (!guessWord) return;

    const sanitizedWord = guessWord.toLowerCase();

    // In Pangramble, guesses only count while the clock is running
    if (this.mode === "pangramble") {
      const pangramble = Alpine.store("pangramble");
      if (pangramble.isPlaying && pangramble.timeLeft() === 0) {
        pangramble.lose();
      }
      if (!pangramble.isPlaying) return;
    }

    const { isValid, reason, score, isPanagram } =
      this.validateWord(sanitizedWord);

    if (isValid) {
      this.addGuessedWord(sanitizedWord);
      this.updateLocalStorage();

      this.updateScore(this.currentScore + score);

      if (isPanagram && this.mode === "puzzle") {
        // Each puzzle has exactly one pangram, so finding it solves the puzzle
        this.solvePuzzle();
      } else if (isPanagram && this.mode === "pangramble") {
        // Found the round's one pangram in time
        Alpine.store("pangramble").win();
      } else if (isPanagram) {
        window.fireConfetti("panagram-confetti");

        this.showNotification({
          class: "valid-guess gradient-bg panagram",
          message: `Panagram! +${score}`,
          ariaLabel: `${sanitizedWord} is a panagram. Good job! +${score} points.`,
        });
      } else {
        this.showNotification({
          class: "valid-guess gradient-bg",
          message: `+${score}`,
          ariaLabel: `Correct! +${score} points.`,
        });
      }
    } else {
      this.showNotification({
        class: "invalid-guess",
        message: reason,
        ariaLabel: reason,
      });
    }
  },
  // Marks the puzzle solved, pays its coins (first solve only),
  // and opens the "Puzzle solved" pop-up
  solvePuzzle() {
    const { order, reward } = this.puzzle;
    const wasPaid = Alpine.store("buzz").earn(reward, `puzzle-${order}`);

    Alpine.store("puzzleProgress").markSolved(order);
    this.puzzleCoinsEarned = wasPaid ? reward : 0;
    this.isPuzzleSolved = true;

    window.dispatchEvent(new CustomEvent("puzzle-solved"));
  },
  shuffleOuterLetters() {
    for (let i = this.outerLetters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.outerLetters[i], this.outerLetters[j]] = [
        this.outerLetters[j],
        this.outerLetters[i],
      ];
    }
  },
  async getNewLetterSet() {
    this.clearGuessedWords();
    this.updateScore(0);

    this.updateLocalStorage();
  },
});
