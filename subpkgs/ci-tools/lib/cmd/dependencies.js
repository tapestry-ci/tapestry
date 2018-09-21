"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");
const queen = require("prom-queen");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");

const subpackages = require("../subpackages");
const logger = require("../custom-logger").logger("cmd:dev-deps");

const TMP_ROOT = (() => {
  const CBROOT = "/codebuild/output";
  const OSTMP = os.tmpdir();
  try {
    const stat = fs.statSync(CBROOT);
    return stat.isDirectory() ? CBROOT : OSTMP;
  } catch (e) {
    return OSTMP;
  }
})();
const md5 = txt =>
  crypto
    .createHash("md5")
    .update(txt)
    .digest("hex");
const tapdir = () =>
  path.resolve(
    TMP_ROOT,
    process.env.TAPESTRY_BUILD_STR
      ? `tapestry-deps.${process.env.TAPESTRY_BUILD_STR}`
      : `tapestry-dependency-mapping`
  );

const doAll = async (dir, func) => queen.parallel(await subpackages.getPackages(dir), func);
const modulesdir = pkg => path.resolve(pkg.root, pkg.dir, "node_modules");
const stashdir = pkg => path.resolve(tapdir(), md5(modulesdir(pkg)));
const ENOENT_TO_FALSE = e => (e.code === "ENOENT" ? false : Promise.reject(e));
const exists = d =>
  fs
    .stat(d)
    .then(() => true)
    .catch(ENOENT_TO_FALSE);
const move = async (d1, d2) => (await exists(d1)) && fs.rename(d1, d2);

async function stashCommand(dir) {
  logger.log(`[stash] stashing all for ${dir}`);
  await fs.mkdirRecursive(tapdir());
  await doAll(dir, async pkg => {
    const mdir = modulesdir(pkg);
    const sdir = stashdir(pkg);
    if (!(await exists(mdir))) return false;
    logger.log(`[stash] ${mdir} -> ${sdir}`);
    return await move(mdir, sdir);
  });
}

async function restoreCommand(dir) {
  logger.log(`[restore] restoring all modules for ${dir}`);
  await doAll(dir, async pkg => {
    const mdir = modulesdir(pkg);
    const sdir = stashdir(pkg);
    const mbck = path.resolve(path.dirname(mdir), "backup.node_modules");
    if (!(await exists(sdir))) return false;
    if (await exists(mdir)) {
      logger.log(`[restore] existing ${mdir} found, moving to ${mbck}`);
      await move(mdir, mbck);
    }
    logger.log(`[restore] ${sdir} -> ${mdir}`);
    return await move(sdir, mdir);
  });
}

async function installCommand(dir) {
  logger.log("[install] installing dependencies");
  return await subpackages.doDevInstalls(dir);
}

module.exports = { stashCommand, restoreCommand, installCommand };
