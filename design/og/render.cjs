// Renders og-image.html to public/og-image.png (1200×630) and shrinks it to 256 colours via quantize.cjs
// (--raw skips that). Needs Playwright + Chromium and network for Google Fonts. Re-render from the repo root:
//   NODE_PATH=/home/ryo/work/tetetetennis/node_modules node design/og/render.cjs [out.png] [--raw]
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

(async () => {
  const src = path.join(__dirname, "og-image.html");
  const args = process.argv.slice(2);
  const raw = args.includes("--raw"); // skip quantizing (full-colour PNG)
  const out = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..", "..", "public", "og-image.png"));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto("file://" + src, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      // SVG <text> doesn't always trigger a font load on its own
      await Promise.all([
        document.fonts.load('700 40px "Playfair Display"'),
        document.fonts.load('800 40px "Playfair Display"'),
        document.fonts.load('italic 700 40px "Playfair Display"'),
        document.fonts.load('800 40px "Inter"'),
        document.fonts.load('700 40px "Inter"'),
        document.fonts.load('600 40px "Inter"'),
      ]);
      await document.fonts.ready;
    });
    const missing = await page.evaluate(() =>
      ['700 10px "Playfair Display"', 'italic 700 10px "Playfair Display"', '800 10px "Inter"'].filter((f) => !document.fonts.check(f)),
    );
    if (missing.length) throw new Error("fonts did not load: " + missing.join(", "));
    await page.locator("#og").screenshot({ path: out, type: "png" });
    if (!raw) execFileSync(process.execPath, [path.join(__dirname, "quantize.cjs"), out, out, "0.5"], { stdio: "inherit" });
    console.log("wrote", out);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
