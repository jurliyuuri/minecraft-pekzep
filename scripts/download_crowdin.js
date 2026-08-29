#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "translations");
const OUT_FILE = path.join(OUT_DIR, "pz_ai.json");
const PROJECT_ID = process.env.CROWDIN_PROJECT_ID || "923393";
const BASE = "https://api.crowdin.com/api/v2";
const TIMEOUT_MS = 60_000;

function token() {
  const value = (process.env.CROWDIN_PERSONAL_TOKEN || "").trim();
  if (!value) {
    throw new Error("CROWDIN_PERSONAL_TOKEN is not set");
  }
  return value;
}

async function request(method, apiPath, body) {
  const headers = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/json",
  };
  const opts = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(BASE + apiPath, opts);
  const raw = Buffer.from(await resp.arrayBuffer());
  if (!resp.ok) {
    throw new Error(
      `Crowdin API ${resp.status} ${method} ${apiPath}: ${raw.toString("utf8")}`
    );
  }
  if (raw.length === 0) {
    return {};
  }
  return JSON.parse(raw.toString("utf8"));
}

async function fetchUrl(url) {
  // Crowdin artifact URLs are signed; sending the API token makes S3 return 400.
  const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const raw = Buffer.from(await resp.arrayBuffer());
  if (!resp.ok) {
    throw new Error(
      `download ${resp.status} ${url.split("?", 1)[0]}: ${raw.toString("utf8")}`
    );
  }
  return raw;
}

async function paginate(apiPath) {
  const items = [];
  let offset = 0;
  for (;;) {
    const sep = apiPath.includes("?") ? "&" : "?";
    const payload = await request(
      "GET",
      `${apiPath}${sep}limit=500&offset=${offset}`
    );
    const chunk = payload.data || [];
    items.push(...chunk);
    const pagination = payload.pagination || {};
    offset += pagination.limit ?? chunk.length;
    if (offset >= (pagination.total ?? offset) || chunk.length === 0) {
      break;
    }
  }
  return items;
}

function unwrap(item) {
  return item && item.data !== undefined ? item.data : item;
}

function pickLanguage(project) {
  const source = unwrap(project).sourceLanguageId || "en";
  const targets = unwrap(project).targetLanguageIds || [];
  console.log(`source language: ${source}`);
  console.log(`target languages: ${JSON.stringify(targets)}`);
  if (targets.length === 0) {
    throw new Error("Crowdin project has no target languages");
  }
  const pz = targets.filter((lang) => lang.toLowerCase().includes("pz"));
  if (pz.length === 1) {
    return pz[0];
  }
  const remaining = targets.filter((lang) => lang !== source);
  if (remaining.length === 1) {
    return remaining[0];
  }
  if (pz.length > 1) {
    throw new Error(`multiple pz languages: ${JSON.stringify(pz)}`);
  }
  throw new Error(`cannot choose target language from ${JSON.stringify(targets)}`);
}

async function main() {
  const project = await request("GET", `/projects/${PROJECT_ID}`);
  const language = pickLanguage(project);
  console.log(`downloading language: ${language}`);

  const files = (await paginate(`/projects/${PROJECT_ID}/files`)).map(unwrap);
  if (files.length === 0) {
    throw new Error("Crowdin project has no files");
  }
  for (const info of files) {
    console.log(`file id=${info.id} path=${info.path} name=${info.name}`);
  }

  const merged = {};
  for (const info of files) {
    const fileId = info.id;
    const built = await request(
      "POST",
      `/projects/${PROJECT_ID}/translations/builds/files/${fileId}`,
      {
        targetLanguageId: language,
        skipUntranslatedStrings: false,
        skipUntranslatedFiles: false,
        exportApprovedOnly: false,
      }
    );
    const url = unwrap(built).url;
    if (!url) {
      throw new Error(`no download url for file ${fileId}: ${JSON.stringify(built)}`);
    }
    const raw = await fetchUrl(url);
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      throw new Error(
        `translation for ${info.path} is not JSON: ${raw.subarray(0, 200)}`
      );
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`translation for ${info.path} is not a JSON object`);
    }
    Object.assign(merged, payload);
    console.log(`merged ${Object.keys(payload).length} keys from ${info.path}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(
    `wrote ${path.relative(ROOT, OUT_FILE)} (${Object.keys(merged).length} keys)`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
