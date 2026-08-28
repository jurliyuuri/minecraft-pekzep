"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function linMarnRoot() {
  const fromEnv = process.env.LIN_MARN;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(__dirname, "..", "vendor", "lin-marn");
}

const EXPORTS = [
  "folder_names",
  "folder_type",
  "linzi_list",
  "NEW_IMAGE_EXISTENCE_TABLE",
  "defined_but_no_image_prepared",
  "isLinzi",
  "getImage_",
  "getImage",
  "mysterious_encoding",
];

function loadLinMarn(root) {
  const imageTable = path.join(root, "image_table");
  const files = [
    "char_and_folder_info.js",
    "image_existence_table.js",
    "get_image.js",
    "mysterious_encoding.js",
  ];
  const context = { console };
  vm.createContext(context);
  for (const name of files) {
    const filePath = path.join(imageTable, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`missing ${filePath}; checkout lin-marn image_table first`);
    }
    const source = fs.readFileSync(filePath, "utf8");
    const exportLines = EXPORTS.map(
      (ident) =>
        `if (typeof ${ident} !== "undefined") global.${ident} = ${ident};`
    ).join("\n");
    const wrapped = `(function (global) {\n${source}\n${exportLines}\n})(this);`;
    vm.runInContext(wrapped, context, { filename: filePath });
  }
  return context;
}

function noborderFolders(context) {
  return context.folder_names.filter((name) => context.folder_type[name] === "noborder");
}

module.exports = { linMarnRoot, loadLinMarn, noborderFolders };
