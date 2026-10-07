// Edit this file to customise the site.
window.VSMP = {
  serverIp: "neuron.zeroxhost.space:19145",
  discord: "https://discord.gg/TwvKW8xqs",
  // Vote sites: add your own server-list pages here
  voteSites: [
    { name: "Your server list", url: "https://example.com", note: "Vote once every 24 hours to help the realm grow." }
  ],
  allies: [
    { name: "OUR DISCORD SERVER", url: "https://discord.gg/TwvKW8xqs", tag: "VSMP HQ" }
  ],
  // Ranks are priced in euros; coins and crate keys in dollars; the Coin Shop and Time Kits are paid for with Coins.
  ranks: [
    { id: "mvp", name: "MVP", price: 3, currency: "EUR", color: "#F2C4D6", perks: ["MVP KIT", "PV 1", "/EC"] },
    { id: "king", name: "KING", price: 5, currency: "EUR", color: "#FEE75C", perks: ["KING KIT", "PV 1", "PV 2", "/EC", "3 /SETHOMES"] },
    { id: "pro-plus", name: "PRO+", price: 10, currency: "EUR", color: "#FFFFFF", featured: true, perks: ["PRO KIT", "PV 1 - 3", "/EC", "/ANVIL", "5 /SETHOMES", "/NICKNAME"] }
  ],
  // More sections. An item with "price" + "currency" goes in the cart; an item with "coins" is bought with Coins.
  storeSections: [
    { title: "Coins", note: "Buy Coins here, then spend them in the Coin Shop below.", items: [
      { id: "coins-120", name: "120 Coins", price: 0.69, currency: "USD" },
      { id: "coins-500", name: "500 Coins", price: 5, currency: "USD" },
      { id: "coins-1000", name: "1000 Coins", price: 8.99, currency: "USD" },
      { id: "coins-1500", name: "1500 Coins", price: 11.99, currency: "USD" }
    ] },
    { title: "Crate Keys", items: [
      { id: "keys-common-x3", name: "COMMON KEYS x3", price: 1.29, currency: "USD" },
      { id: "keys-rare-x3", name: "RARE KEYS x3", price: 4.49, currency: "USD" },
      { id: "keys-elite-x1", name: "ELITE KEYS x1", price: 2.39, currency: "USD" },
      { id: "keys-mythic-x3", name: "MYTHIC KEYS x3", price: 9.99, currency: "USD" }
    ] },
    { title: "Coin Shop", note: "Paid for with Coins. Open a ticket in #support to claim.", items: [
      { name: "MVP KIT", coins: 100 },
      { name: "KING KIT", coins: 220 },
      { name: "PRO+ KIT", coins: 400 }
    ] },
    { title: "3 Time Kits", note: "Paid for with Coins. Open a ticket in #support to claim.", items: [
      { name: "10K In Game money", coins: 30 },
      { name: "50K In Game money", coins: 120 },
      { name: "75K In Game money", coins: 220 },
      { name: "1 Stack of Diamonds", coins: 160 },
      { name: "6 Netherite ingots", coins: 400 }
    ] }
  ],
  // Optional PayPal.me link, e.g. "https://paypal.me/yourname" (adds a Pay with PayPal link after ordering)
  paypalMe: ""
};
