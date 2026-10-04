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
  ranks: [
    { id: "samurai", name: "Samurai", price: 5, color: "#F2C4D6", perks: ["Custom chat tag", "/kit samurai", "2 extra homes"] },
    { id: "shogun", name: "Shogun", price: 10, color: "#FFFFFF", featured: true, perks: ["Everything in Samurai", "Particle trails", "Priority queue", "Private Discord section"] },
    { id: "emperor", name: "Emperor", price: 20, color: "#FEE75C", perks: ["Everything in Shogun", "Exclusive cosmetics", "Name colour", "5 extra homes"] }
  ],
  // Extra shop items (optional): { id, name, price, desc, badge }
  items: [],
  // Optional PayPal.me link, e.g. "https://paypal.me/yourname" (adds a Pay with PayPal link after ordering)
  paypalMe: ""
};
