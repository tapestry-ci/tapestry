"use strict";

// helper util used by scripts in bin/ to call the real command

const _logger = require("./custom-logger");
const logger = _logger.logger("util:runcmd");
const hookLogger = _logger.logger("util:runcmd:hooks");
const ensureProjectDir = require("./ensure-project-dir");
const path = require("path");
const subpackages = require("./subpackages");
const buildInfo = require("./build-info");
const artifacts = require("./artifacts");
const statusUpdate = require("./status-update");
const AWS = require("aws-sdk");
const tapUtil = require("@tapestry-ci/util");

const PROJECT_ROOT = path.resolve(process.env.CODEBUILD_SRC_DIR || process.env.PROJECT_ROOT || ".");

const _artprom = Promise.resolve()
  .then(() => artifacts.init(PROJECT_ROOT))
  .catch(e => {
    console.error("SERIOUS ERROR: COULD NOT INITIALIZE ARTIFACTS DIR?!", e.stack);
    process.exit(127);
  });

const COMMANDS = {
  "stash-dev-dependencies": require("./cmd/dependencies").stashCommand,
  "restore-dev-dependencies": require("./cmd/dependencies").restoreCommand,
  "install-dev-dependencies": require("./cmd/dependencies").installCommand,
  "do-deploys": require("./cmd/do-deploys").command,
  "do-migrations": require("./cmd/do-migrations").command,
  finalize: require("./cmd/finalize").command,
  "install-globals": require("./cmd/install-globals").command,
  "prepare-build-root": require("./cmd/prepare-build-root").command,
  "run-tests": require("./cmd/run-tests").command,
  "run-builds": require("./cmd/run-builds").command,
  "health-check": require("./cmd/health-check").command,
  "docs-build": require("./cmd/docs-build").command,
  "docs-publish": require("./cmd/docs-publish").command,
};

const BASIC_PHASES = {
  install: "prepare-build-root install-globals",
  prebuild: "install-dev-dependencies",
  build: "run-tests docs-build",
  postbuild: "finalize",
};

const PHASES = {
  "test-only": BASIC_PHASES,
  "full-deploy": Object.assign({}, BASIC_PHASES, {
    postbuild: `
      stash-dev-dependencies
      do-deploys
      restore-dev-dependencies
      do-migrations
      health-check
      docs-publish
      finalize
  `
      .replace(/\s+/g, " ")
      .trim(),
  }),
};

const doHook = (dir, name, type, isBefore) => {
  const _startedOrCompleted = isBefore ? "started" : "completed";
  const hook = `ci:${type}:${name}`;
  const hookMethod = isBefore ? "runBeforeHook" : "runAfterHook";
  const eventName = `${type}-${name}-${_startedOrCompleted}`;
  const _doEvent = () => buildInfo.addBuildEvent(dir, eventName);
  const _doScript = () => subpackages[hookMethod](dir, hook);
  hookLogger.log(`[run-hooks] ${hook} / ${eventName}`);
  return isBefore ? _doEvent().then(_doScript) : _doScript().then(_doEvent);
};

const run = cmdName => {
  const cmd = COMMANDS[cmdName];
  const dir = PROJECT_ROOT;

  const childLogger = logger;
  const fmt = require("./format-output")(childLogger.log, childLogger.error);
  let start = null;

  if (!cmd) {
    return Promise.reject(
      new Error(`no known command named ${cmdName}. available: ${Object.keys(COMMANDS).join(", ")}`)
    ).catch(e => (fmt.error(e, Date.now() - start), Promise.reject(e)));
  }

  return Promise.resolve()
    .then(() => ensureProjectDir.ensureProjectDir(dir))
    .then(() => _artprom) // make sure artifacts are ready
    .then(() => statusUpdate.sendStatus(`step:${cmdName}:start`))
    .then(() => doHook(dir, cmdName, "step", true))
    .then(() => logger.log(`[run:command] ${cmdName}`))
    .then(() => (start = Date.now()))
    .then(() => cmd(dir, childLogger.log, childLogger.error))
    .then(() => doHook(dir, cmdName, "step", false))
    .then(d => {
      fmt.success(null, Date.now() - start);
      return statusUpdate.sendStatus(`step:${cmdName}:complete`).then(() => d);
    })
    .catch(e => {
      fmt.error(e, Date.now() - start);
      return statusUpdate
        .sendError(`step:${cmdName}:error:${e.message}`, e)
        .then(() => Promise.reject(e));
    });
};

const runParallel = cmds => {
  logger.log(`[run:parallel] ${cmds.join(", ")}`);
  return Promise.all(cmds.map(run));
};
const runSequential = cmds => {
  logger.log(`[run:sequential] ${cmds.join(", ")}`);
  return cmds.reduce((p, cmd) => p.then(() => run(cmd)), Promise.resolve());
};

const runPhase = phaseName => {
  const buildMode = process.env.TAPESTRY_BUILD_MODE;
  if (!buildMode || !PHASES[buildMode]) {
    return Promise.reject(
      new Error(
        `invalid build mode ${buildMode}. set TAPESTRY_BUILD_MODE env var to test-only/full-deploy`
      )
    );
  }

  let phase = PHASES[buildMode][phaseName];
  if (typeof phase !== "string")
    return Promise.reject(new Error(`no phase named ${phaseName} in build mode ${buildMode}`));

  const dir = path.resolve(process.env.PROJECT_ROOT || ".");
  const beforeHook = () => doHook(dir, phaseName, "phase", true);
  const afterHook = () => doHook(dir, phaseName, "phase", false);
  const start = () => (phaseName === "install" ? statusUpdate.sendStarted() : Promise.resolve());
  const fin = () =>
    phaseName === "postbuild"
      ? statusUpdate.sendFinished().then(() => sendKinesisFinished())
      : Promise.resolve();
  let finalFail = null;

  const go = (fn, ...args) =>
    Promise.resolve()
      .then(start)
      .then(beforeHook)
      .then(() => fn(...args))
      .then(afterHook)
      .then(fin)
      .catch(e => {
        // "build" is special; if build fails, postbuild will always still run. postbuild, prebuild, and install errors are final.
        const whichMethod = phaseName === "build" ? "sendError" : "sendFailed";
        const doUpdate = () =>
          statusUpdate[whichMethod](`phase:${phaseName}:failure:${e.message}`, e);
        const doAfterUpdate =
          phaseName === "build" ? () => Promise.resolve() : () => sendKinesisFinished();
        finalFail = e;
        return doUpdate().then(doAfterUpdate);
      })
      // always upload artifacts after every phase
      .then(() => artifacts.upload(PROJECT_ROOT, `after-${phaseName}`))
      .then(() => (finalFail ? Promise.reject(finalFail) : Promise.resolve()));

  logger.log(`[run:phase] ${phaseName}`);

  if (typeof phase === "string") {
    if (phase === "") {
      phase = { type: "no-op" };
    } else {
      phase = phase.includes(" ")
        ? { type: "sequential", commands: phase.split(/\s+/) }
        : { type: "single", command: phase };
    }
  } else if (Array.isArray(phase)) {
    phase = { type: "sequential", commands: phase };
  }

  if (phase.type === "single") {
    return go(run, phase.command);
  } else if (phase.type === "parallel") {
    return go(runParallel, phase.commands);
  } else if (phase.type === "sequential") {
    return go(runSequential, phase.commands);
  } else if (phase.type === "no-op") {
    return go(() => {
      logger.log(`${phaseName} is a no-op in ${buildMode}`);
    });
  }

  return Promise.reject(new Error(`dont know phase type ${phase.type}`));
};

function sendKinesisFinished() {
  const { TAPESTRY_GITHUB_PROJECT: project, TAPESTRY_BUILD_STR: buildStr } = process.env;
  const payload = JSON.stringify({ project, buildStr });
  let cfg;
  return Promise.resolve()
    .then(() => tapUtil.ciConfig().then(c => (cfg = c)))
    .then(() => {
      const kinesis = new AWS.Kinesis({ region: cfg.region });
      const stream = cfg.deployments.buildFinishedKinesis;
      const params = { Data: payload, StreamName: stream, PartitionKey: buildStr };
      return kinesis.putRecord(params).promise();
    })
    .catch(e => {
      console.error(`ERROR DURING KINESIS FINISHED EVENT: ${e.stack || e}`);
    });
}

const exitClean = () => {
  logger.shutdown("success", "Command Succeeded 😎");
  process.exit();
};

const exitDirty = e => {
  logger.error("Error during command", e);
  logger.shutdown("error", "Command FAILED 😡 😡 😡");
  process.exit(127);
};

module.exports = {
  run,
  runPhase,
  runParallel,
  runSequential,
  exitClean,
  exitDirty,
  STEPS: Object.keys(COMMANDS),
  PHASES: Object.keys(PHASES["full-deploy"]),
};
