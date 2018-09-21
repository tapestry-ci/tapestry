"use strict";

const tapUtil = require("@tapestry-ci/util");
const helpers = require("./helpers");
const Table = require("cli-table-redemption");
const chalk = require("chalk");
const figlet = require("figlet");
const logger = tapUtil.logging.devLogger("spec");

const sorter = (a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0);

function init(cmdr) {
  cmdr
    .command("service-spec")
    .alias("spec")
    .description(
      "displays the compiled version of the tapestry service specification file for this project (tapestry.service.*)"
    )
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();

  return Promise.resolve()
    .then(() => helpers.init(cwd, options, "subpackages", "spec"))
    .then(() => {
      const all = options.spec.deployments;
      const get = chk =>
        Object.keys(all)
          .filter(n => chk(all[n], n))
          .map(name => ({ name, def: all[name] }))
          .sort(sorter);

      const packages = get(def => def.type === "npm");
      const bundles = get(def => def.type !== "npm");
      logger.shutdown(
        "info",
        `found ${packages.length} packages and ${Object.keys(bundles).length} deployments`
      );
      showPackageTable(packages);
      showBundleTable(bundles);
    });
}

const tbool = v => (v ? chalk.green.bold("✔") : chalk.red.bold("✘"));
const tlist = l =>
  l.length ? l.map(x => chalk.white.bold(x)).join("\n") : chalk.yellow.bold("[none]");

function tableTitle(title) {
  console.log(chalk.magenta.bold(figlet.textSync(`[ ${title} ]`, { font: "Thin" })));
}

function showPackageTable(packages) {
  tableTitle("npm packages");
  const table = new Table({
    style: { head: ["cyan", "bold"] },
    head: ["", "auto\nversion", "locals", "package.json\nfiles array"],
  });
  for (const { def, name } of packages) {
    // console.log("\n\n", name, def, "\n\n");
    const firstCol = [
      `name : ${chalk.white(name)}`,
      `npm  : ${chalk.yellow(def.package.json.name)}`,
      `root : ${chalk.white(`./${def.root}`)}`,
    ].join("\n");
    table.push({
      [firstCol]: [
        def.autoversion,
        tlist(Object.keys(def.package.locals)),
        def.package.json.files
          ? tlist(def.package.json.files)
          : [chalk.red.bold("Potential Problem:")]
              .concat(["no 'files' entry", "in package.json"].map(z => chalk.bold.magenta(z)))
              .join("\n"),
      ],
    });
  }

  console.log(table.toString());
}

function showBundleTable(bundles) {
  tableTitle("deployments");
  const table = new Table({
    style: { head: ["cyan", "bold"] },
    head: ["", "type", "has\npkg?", "auto\nversion", "files", "locals"],
  });
  for (const { def, name } of bundles) {
    const row = [
      def.type,
      tbool(def.packageJson),
      def.autoversion,
      tlist(def.files),
      def.packageJson ? tlist(Object.keys(def.package.locals)) : "no-pkg-json",
    ];
    table.push({ [def.root]: row });
  }
  console.log(table.toString());
}

module.exports = { init, command };
