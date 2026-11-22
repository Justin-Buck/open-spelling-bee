// Splits the master word data into puzzle pools for each game mode.
// Run from the project root:  node scripts/filter-puzzles.mjs
//
// Inputs:  src/words/en.json             (master list, never modified)
//          scripts/puzzle-picks.json     (your hand-picked puzzle mode words)
//          src/images/clues/             (picture clues, named after each pangram)
// Outputs: src/words/daily.json(.gz)     Mode 1 - daily puzzles
//          src/words/puzzles.json        Mode 2 - the launch puzzles, in unlock order
//          src/words/wager-pool.json(.gz) Mode 3 - every other pangram puzzle
//
// Holdout picks go into NO output file. They stay reserved in puzzle-picks.json
// until you move them into "launch" for a future update.

import fs from "node:fs";
import zlib from "node:zlib";

const GENIUS_PERCENT = 0.7;
const DAILY_MAX_GENIUS = 120; // daily puzzles must have Genius below this

// ---------------------------------------------------------------------------
// 1. Load the master data
// ---------------------------------------------------------------------------
const [allWords, letterSets, letterSetWordIndices] = JSON.parse(
  fs.readFileSync("src/words/en.json", "utf8")
);

// ---------------------------------------------------------------------------
// 2. Helpers (scoring matches game.mjs exactly)
// ---------------------------------------------------------------------------
function isPangram(word) {
  return new Set(word).size === 7;
}

function getWordScore(word) {
  const baseScore = word.length === 4 ? 1 : word.length;
  return isPangram(word) ? baseScore + 7 : baseScore;
}

// "abcDeit" -> "abcdeit": the 7 letters, ignoring which one is the center
function getGroupKey(letterSet) {
  return letterSet.toLowerCase().split("").sort().join("");
}

// ---------------------------------------------------------------------------
// 3. Score every letter set and group them by their 7 letters
// ---------------------------------------------------------------------------
const puzzles = []; // one entry per letter set, same order as letterSets
const groups = new Map(); // groupKey -> list of puzzles with those 7 letters

for (let i = 0; i < letterSets.length; i++) {
  const wordIndices = letterSetWordIndices[i];
  const words = wordIndices.map((index) => allWords[index]);

  let totalScore = 0;
  for (const word of words) {
    totalScore += getWordScore(word);
  }

  const puzzle = {
    letterSet: letterSets[i],
    wordIndices,
    words,
    geniusScore: Math.floor(GENIUS_PERCENT * totalScore),
    groupKey: getGroupKey(letterSets[i]),
  };
  puzzles.push(puzzle);

  if (!groups.has(puzzle.groupKey)) {
    groups.set(puzzle.groupKey, []);
  }
  groups.get(puzzle.groupKey).push(puzzle);
}

// ---------------------------------------------------------------------------
// 4. Find the pangram groups (Modes 2 & 3)
//    - exactly one pangram
//    - at least one center-letter version with Genius >= 120
//    Each group is kept ONCE, so a pangram can never repeat.
// ---------------------------------------------------------------------------
const pangramPool = [];
const pangramGroupKeys = new Set();

for (const [groupKey, versions] of groups) {
  // Every version of a group has the same pangrams,
  // so checking the first version is enough.
  const pangrams = versions[0].words.filter(isPangram);
  if (pangrams.length !== 1) continue;

  const restVersion = versions.find((v) => v.geniusScore >= DAILY_MAX_GENIUS);
  if (!restVersion) continue;

  pangramGroupKeys.add(groupKey);
  pangramPool.push({
    pangram: pangrams[0],
    letterSet: restVersion.letterSet, // uppercase letter = center letter
    words: restVersion.words,
  });
}

// Sort alphabetically so the output is the same every time you run it
pangramPool.sort((a, b) => a.pangram.localeCompare(b.pangram));

// ---------------------------------------------------------------------------
// 5. Daily puzzles (Mode 1)
//    - Genius below 120
//    - letters must not belong to any pangram group
// ---------------------------------------------------------------------------
const dailyLetterSets = [];
const dailyWordIndices = [];

for (const puzzle of puzzles) {
  if (
    puzzle.geniusScore < DAILY_MAX_GENIUS &&
    !pangramGroupKeys.has(puzzle.groupKey)
  ) {
    dailyLetterSets.push(puzzle.letterSet);
    dailyWordIndices.push(puzzle.wordIndices); // keep the pair together!
  }
}

// ---------------------------------------------------------------------------
// 6. Safety check: no pangram may appear in both daily and pangram modes
// ---------------------------------------------------------------------------
const poolPangrams = new Set(pangramPool.map((p) => p.pangram));
for (const indices of dailyWordIndices) {
  for (const index of indices) {
    if (poolPangrams.has(allWords[index])) {
      throw new Error(`Overlap found: "${allWords[index]}" is in both modes`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Split the pangram pool: puzzle mode picks vs. wager mode
// ---------------------------------------------------------------------------
const picks = JSON.parse(fs.readFileSync("scripts/puzzle-picks.json", "utf8"));
const poolByPangram = new Map(pangramPool.map((p) => [p.pangram, p]));

// Every pick must be in the pool, and no word may be picked twice
// Each launch pick is { word, difficulty, reward }; holdout picks are just words
const allPicks = [...picks.launch.map((pick) => pick.word), ...picks.holdout];
const seenPicks = new Set();
for (const word of allPicks) {
  if (!poolByPangram.has(word)) {
    throw new Error(`"${word}" in puzzle-picks.json is not in the pangram pool`);
  }
  if (seenPicks.has(word)) {
    throw new Error(`"${word}" is in puzzle-picks.json more than once`);
  }
  seenPicks.add(word);
}

// A picture clue for a puzzle is an image in src/images/clues/ named after
// its pangram, e.g. src/images/clues/telephone.png. Puzzles with no picture
// yet get clue: null, and the game says the clue is still being painted.
const CLUE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
function findClueImage(word) {
  for (const extension of CLUE_EXTENSIONS) {
    if (fs.existsSync(`src/images/clues/${word}.${extension}`)) {
      return `/images/clues/${word}.${extension}`;
    }
  }
  return null;
}

// Mode 2: launch puzzles in unlock order (1 = first)
const puzzleModePuzzles = picks.launch.map((pick, i) => {
  if (typeof pick.reward !== "number") {
    throw new Error(`"${pick.word}" in puzzle-picks.json needs a reward number`);
  }
  return {
    order: i + 1,
    difficulty: pick.difficulty,
    reward: pick.reward,
    clue: findClueImage(pick.word),
    ...poolByPangram.get(pick.word),
  };
});

// Mode 3: everything that wasn't picked (launch OR holdout)
const wagerPool = pangramPool.filter((p) => !seenPicks.has(p.pangram));

// ---------------------------------------------------------------------------
// 8. Write the output files
// ---------------------------------------------------------------------------
function writeJsonFiles(basePath, data) {
  const json = JSON.stringify(data);
  fs.writeFileSync(`${basePath}.json`, json);
  fs.writeFileSync(`${basePath}.json.gz`, zlib.gzipSync(json));
}

// Daily keeps the same format as en.json, so the service worker can read it as-is
writeJsonFiles("src/words/daily", [allWords, dailyLetterSets, dailyWordIndices]);
writeJsonFiles("src/words/wager-pool", wagerPool);

// Puzzle mode is small, so it's saved readable (pretty-printed), without a .gz
fs.writeFileSync(
  "src/words/puzzles.json",
  JSON.stringify(puzzleModePuzzles, null, 2) + "\n"
);

console.log(`Letter sets in master list: ${letterSets.length}`);
console.log(`Letter groups:              ${groups.size}`);
console.log(`Daily puzzles:              ${dailyLetterSets.length}`);
console.log(`Pangram pool puzzles:       ${pangramPool.length}`);
console.log(`  Puzzle mode (launch):     ${puzzleModePuzzles.length}`);
console.log(
  `    with a picture clue:    ${puzzleModePuzzles.filter((p) => p.clue).length}`
);
console.log(`  Held out for later:       ${picks.holdout.length}`);
console.log(`  Wager mode:               ${wagerPool.length}`);