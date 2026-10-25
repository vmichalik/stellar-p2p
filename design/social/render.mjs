import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PACTLANE_PLAYWRIGHT_MODULE ?? 'playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const output = path.join(root, 'app/assets/social');
const review = path.join(dir, 'review');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(review, { recursive: true });
const chrome =
  process.env.PACTLANE_CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  headless: true,
  chromiumSandbox: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const externalRequests = [],
    errors = [];
  await page.route(/^https?:/, (route) => {
    externalRequests.push(route.request().url());
    return route.abort();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const url = pathToFileURL(path.join(dir, 'index.html'));
  await page.goto(url.href);
  const cards = await page.evaluate(() => window.PACTLANE_SOCIAL_CARDS);
  const artData =
    'data:image/png;base64,' +
    (await fs.readFile(path.join(dir, 'source/pactlane-pair.png'))).toString('base64');
  const exports = [];
  for (const card of cards) {
    await page.setViewportSize({ width: card.width, height: card.height });
    url.searchParams.set('card', card.id);
    await page.goto(url.href);
    await page.evaluate(async (data) => {
      document.querySelector('.art').src = data;
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    }, artData);
    const checks = await page.evaluate(() => {
      const card = document.querySelector('.card'),
        bounds = card.getBoundingClientRect();
      const clipped = [...card.querySelectorAll('.brand,.status,h1,.lede,.footer')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left < bounds.left ||
            r.right > bounds.right ||
            r.top < bounds.top ||
            r.bottom > bounds.bottom
          );
        })
        .map((el) => el.className || el.tagName);
      const heading = card.querySelector('h1').getBoundingClientRect();
      const lede = card.querySelector('.lede').getBoundingClientRect();
      const footer = card.querySelector('.footer').getBoundingClientRect();
      const art = document.querySelector('.art'),
        box = art.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = art.naturalWidth;
      canvas.height = art.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(art, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let top = canvas.height,
        left = canvas.width,
        right = 0,
        bottom = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (pixels[(y * canvas.width + x) * 4 + 3] > 128) {
            top = Math.min(top, y);
            left = Math.min(left, x);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
      const fit = Math.min(box.width / canvas.width, box.height / canvas.height);
      const offsetX = box.x + (box.width - canvas.width * fit) / 2,
        offsetY = box.y + (box.height - canvas.height * fit) / 2;
      const visibleArt = {
        top: offsetY + top * fit,
        left: offsetX + left * fit,
        right: offsetX + right * fit,
        bottom: offsetY + bottom * fit,
      };
      return {
        visibleArt,
        artToFooterGap: footer.top - visibleArt.bottom,
        width: bounds.width,
        height: bounds.height,
        manropeLoaded: document.fonts.check('600 80px Manrope'),
        clipped,
        headingToBodyGap: lede.top - heading.bottom,
        bodyToFooterGap: footer.top - lede.bottom,
        sourceArtLoaded: document.querySelector('.art').naturalWidth > 0,
        title: card.querySelector('h1').innerText,
      };
    });
    if (
      checks.width !== card.width ||
      checks.height !== card.height ||
      !checks.manropeLoaded ||
      checks.clipped.length ||
      !checks.sourceArtLoaded ||
      checks.headingToBodyGap < 0 ||
      checks.bodyToFooterGap < 0 ||
      checks.artToFooterGap < 12 ||
      errors.length
    )
      throw Error(JSON.stringify({ card: card.id, checks, errors }));
    const image = page.locator('.card');
    const files = [];
    for (const [extension, options] of [
      ['png', { type: 'png' }],
      ['jpg', { type: 'jpeg', quality: 95 }],
    ]) {
      const name = `${card.id}.${extension}`,
        destination = path.join(output, name);
      await image.screenshot({ path: destination, ...options, animations: 'disabled' });
      const bytes = await fs.readFile(destination);
      if (bytes.length > 5_000_000) throw Error(`Export exceeds 5MB: ${name}`);
      files.push({
        file: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    exports.push({
      id: card.id,
      width: card.width,
      height: card.height,
      alt: card.alt,
      checks,
      files,
    });
  }
  if (externalRequests.length || errors.length)
    throw Error(JSON.stringify({ externalRequests, errors }));
  await fs.writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      { brand: 'Pactlane', status: 'local reviewed creative assets; not published', exports },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(review, 'render-checks.json'),
    JSON.stringify(
      {
        chromiumSandbox: true,
        isolatedContext: true,
        browser: await browser.version(),
        externalRequests,
        errors,
        exports,
      },
      null,
      2,
    ) + '\n',
  );
  const sheet = path.join(dir, 'contact-sheet.html');
  if (existsSync(sheet)) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pathToFileURL(sheet).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({
      path: path.join(review, 'contact-sheet.jpg'),
      type: 'jpeg',
      quality: 93,
      fullPage: true,
      animations: 'disabled',
    });
  }
  console.log(
    JSON.stringify({
      exported: exports.length,
      formats: ['png', 'jpg'],
      externalRequests: externalRequests.length,
      errors: errors.length,
      output,
    }),
  );
} finally {
  await browser.close();
}
