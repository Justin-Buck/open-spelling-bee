// The puzzle list for pages to show when the site is built: each puzzle's
// number, difficulty and reward. It leaves out the letters and words, so the
// puzzle list page doesn't give the answers away.
const fs = require("fs");
const path = require("path");

module.exports = () => {
  const puzzles = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../words/puzzles.json"), "utf8")
  );
  return puzzles.map(({ order, difficulty, reward }) => ({
    order,
    difficulty,
    reward,
  }));
};
