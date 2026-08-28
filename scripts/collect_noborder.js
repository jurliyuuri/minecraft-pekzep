#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { linMarnRoot, loadLinMarn, noborderFolders } = require("./load_lin_marn");

function parseImgSrc(html) {
  const match = typeof html === "string" && html.match(/\bsrc='([^']+)'/);
  return match ? match[1] : null;
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : linMarnRoot();
  const context = loadLinMarn(root);
  const folders = noborderFolders(context);
  if (folders.length === 0) {
    throw new Error("lin-marn folder_type has no noborder folders");
  }

  const encoding = context.mysterious_encoding;
  if (!Array.isArray(encoding)) {
    throw new Error("mysterious_encoding is missing");
  }

  const glyphs = {};
  let withImage = 0;
  let missing = 0;
  for (const ch of encoding) {
    if (ch === "??") {
      continue;
    }
    const result = context.getImage_(ch, ["noborder"], 16, false, root);
    const src = parseImgSrc(result);
    if (src) {
      const rel = path.relative(root, src);
      glyphs[ch] = rel.split(path.sep).join("/");
      withImage += 1;
    } else {
      glyphs[ch] = null;
      missing += 1;
    }
  }

  const out = {
    root,
    encoding,
    folders,
    glyphs,
    stats: { slots: encoding.length, withImage, missing },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main();
