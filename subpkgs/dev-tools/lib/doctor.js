"use strict";

const tapUtil = require("@tapestry-ci/util");
const helpers = require("./helpers");
const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const chalk = require("chalk");
const logger = tapUtil.logging.devLogger("doctor");
const queen = require("prom-queen");

function init(cmdr) {
  cmdr
    .command("doctor")
    .description("does some sanity checks on your repo")
    .action(options => command(cmdr, options));
}

async function command(cmdr, options = {}) {
  const cwd = process.cwd();

  await helpers.init(cwd, options, "project", "subpackages", "spec");
  const projRoot = options.project.root;
  const all = options.spec.deployments;
  const names = Object.keys(all);

  const errors = [];
  const warnings = [];

  const statuses = {
    ok: chalk.bold.green("✔ good!"),
    wrn: chalk.bold.yellow("▲ warning"),
    err: chalk.bold.red("✘ error"),
  };

  for (const name of names) {
    const def = all[name];
    logger.debug(`[check] ${name} : ${def.root}`);
    let status = "ok";
    const { warnings: defwrns, errors: deferrs } = await checkDef(name, def, all, names, options);
    if (defwrns.length) {
      status = "wrn";
      warnings.push(...defwrns);
    }
    if (deferrs.length) {
      status = "err";
      errors.push(...deferrs);
    }

    logger.log(`[check-result] ${name} ${statuses[status]}`);
  }

  await queen.sequential(options.subpackages.getPackages(), async pkg => {
    const pkgDir = path.resolve(projRoot, pkg.dir);
    const npmrc = path.resolve(pkgDir, ".npmrc");
    const npmrel = path.relative(projRoot, npmrc);
    const stat = await fs
      .stat(npmrc)
      .catch(e => (e.code === "ENOENT" ? { missing: true } : Promise.reject(e)));
    if (stat.missing) {
      warnings.push({
        name: pkg.dir,
        message: `has no ${npmrel} file. please add one containing 'package-lock = false'`,
      });
    } else {
      const lines = (await fs.readFile(npmrc, "utf8")).split(/\n/);
      const lockLine = lines.find(line => /^\s*package-lock\s*=\s*false/);
      if (!lockLine) {
        warnings.push({
          name: pkg.dir,
          message: `${npmrel} exists, but does not contain package-lock = false.`,
        });
      }
    }
    // logger.log("DERP", pkg);
  });

  for (const w of warnings) logger.warn(`[DOCTOR-WARNING] [${w.name}] ${w.message}`);

  if (errors.length) {
    for (const e of errors) logger.error(`[DOCTOR-ERROR] [${e.name}] ${e.message}`);

    const err = new Error(`doctor found ${errors.length} problems :( please fix these`);
    throw err;
  }

  if (warnings.length) logger.warn(`doctor detected ${warnings.length} warnings, but no errors!`);
  else logger.success(`doctor found no issues in ${projRoot}`);
}

async function checkDef(name, def, all, names, options) {
  const warnings = [];
  const errors = [];
  logger.debug(`check def ${name}`, def);
  const pkgDeps = Object.assign(
    {},
    def.package.json.dependencies || {},
    def.package.json.devDependencies || {},
    def.package.json.optionalDependencies || {}
  );
  const depKeys = Object.keys(pkgDeps);
  const projRoot = options.project.root;
  const defRoot = path.resolve(options.project.root, def.root);

  const depNonExact = [];
  const defPkgPretty = `${path.basename(projRoot)}/${def.package.path}`;

  for (const depKey of depKeys) {
    const depVal = pkgDeps[depKey];
    if (depVal.startsWith(".")) {
      const fullPath = path.resolve(defRoot, depVal);
      const relPath = path.relative(projRoot, fullPath);
      logger.debug(`${name} has local dependency: ${depKey}:${depVal}. checking ${relPath}`);

      const stat = await fs
        .stat(fullPath)
        .catch(e => (e.code === "ENOENT" ? { missing: true } : Promise.reject(e)));

      let curOk = true;
      if (stat.missing || !stat.isDirectory()) {
        curOk = false;
        errors.push({
          name: defPkgPretty,
          message: `${name} has broken local dependency ${chalk.bold.red(depKey)}: cannot find ${
            relPath
          }`,
        });
      }

      const depDef = Object.values(all).find(d => d.root === relPath);

      if (!depDef) {
        curOk = false;
        errors.push({
          name: defPkgPretty,
          message: `${name} has broken local dependency ${chalk.bold.red(
            depKey
          )}: no entry with root of ${relPath} defined in tapestry.service.hjson`,
        });
      }

      if (curOk) {
        const pname = depDef.package.json.name;
        if (pname !== depKey) {
          errors.push({
            name: defPkgPretty,
            message: `${name} has broken local dependency ${chalk.bold.red(depKey)}: ${chalk.bold(
              relPath
            )}'s package.name is ${chalk.bold.red(pname)}'`,
          });
        }
      }
    } else if (!/^\d+/.test(depVal)) {
      depNonExact.push({ depKey, depVal });
      /*
      warnings.push({
        name: defPkgPretty,
        message: `${name}: non-local dependency ${chalk.bold.yellow(
          depKey
        )} has non-exact version ${chalk.bold.yellow(depVal)}.`,
      });
      */
    }
  }

  if (depNonExact.length) {
    warnings.push({
      name: defPkgPretty,
      message: `detected non-exact dependency versions: ${depNonExact
        .map(({ depKey, depVal }) => `${chalk.bold(depKey)}:${depVal}`)
        .join(", ")}`,
    });
  }

  if (def.type === "npm") {
    if (!def.package.json.files || !Array.isArray(def.package.json.files))
      warnings.push({ name: def.root, message: `${def.root}/package.json has no files array!` });
  }

  // stuff
  return { warnings, errors };
}

module.exports = { init, command };
