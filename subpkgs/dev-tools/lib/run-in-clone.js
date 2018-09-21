"use strict";

const tapUtil = require("@tapestry-ci/util");
const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const tempfile = require("tempfile");
const queen = require("prom-queen");
const execa = require("execa");
const chalk = require("chalk");
const del = require("del");
const readdir = require("readdir-enhanced");

const highlight = x => chalk.yellow(`"${x}"`);
const highlightNum = x => chalk.cyan(`${x}`);

const _rejecto = m => Promise.reject(new Error(m));

const hasPathComponent = (str, chunk) => str.split(path.sep).includes(chunk);
const banned = p => hasPathComponent(p, ".git") || hasPathComponent(p, "node_modules");
const desc =
  "executes a set of arbitrary commands within a cloned copy of the current " +
  "tapestry project. will not copy anything in a .git or node_modules folder";

const logger = tapUtil.logging.devLogger("cloner");

function init(cmdr) {
  cmdr
    .command("run-in-clone <commands-string>")
    .alias("cloned")
    .option("-k, --keep", "Don't delete temporary work folder once finished")
    .option(
      "-o, --output [directory]",
      "Instead of a randomly generated folder name, use the named directory instead. " +
        "The specified path must not yet exist unless --delete is also passed. " +
        "Implies --keep`"
    )
    .option(
      "-d, --delete",
      "When run with --output, deletes the specified output folder if it already exists. " +
        "If this option is not passed and the target folder exists, this command will fail."
    )
    .description(desc)
    .action((commands, options) => command(cmdr, commands, options));
}

function ensureNoExist(pathname) {
  return fs
    .stat(pathname)
    .catch(e => (e.code === "ENOENT" ? null : Promise.reject(e)))
    .then(f => (f ? _rejecto(`${pathname} already exists!`) : pathname));
}

const SCAN_FILES_OPTS = {
  filter: stat => !stat.isDirectory() && !banned(stat.path),
  deep: stat => !banned(stat.path),
};
const SCAN_DIRS_OPTS = {
  filter: stat => stat.isDirectory() && !banned(stat.path),
  deep: stat => !banned(stat.path),
};

function command(cmdr, commands, options) {
  let files, dirs, project, targetDir, isTmp;
  const cwd = process.cwd();
  if (options.output) {
    targetDir = options.output;
    isTmp = null;
    options.keep = true;
  } else {
    isTmp = true;
  }

  return Promise.resolve()
    .then(() => tapUtil.project.findProjectAndChdir(cwd).then(p => (project = p)))
    .then(() => (isTmp ? (targetDir = tempfile(`.clone.${path.basename(project.root)}`)) : null))
    .then(() => readdir(project.root, SCAN_FILES_OPTS).then(f => (files = f)))
    .then(() => readdir(project.root, SCAN_DIRS_OPTS).then(d => (dirs = d)))
    .then(() => {
      if (isTmp || options.delete) {
        logger.log(`pre-deleting ${highlight(targetDir)} (if exists)`);
        return del([targetDir], { force: true });
      }
      return ensureNoExist(targetDir);
    })
    .then(() => logger.log(`Creating cloned version at ${highlight(targetDir)}`))
    .then(() => fs.mkdirRecursive(targetDir))
    .then(() =>
      logger.log(
        `Copying ${highlightNum(dirs.length)} dirs and ${highlightNum(files.length)} files...`
      )
    )
    .then(() => queen.sequential(dirs, dir => createDir(project.root, targetDir, dir, logger)))
    .then(() => queen.sequential(files, file => copyFile(project.root, targetDir, file, logger)))
    .then(() => logger.log(`Running ${highlight(commands)} in ${highlight(targetDir)}`))
    .then(() =>
      execa.shell(commands, {
        cwd: targetDir,
        reject: false,
        stdio: "inherit",
        env: process.env,
      })
    )
    .then(results =>
      // results.stderr.split("\n").forEach(x => x && logger.error(x));
      // results.stdout.split("\n").forEach(x => x && logger.log(x));
      cleanup(targetDir, options.keep, logger).then(() => {
        if (results.code !== 0)
          return _rejecto(`"${commands}" exited with status code ${results.code}`);
      })
    );
}

function cleanup(targetDir, shouldKeep, logger) {
  if (!shouldKeep) {
    logger.log(`Done! cleaning up ${targetDir}...`);
    return del([targetDir], { force: true });
  }
  logger.log(`Done! Output stored in ${targetDir}!`);
  return Promise.resolve();
}

function copyFile(input, output, file, logger) {
  const src = path.resolve(input, file);
  const dst = path.resolve(output, file);
  const dirname = path.dirname(dst);
  logger.debug(`copy ${file}...`);
  return Promise.resolve()
    .then(() => fs.mkdirRecursive(dirname))
    .then(() => fs.copy(src, dst))
    .then(() => fs.lstat(src))
    .then(stat => fs.chmod(dst, stat.mode));
}

function createDir(input, output, dir, logger) {
  const src = path.resolve(input, dir);
  const dst = path.resolve(output, dir);
  logger.debug(`mkdir ${dir}...`);
  return Promise.resolve()
    .then(() => fs.mkdirRecursive(dst))
    .then(() => fs.lstat(src))
    .then(stat => fs.chmod(dst, stat.mode));
}

module.exports = { init, command };
