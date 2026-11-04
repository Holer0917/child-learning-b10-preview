// Development only: render the canonical SVG to installation icons.
// Requires Playwright and Edge (or set ICON_BROWSER to a Chromium executable).
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const icons = path.resolve(__dirname, '../assets/icons');
  const browser = await chromium.launch({ executablePath: process.env.ICON_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const [size, name] of [[192, 'app-192.png'], [512, 'app-512.png'], [180, 'apple-touch-icon.png']]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent('<style>html,body{margin:0;width:100%;height:100%;background:#fff}svg{display:block;width:100%;height:100%}</style>' + fs.readFileSync(path.join(icons, 'favicon.svg'), 'utf8'));
      await page.screenshot({ path: path.join(icons, name) });
      await page.close();
      console.log(name + ': ' + size + 'x' + size);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
