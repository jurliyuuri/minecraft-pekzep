#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const DIST_FONT = path.join(ROOT, "dist", "linzi_font");
const CELL = 16;
const COLS = 16;
const ROWS = 16;
const PAGE = COLS * ROWS;
const PUA_BASE = 0xe000;
const HEIGHT = 8;
const ASCENT = 7;

function parseArgs(argv) {
  const args = {
    glyphs: path.join(ROOT, "dist", "noborder.json"),
    out: DIST_FONT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--glyphs") {
      args.glyphs = path.resolve(argv[++i]);
    } else if (a === "--out") {
      args.out = path.resolve(argv[++i]);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function loadGlyphs(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!data.encoding || !data.glyphs) {
    throw new Error(`${filePath} is not collect_noborder.js output`);
  }
  return data;
}

// Python 3 int(round(x)): ties to even.
function pyRound(x) {
  if (x < 0) {
    return -pyRound(-x);
  }
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac < 0.5) {
    return floor;
  }
  if (frac > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

function pixel(data, width, x, y) {
  const i = (width * y + x) << 2;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function setPixel(data, width, x, y, r, g, b, a) {
  const i = (width * y + x) << 2;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function blankRgba(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 0;
  }
  return data;
}

function nearestResize(src, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) {
    return Buffer.from(src);
  }
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      src.copy(out, (dstW * y + x) << 2, (srcW * sy + sx) << 2, ((srcW * sy + sx) << 2) + 4);
    }
  }
  return out;
}

function toMcGlyph(png) {
  let data = png.data;
  let width = png.width;
  let height = png.height;
  if (width !== CELL || height !== CELL) {
    data = nearestResize(data, width, height, CELL, CELL);
    width = CELL;
    height = CELL;
  }
  const out = blankRgba(CELL, CELL);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const [r, g, b, a] = pixel(data, width, x, y);
      if (a === 0) {
        continue;
      }
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const alpha = pyRound((a / 255.0) * (255.0 - luma));
      setPixel(out, CELL, x, y, 255, 255, 255, Math.max(0, Math.min(255, alpha)));
    }
  }
  const pinX = CELL - 1 - 2;
  const pinY = CELL - 1;
  const [, , , pinA] = pixel(out, CELL, pinX, pinY);
  if (pinA === 0) {
    setPixel(out, CELL, pinX, pinY, 255, 255, 255, 1);
  }
  return out;
}

function pageChars(start, count) {
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    let chars = "";
    for (let col = 0; col < COLS; col++) {
      const index = start + row * COLS + col;
      chars += index >= count ? "\u0000" : String.fromCodePoint(PUA_BASE + index);
    }
    rows.push(chars);
  }
  return rows;
}

function writePng(filePath, width, height, data) {
  const png = new PNG({ width, height });
  data.copy(png.data);
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = loadGlyphs(args.glyphs);
  const encoding = data.encoding;
  const glyphs = data.glyphs;
  const linRoot = data.root;

  const nPages = Math.floor((encoding.length + PAGE - 1) / PAGE);
  fs.mkdirSync(args.out, { recursive: true });

  const providers = [];
  const puaMap = {};
  let placed = 0;
  for (let page = 0; page < nPages; page++) {
    const start = page * PAGE;
    const atlas = blankRgba(COLS * CELL, ROWS * CELL);
    for (let offset = 0; offset < PAGE; offset++) {
      const index = start + offset;
      if (index >= encoding.length) {
        break;
      }
      const ch = encoding[index];
      const rel = ch === "??" ? null : glyphs[ch];
      if (!rel) {
        continue;
      }
      const srcPath = path.join(linRoot, rel);
      if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
        console.error(`missing file for ${ch}: ${srcPath}`);
        continue;
      }
      const srcPng = PNG.sync.read(fs.readFileSync(srcPath));
      const glyph = toMcGlyph(srcPng);
      const col = offset % COLS;
      const row = Math.floor(offset / COLS);
      const dx = col * CELL;
      const dy = row * CELL;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const [r, g, b, a] = pixel(glyph, CELL, x, y);
          setPixel(atlas, COLS * CELL, dx + x, dy + y, r, g, b, a);
        }
      }
      puaMap[ch] = String.fromCodePoint(PUA_BASE + index);
      placed += 1;
    }

    const name = `linzi_e${page}.png`;
    writePng(path.join(args.out, name), COLS * CELL, ROWS * CELL, atlas);
    providers.push({
      type: "bitmap",
      file: `minecraft:font/${name}`,
      height: HEIGHT,
      ascent: ASCENT,
      chars: pageChars(start, encoding.length),
    });
  }

  const fontJson = JSON.stringify({ providers }, null, 2) + "\n";
  fs.writeFileSync(path.join(args.out, "default.json"), fontJson, "utf8");
  fs.writeFileSync(path.join(args.out, "uniform.json"), fontJson, "utf8");
  fs.writeFileSync(
    path.join(args.out, "pua_map.json"),
    JSON.stringify(puaMap, null, 2) + "\n",
    "utf8"
  );
  process.stdout.write(
    `pages: ${nPages}\n` +
      `encoding slots: ${encoding.length}\n` +
      `glyphs placed: ${placed}\n` +
      `pua_map: ${Object.keys(puaMap).length}\n` +
      `out: ${args.out}\n`
  );
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
