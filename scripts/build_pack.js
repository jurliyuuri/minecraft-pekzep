#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const yazl = require("yazl");

const ROOT = path.resolve(__dirname, "..");
const PACK_MCMETA = path.join(ROOT, "pack", "pack.mcmeta");
const TRANSLATIONS_DIR = path.join(ROOT, "translations");
const DIST_DIR = path.join(ROOT, "dist");
const DIST_FONT = path.join(DIST_DIR, "linzi_font");
const ZIP_NAME = "pekzep-1.16.1.zip";
const LINZI_ZIP_NAME = "pekzep-linzi-1.16.1.zip";
const LINZI_DESCRIPTION = "牌言・燐字 (Pekzep linzi) for Minecraft 1.16.1";
const PLACEHOLDER = /%(?:\d+\$)?[sd]|%%/g;

function parseArgs(argv) {
  const args = {
    translations: null,
    linzi: false,
    output: null,
    fontDir: DIST_FONT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--translations") {
      args.translations = path.resolve(argv[++i]);
    } else if (a === "--linzi") {
      args.linzi = true;
    } else if (a === "--output") {
      args.output = path.resolve(argv[++i]);
    } else if (a === "--font-dir") {
      args.fontDir = path.resolve(argv[++i]);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function loadJson(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${filePath} is not a JSON object`);
  }
  return data;
}

function walkJsonFiles(dir, acc) {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walkJsonFiles(full, acc);
    } else if (st.isFile() && name.endsWith(".json")) {
      acc.push(full);
    }
  }
  return acc;
}

function findTranslationFile(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit) || !fs.statSync(explicit).isFile()) {
      throw new Error(`translation file not found: ${explicit}`);
    }
    return explicit;
  }

  const preferred = [
    path.join(TRANSLATIONS_DIR, "pz_ai.json"),
    path.join(TRANSLATIONS_DIR, "pz_ai", "en_us.json"),
    path.join(TRANSLATIONS_DIR, "pz-ai", "en_us.json"),
    path.join(TRANSLATIONS_DIR, "pz-AI", "en_us.json"),
  ];
  for (const filePath of preferred) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }

  if (fs.existsSync(TRANSLATIONS_DIR) && fs.statSync(TRANSLATIONS_DIR).isDirectory()) {
    const candidates = walkJsonFiles(TRANSLATIONS_DIR, []).sort();
    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 0) {
      const pz = candidates.filter((p) =>
        path.relative(TRANSLATIONS_DIR, p).toLowerCase().includes("pz")
      );
      if (pz.length === 1) {
        return pz[0];
      }
      const names = candidates.map((p) => path.relative(ROOT, p)).join(", ");
      throw new Error(
        "multiple translation JSON files; pass --translations. found: " + names
      );
    }
  }

  throw new Error("no translation file. download from Crowdin into translations/");
}

function languageMeta(mcmeta) {
  const langs = mcmeta.language;
  const keys = langs && typeof langs === "object" ? Object.keys(langs) : [];
  if (keys.length !== 1) {
    throw new Error("pack.mcmeta must define exactly one language");
  }
  const code = keys[0];
  const info = langs[code];
  if (info === null || typeof info !== "object" || Array.isArray(info)) {
    throw new Error(`invalid language entry for ${code}`);
  }
  const name = info.name;
  const region = info.region;
  if (!name || !region) {
    throw new Error("language name and region are required in pack.mcmeta");
  }
  return [code, name, region];
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function remapChunk(text, puaMap) {
  let out = "";
  for (const ch of text) {
    out += Object.prototype.hasOwnProperty.call(puaMap, ch) ? puaMap[ch] : ch;
  }
  return out;
}

function remapText(text, puaMap) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    out.push(remapChunk(text.slice(last, match.index), puaMap));
    out.push(match[0]);
    last = match.index + match[0].length;
  }
  out.push(remapChunk(text.slice(last), puaMap));
  return out.join("");
}

function remapLang(data, puaMap) {
  const remapped = {};
  for (const [key, value] of Object.entries(data)) {
    remapped[key] = typeof value === "string" ? remapText(value, puaMap) : value;
  }
  return remapped;
}

function linziMcmetaText(puaMap) {
  const mcmeta = loadJson(PACK_MCMETA);
  // Description is shown before the pack is applied, so keep kanji (no PUA).
  mcmeta.pack.description = LINZI_DESCRIPTION;
  const languages = mcmeta.language;
  if (languages && typeof languages === "object") {
    for (const info of Object.values(languages)) {
      if (info === null || typeof info !== "object" || Array.isArray(info)) {
        continue;
      }
      for (const key of ["name", "region"]) {
        if (typeof info[key] === "string") {
          info[key] = remapText(info[key], puaMap);
        }
      }
    }
  }
  return JSON.stringify(mcmeta, null, 2) + "\n";
}

function linziFontFiles(fontDir) {
  const defaultJson = path.join(fontDir, "default.json");
  if (!fs.existsSync(defaultJson) || !fs.statSync(defaultJson).isFile()) {
    throw new Error(`missing ${defaultJson}; run scripts/build_linzi_font.js first`);
  }
  const files = [[defaultJson, "assets/minecraft/font/default.json"]];
  const uniformJson = path.join(fontDir, "uniform.json");
  if (!fs.existsSync(uniformJson) || !fs.statSync(uniformJson).isFile()) {
    throw new Error(`missing ${uniformJson}; run scripts/build_linzi_font.js first`);
  }
  files.push([uniformJson, "assets/minecraft/font/uniform.json"]);
  const pngs = fs
    .readdirSync(fontDir)
    .filter((name) => /^linzi_e.*\.png$/.test(name))
    .sort()
    .map((name) => path.join(fontDir, name));
  if (pngs.length === 0) {
    throw new Error(`no linzi_e*.png in ${fontDir}`);
  }
  for (const png of pngs) {
    files.push([png, `assets/minecraft/textures/font/${path.basename(png)}`]);
  }
  return files;
}

function hasPua(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      return true;
    }
  }
  return false;
}

function isUnder(root, filePath) {
  const rel = path.relative(root, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function rmFiles(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        fs.unlinkSync(full);
      }
    }
  };
  walk(dir);
}

function writeZip(dest, entries) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const out = fs.createWriteStream(dest);
    zipfile.outputStream.on("error", reject);
    out.on("error", reject);
    out.on("close", resolve);
    zipfile.outputStream.pipe(out);
    for (const { buffer, src, arcname } of entries) {
      if (buffer !== undefined) {
        zipfile.addBuffer(Buffer.from(buffer), arcname);
      } else {
        zipfile.addFile(src, arcname);
      }
    }
    zipfile.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.output === null) {
    args.output = path.join(DIST_DIR, args.linzi ? LINZI_ZIP_NAME : ZIP_NAME);
  }

  const mcmeta = loadJson(PACK_MCMETA);
  const [langCode, name, region] = languageMeta(mcmeta);
  const transPath = findTranslationFile(args.translations);
  let merged = loadJson(transPath);
  merged["language.name"] = name;
  merged["language.region"] = region;
  merged["language.code"] = langCode;

  let extra = [];
  let puaCount = 0;
  let puaMap = null;
  if (args.linzi) {
    const puaPath = path.join(args.fontDir, "pua_map.json");
    if (!fs.existsSync(puaPath) || !fs.statSync(puaPath).isFile()) {
      throw new Error(`missing ${puaPath}; run scripts/build_linzi_font.js first`);
    }
    puaMap = loadJson(puaPath);
    merged = remapLang(merged, puaMap);
    puaCount = Object.values(merged).filter(
      (value) => typeof value === "string" && hasPua(value)
    ).length;
    extra = linziFontFiles(args.fontDir);
  }

  const staging = path.join(DIST_DIR, args.linzi ? "pack_linzi" : "pack");
  rmFiles(staging);
  const langOut = path.join(
    staging,
    "assets",
    "minecraft",
    "lang",
    `${langCode}.json`
  );
  writeJson(langOut, merged);

  let mcmetaText;
  if (args.linzi) {
    mcmetaText = linziMcmetaText(puaMap);
  } else {
    mcmetaText = fs.readFileSync(PACK_MCMETA, "utf8");
    if (!mcmetaText.endsWith("\n")) {
      mcmetaText += "\n";
    }
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const zipEntries = [
    { buffer: mcmetaText, arcname: "pack.mcmeta" },
    { src: langOut, arcname: `assets/minecraft/lang/${langCode}.json` },
  ];
  for (const [src, arcname] of extra) {
    zipEntries.push({ src, arcname });
  }
  await writeZip(args.output, zipEntries);

  const sourceLabel = isUnder(ROOT, transPath)
    ? path.relative(ROOT, transPath)
    : transPath;
  const stats =
    `keys: ${Object.keys(merged).length}\n` +
    `source translations: ${sourceLabel}\n` +
    `linzi: ${args.linzi ? "True" : "False"}\n` +
    `strings with PUA: ${puaCount}\n` +
    `output: ${args.output}\n`;
  const statsPath = path.join(
    DIST_DIR,
    args.linzi ? "stats-linzi.txt" : "stats.txt"
  );
  fs.writeFileSync(statsPath, stats, "utf8");
  process.stdout.write(stats);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
