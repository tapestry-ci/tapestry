#!/usr/bin/env node
"use strict";

const renderSlackMessage = require("../build-finished/render-slack-message");
const reportData = require("../data/build-reports");
const args = process.argv
  .slice(2)
  .reduce(
    (m, x) =>
      Object.assign(
        m,
        x.startsWith("-")
          ? x.includes("=") ? { [x.split("=")[0]]: [x.split("=")[1]] } : { [x]: true }
          : { positional: [...m.positional, x] }
      ),
    { positional: [] }
  );

if (args["-h"] || args["--help"]) usage();

if (args["-r"] || args["--random"]) {
  render(reportData.rand());
  process.exit();
}

const theID = args["-i"] || args["--id"];
if (theID) {
  render(reportData.get(theID));
  process.exit();
}

if (args["-l"] || args["--list"]) {
  console.log("available data files:");
  reportData.keys.forEach(name => console.log(`- ${name}`));
  process.exit();
}

usage();

function render({ build, report }) {
  const rendered = renderSlackMessage(build, report);
  const jsoned = JSON.stringify(rendered, null, 2);
  console.log(
    `id : ${build.codebuild && build.codebuild.id
      ? build.codebuild.id.split(":")[1].split("-")[0]
      : "none?"}`
  );
  console.log("\n");
  console.log(
    jsoned
      .split("\n")
      .map(x => `  ${x}`)
      .join("\n")
  );
  console.log("\n");
}

function usage() {
  const [, me] = process.argv;
  console.log(`Usage:
  list test payload ids : ${me} --list     [or] ${me} -l
  render random paylaod : ${me} --random   [or] ${me} -r
  render payload by id  : ${me} --id=theID [or] ${me} -i=theID

`);
  process.exit();
}
