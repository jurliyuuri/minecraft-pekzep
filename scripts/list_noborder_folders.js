#!/usr/bin/env node
"use strict";

const path = require("path");
const { linMarnRoot, loadLinMarn, noborderFolders } = require("./load_lin_marn");

const root = process.argv[2] ? path.resolve(process.argv[2]) : linMarnRoot();
const context = loadLinMarn(root);
for (const name of noborderFolders(context)) {
  console.log(name);
}
console.log("img_punctuation");
