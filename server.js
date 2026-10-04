// Simple static file server for the VSMP site. Run: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json" };
const SAFE = ["index.html", "style.css", "config.js", "bg.js", "main.js", "sanctuary.jpg"];

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = path.join(__dirname, url === "/" ? "index.html" : url);
  if (!SAFE.includes(path.basename(file)) || path.dirname(file) !== __dirname) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`VSMP site on http://localhost:${PORT}`));
