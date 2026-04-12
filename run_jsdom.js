const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = fs.readFileSync('index.html', 'utf8');

const virtualConsole = new jsdom.VirtualConsole();
virtualConsole.on("error", (msg) => { console.error("VC ERROR:", msg); });
virtualConsole.on("jsdomError", (err) => { console.error("JSDOM ERROR:", err.message, err.detail); });

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  virtualConsole
});

dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 16);

setTimeout(() => {
  console.log("JSDOM TIMEOUT REACHED");
  process.exit(0);
}, 5000);
