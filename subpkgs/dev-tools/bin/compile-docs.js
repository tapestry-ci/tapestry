#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs");
const readdir = require("readdir-enhanced");

const DOCS_DIRECTORY = path.resolve(__dirname, "../../docs");
const COMPILED_DOCS_JSON_FILE = path.resolve(__dirname, "../lib/docs.json");

const fullDocs = readdir
  .sync(DOCS_DIRECTORY, { deep: true, filter: "**/*.md" })
  .reduce((acc, filename) => {
    const pathname = path.resolve(DOCS_DIRECTORY, filename);
    const name = filename.replace(/\.md$/, "");
    const rawContents = fs.readFileSync(pathname, "utf8");
    const contents = rewriteForTapdev(rawContents, pathname);
    const description = contents.slice(0, contents.indexOf("\n")).replace(/^#\s*/, "");
    acc[name] = { filename: `docs/${filename}`, description, contents };
    return acc;
  }, {});

function rewriteForTapdev(contents, pathname) {
  const dirname = path.dirname(pathname);
  console.log(`checking links for ${pathname}`);
  return contents.replace(/\[(.+?)\]\(\.{1,2}\/([\S]+)\.md\)/g, (fullLink, linkName, linkDst) => {
    const fullDst = path.resolve(dirname, linkDst);
    const isDocs = fullDst.startsWith(DOCS_DIRECTORY);
    console.log("CHECKING", fullLink, fullDst, isDocs);
    if (isDocs) {
      const docspath = path.relative(DOCS_DIRECTORY, fullDst).replace(/\.md$/, "");
      const _TICK = "`";
      const tapcmd = `${_TICK}tapdev docs ${docspath}${_TICK}`;
      return tapcmd;
    }

    return fullLink;
  });
}

fs.writeFileSync(COMPILED_DOCS_JSON_FILE, JSON.stringify(fullDocs), "utf8");
