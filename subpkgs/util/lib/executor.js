"use strict";

const padStream = require("pad-stream");
const execa = require("execa");
const chalk = require("chalk");
const logger = require("./logging").utilLogger("exec");
const lsyms = logger.constructor._symbols;
const joiner = (...a) => logger[lsyms.Joiner](...a);
const path = require("path");
const sander = require("sander");

const SHOULD_VERBOSE = process.env.TAPESTRY_VERBOSE_SHELL_OUTPUT || process.env.TAPESTRY_BUILD_STR;
const VERBOSE_WARNING = `Tapestry Shell-Command output has been surpressed. Set the env var TAPESTRY_VERBOSE_SHELL_OUTPUT to view. This message is only shown once.`;
let VERBOSE_WARNED = false;
const checkWarn = () => {
  if (!VERBOSE_WARNED && !SHOULD_VERBOSE) {
    VERBOSE_WARNED = true;
    logger.warn(VERBOSE_WARNING);
  }
};

const prefixes = outbase => {
  const pretty = (label, color) => joiner("pfx", "info") + chalk[color](`[${label}] `);
  const ugly = label => `[${outbase} : ${label}] `;
  const fmt = (label, color) => (logger.isVanilla ? ugly : pretty)(label, color);
  return { stdout: fmt("stdout", "cyan"), stderr: fmt("stderr", "yellow") };
};

const STATE = {
  saveOutput: checkInitialStateSaveValue(),
  idx: 0,
  start: Date.now(),
};

const setOutputDir = d => (STATE.saveOutput = d);
const prettyidx = () => `${++STATE.idx}`.padStart(5, "0");
const prettypid = c => `${c.pid}`.padStart(6, "0");
const prettypids = (...a) => a.map(prettypid);
const prettycmd = c => `${c.slice(0, 40)}`.replace(/[^A-Za-z0-9_-]+/g, "_");
const prettydate = () => new Date().toISOString().replace(/\D+/g, "");
const nextfile = (cmd, opts = {}, c) =>
  [prettydate(), ...prettypids(process, c), prettyidx(), opts.label || "cmd", prettycmd(cmd)]
    .filter(x => !!x)
    .join("-");

async function save(outbase, info, slug) {
  logger.debug(`[${outbase}] ${slug}`, info);
  if (!STATE.saveOutput) return;
  const outfile = path.resolve(STATE.saveOutput, outbase, `${slug}.json`);
  await sander.writeFile(outfile, JSON.stringify(info), { encoding: "utf8" });
}

async function savePre(outbase, info) {
  await save(outbase, info, "info");
}
async function savePost(outbase, info) {
  const { code } = info.execaResult;
  const wasok = code === 0 ? "succeeded" : "failed";
  await save(outbase, info, `results-${wasok}-${code}`);
  if (!STATE.saveOutput) return;
  for (const type of ["stderr", "stdout"]) {
    const where = path.resolve(STATE.saveOutput, outbase, `${type}.txt`);
    const data = info.execaResult[type];
    await sander.writeFile(where, data, { encoding: "utf8" });
  }
}

function timings(info, isEnd) {
  const now = Date.now();
  return Object.assign(
    info,
    { eventTime: now },
    isEnd
      ? {
          endTime: now,
          elapsed: now - info.startTime,
          parentElapsedAtEnd: now - STATE.start,
        }
      : {
          startTime: now,
          parentStartTime: STATE.start,
        }
  );
}

async function exec(cmd, options = {}) {
  checkWarn();

  const execaOptions = {
    reject: false,
    stdio: "pipe",
    env: options.env || process.env,
    cwd: options.dir || process.cwd(),
  };
  const child = execa.shell(cmd, execaOptions);

  const outbase = nextfile(cmd, options, child);
  const outinfpre = timings({
    cmd,
    idx: STATE.idx,
    options,
    execaOptions,
    executorState: STATE,
    pid: child.pid,
  });

  if (SHOULD_VERBOSE) {
    if (STATE.saveOutput) logger.log(`cmd logs: ${STATE.saveOutput}/${outbase}`);
    logger.log("use env var TAPESTRY_HIDE_SHELL_OUTPUT to suppress command output");
    if (logger.isVanilla) {
      logger.log(`run ${cmd} in ${execaOptions.cwd}`);
    } else {
      console.log(joiner("pre", "info"));
      console.log(
        `${joiner("pfx", "info")}${chalk.bold.green("RUN")} ${chalk.bold(cmd)} ${chalk.bold.yellow(
          "IN"
        )} ${execaOptions.cwd}`
      );
    }
    const pipe = T => child[T].pipe(padStream(1, prefixes(outbase)[T])).pipe(process[T]);
    pipe("stderr");
    pipe("stdout");
  }

  await savePre(outbase, outinfpre);
  const execaResult = await child;
  if (SHOULD_VERBOSE && !logger.isVanilla) console.log(joiner("post", "info"));
  const outinfpost = timings(Object.assign(outinfpre, { execaResult }), true);
  await savePost(outbase, outinfpost);
  if (execaResult instanceof Error || execaResult.code !== 0) throw execaResult; // execaResult is an error instance
  return execaResult;
}

function checkInitialStateSaveValue() {
  const { CODEBUILD_SRC_DIR: cbdir, TAPESTRY_DEV_SAVE_OUTPUT: tdev } = process.env;
  if (cbdir) return path.resolve(cbdir, "Artifacts", "Commands");
  if (tdev === "1") return path.resolve(os.tmpdir(), tapdev);
  if (tdev) return path.resolve(tdev);
  return null;
}

module.exports = { exec, setOutputDir };

if (require.main === module) {
  exec("ls; ls /fghjsdklg")
    .then(r => logger.success("done", r))
    .catch(r => logger.error("uh-oh", r));
}
