// Buzz's wallet: coins, the outfits you own, and the one Buzz is wearing.
// Every page loads this, so any page can read or change it with $store.buzz.
//
// The outfit list comes from src/_data/outfits.json. The layout puts it on
// the page as window.BUZZ_OUTFITS when the site is built.

const WALLET_KEY = "buzz-wallet";

const DEFAULT_WALLET = {
  coins: 0,
  owned: ["default"],
  equipped: "default",
  // Rewards already paid out, so none can be earned twice.
  // e.g. { "genius-20261021": true, "puzzle-3": true }
  claimed: {},
};

function loadWallet() {
  try {
    const saved = JSON.parse(localStorage.getItem(WALLET_KEY));
    return { ...DEFAULT_WALLET, ...saved };
  } catch (e) {
    return { ...DEFAULT_WALLET };
  }
}

Alpine.store("buzz", {
  outfits: window.BUZZ_OUTFITS || [],
  ...loadWallet(),

  init() {
    // Another tab or page may have changed the wallet: reload it when
    // this page comes back into view.
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        Object.assign(this, loadWallet());
      }
    });
  },

  save() {
    localStorage.setItem(
      WALLET_KEY,
      JSON.stringify({
        coins: this.coins,
        owned: this.owned,
        equipped: this.equipped,
        claimed: this.claimed,
      })
    );
  },

  getOutfit(id) {
    return this.outfits.find((outfit) => outfit.id === id);
  },

  // The outfit Buzz is wearing. Falls back to the default if the equipped
  // one was removed from outfits.json.
  get equippedOutfit() {
    return this.getOutfit(this.equipped) || this.getOutfit("default");
  },

  owns(id) {
    return this.owned.includes(id);
  },

  canAfford(price) {
    return this.coins >= price;
  },

  // Adds coins for a reward, once per rewardId. Returns true if paid.
  earn(amount, rewardId) {
    if (this.claimed[rewardId]) return false;
    this.claimed = { ...this.claimed, [rewardId]: true };
    this.coins += amount;
    this.save();
    return true;
  },

  // Takes coins, e.g. to enter Pangramble. Returns false if you're short.
  spend(amount) {
    if (!this.canAfford(amount)) return false;
    this.coins -= amount;
    this.save();
    return true;
  },

  buy(id) {
    const outfit = this.getOutfit(id);
    if (!outfit || this.owns(id) || !this.spend(outfit.price)) return false;
    this.owned = [...this.owned, id];
    this.equipped = id; // wear it straight away
    this.save();
    return true;
  },

  equip(id) {
    if (!this.owns(id)) return;
    this.equipped = id;
    this.save();
  },
});
