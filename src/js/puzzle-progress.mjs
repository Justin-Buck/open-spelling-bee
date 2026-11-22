// Your progress through Puzzles mode: which puzzles you've solved, and on
// which ones you peeked at the picture clue. Any page can read it with
// $store.puzzleProgress.
//
// Puzzles unlock in order: puzzle 1 is always open, and each puzzle after
// that opens once the one before it is solved.

const PROGRESS_KEY = "buzz-puzzle-progress";

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    return { solved: [], usedClue: [], ...saved };
  } catch (e) {
    return { solved: [], usedClue: [] };
  }
}

Alpine.store("puzzleProgress", {
  ...loadProgress(),

  init() {
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        Object.assign(this, loadProgress());
      }
    });
  },

  save() {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ solved: this.solved, usedClue: this.usedClue })
    );
  },

  isSolved(order) {
    return this.solved.includes(order);
  },

  isUnlocked(order) {
    return order === 1 || this.isSolved(order - 1);
  },

  didUseClue(order) {
    return this.usedClue.includes(order);
  },

  markSolved(order) {
    if (this.isSolved(order)) return;
    this.solved = [...this.solved, order];
    this.save();
  },

  markClueUsed(order) {
    if (this.didUseClue(order)) return;
    this.usedClue = [...this.usedClue, order];
    this.save();
  },
});
