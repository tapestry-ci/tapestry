"use strict";

const tapUtil = require("@tapestry-ci/util");
const fecha = require("fecha");
const chalk = require("chalk");
const prettyMs = require("pretty-ms");
const Table = require("cli-table-redemption");
const util = require("util");
const fetch = require("HTTP-THING-GIMME-PLS");
const AWS = require("aws-sdk");
const crypto = require("crypto");
const queen = require("prom-queen");
const GithubApi = require("github");
const checksum = data =>
  crypto
    .createHash("sha512")
    .update(data)
    .digest("base64");

const { SIMPLE_FILTERS, NAMED_FILTERS, fetchBuild, fetchBuilds } = tapUtil.ciStatus;
const { StatusManager } = tapUtil.buildStatusUpdates;
const tbool = v => (v ? chalk.green.bold("✔") : chalk.red.bold("✘"));

const logger = tapUtil.logging.devLogger("ci");
const sameDay = (a, b) =>
  a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getYear() === b.getYear();

//TODO: this will change soon
const _BUILD_STATUS_URL_BASE =
  "https://BUILD-STATUS-URL.execute-api.us-west-2.amazonaws.com/dev/build-status/load";
const _buildQS = o =>
  Object.keys(o)
    .reduce((m, x) => [...m, `${x}=${encodeURIComponent(o[x])}`], [])
    .join("&");
// const buildStatusUrl = (project, buildStr) =>
//  `${_BUILD_STATUS_URL_BASE}?${_buildQS({ project, build: buildStr })}`;
const buildStatusUrl = (project, buildStr) => { throw new Error("this needs to be refactored! points at old, legacy lambda bs. needs to point at flexible biz"); }
const loadBuildStatus = (project, buildStr) =>
  fetch
    .json(buildStatusUrl(project, buildStr))
    .then(rec => {
      if (rec.buildReport) rec.buildReport = JSON.parse(rec.buildReport);
      return rec;
    })
    .catch(e => null);
const renderBuildStatusMarkdown = rec =>
  StatusManager.markdownSummary(rec, `by \`tapdev ci show ${rec.codebuildId} --markdown\``, true);

const WATCH_BANNER = chalk.cyan(
  "\n\n[ Running in watch mode. This display will refresh every 10 seconds. Press Ctrl-C to Exit. ]"
);

const SINGLES = {
  show: showSingleBuild,
  cloudwatch: launchCloudwatchLogs,
  logs: viewLogs,
  rerun: restartFinishedBuild,
  stop: stopRunningBuild,
};

const isSingle = name => !!SINGLES[name];

const TABLE_CHARS = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "",
  "left-mid": "",
  mid: "",
  "mid-mid": "",
  right: "",
  "right-mid": "",
  middle: "│",
};

const TABLE_CHARS_COLON = Object.assign({}, TABLE_CHARS, { middle: ":" });

const REQUIRES_ID = "[Requires a build-id]";
const doHilight = itm =>
  itm.replace(
    /^(\s+\w+)(?::\[(\w+)\])? \| ([^\[]+?)(?: \[(.+)\])?$/,
    (m, cmd, arg, desc, extra) => {
      const _B = chalk.bold;
      const cmdExt = arg ? _B.cyan(`:`) + _B.yellow(`[${arg}]`) : "";
      const descExt = extra ? _B.magenta(` [${extra}]`) : "";
      return `${_B.cyan(cmd)}${cmdExt}${chalk.bold.white(" | ")}${desc}${descExt}`;
    }
  );

function init(cmdr) {
  cmdr
    .command("ci-status [mode] [args]")
    .alias("ci")
    .description("show current status of ci projects")
    .option(
      "-i, --id <idstr>",
      "specify id to display. in most modes this can be passed as an additional argument. Can either be a full codebuild build-id or a fragment thereof. if multiple match, will return a list of matching, unless --first is also passed, in which case the first will be returned"
    )
    .option("--token <token>", "set github access token (for tapdev ci rerun)")
    .option(
      "-1, --first",
      "if this is a command that requires an id, and multiple ids match your id query, this will show the first matching"
    )
    .option(
      "-W, --watch",
      "in list modes, this causes the program to run in ci-monitoring mode, refreshing every 10s"
    )
    .option("-I, --inspect", "instead of table, display util.inspect() output [show mode only]")
    .option("-J, --json", "instead of table, raw JSON output [show mode only]")
    .option("-M, --markdown", "display build report markdown document [show mode only]")
    .option("-v, --verbose", "makes some commands show more output")
    .option("-m, --max <n>", "specify max number of records to receive", 25)
    .option(
      "-p, --project <name>",
      "specify project name. if not specififed, all projects will be queried. this should be the name of the codebuild project"
    )
    .on("--help", () => {
      console.log(
        [
          "",
          "No matter what option to --max is specified, this doesn't use any AWS pagination, so you'll get an absolute max of 100 records and the amount you will receive is not guaranteed, but is likely to be more than enough",
          "",
          "'mode' argument must be one of the following (if none specified, 'recent' will be used)",
          "",
          " [list modes]",
          "        recent | show running builds and any completed within the last hour",
          "           all | no filters. ",
          "       running | currently running ci builds. This is the default.",
          "      isDeploy | show deployment builds",
          "        isTest | show test-only (non-deployment) builds",
          "        isPush | builds started by a push",
          " isPullRequest | builds started by a pull request",
          "       isMerge | builds started by a merged pull request",
          "      complete | completed builds (success OR failiure)",
          "     succeeded | builds which have completed successfully",
          "        failed | builds which have completed with error",
          ` [single-build modes] `,
          `          show | show detailed information about a single build. ${REQUIRES_ID}`,
          `    cloudwatch | launches the logs for a particular build in your preferred web browser. ${REQUIRES_ID}`,
          `          logs | display or tail logs for a particular build in console. ${REQUIRES_ID}`,
          `          stop | stops a currently running CI build. ${REQUIRES_ID}`,
          `         rerun | re-runs an already-finished CI build. ${REQUIRES_ID}`,
          "",
          "In addition, the following query-modes will allow you to search by a particular field. examples: push:master, pr:123, by:username",
          "    by:[github_username] | started by a particular user",
          "    pr:[pull_request_id] | builds for a particular pull request by PR id #",
          "      push:[branch_name] | builds pushed to a particular branch name",
          "           sha:[git_sha] | builds resulting from a particular git sha",
          "        recent:[minutes] | show running builds and any completed within the the last X minutes",
        ]
          .map(doHilight)
          .join("\n")
      );
    })
    .action((mode, passedId, options) => command(cmdr, mode, passedId, options));
}

const CODEBUILD_ID_REGEX = /^([^:])+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
function singleBuildCommand(cmdr, mode, passedId, options) {
  if (!isSingle(mode)) return Promise.reject(new Error(`dont know how to ${mode}? wtf?`));

  let id = passedId || options.id;
  if (!id) {
    logger.error(`invalid codebuild id \`tapdev ci ${mode} --id CODEBUILD_BUILD_ID\``);
    logger.shutdown("error", "error in input");
    process.exit();
  }

  let build, report;
  return Promise.resolve()
    .then(() => {
      if (!CODEBUILD_ID_REGEX.test(id)) {
        return fetchBuilds({ filter: "all", project: options.project || null }).then(builds => {
          const matchingBuilds = builds.filter(b => b.codebuild.id.includes(id));
          const ct = matchingBuilds.length;
          if (ct > 1 && !options.first) {
            logger.shutdown("info", `multiple builds matched ${id}.`);
            console.log(
              `Please refine your search:\n${matchingBuilds
                .map(b =>
                  b.codebuild.id
                    .split(id)
                    .map(x => chalk.dim(x))
                    .join(chalk.bold.green(id))
                )
                .map(x => `    - ${x}`)
                .join(
                  "\n"
                )}\n\nYou can also pass \"--first\" to use the first result (currently ${chalk.bold.green(
                matchingBuilds[0].codebuild.id
              )})`
            );
            process.exit();
          } else if (ct === 1 || (options.first && ct > 1)) {
            const build = matchingBuilds[0];
            logger.info(`found match for ${id}: ${build.codebuild.id}`);
            id = build.codebuild.id;
          } else {
            logger.shutdown("error", `no builds matching id-fragment ${id}`);
            process.exit();
          }
        });
      }
    })
    .then(() => fetchBuild(id))
    .then(b => (build = b))
    .then(() => loadBuildStatus(build.envVars.TAPESTRY_GITHUB_PROJECT, build.tapestry.buildStr))
    .then(r => (report = r))
    .then(() => SINGLES[mode](build, report, options, id));
}

function command(cmdr, _mode, passedId, options = {}) {
  const mode = _mode || "recent";

  const hasColon = mode.indexOf(":") > -1;

  const [realMode] = mode.split(/\s*:\s*/); // if there's no colon this'll just be the whole string anyway

  if (isSingle(realMode)) return singleBuildCommand(cmdr, realMode, passedId, options);

  const [filters, filterType] = hasColon
    ? [SIMPLE_FILTERS, "Query Filter"]
    : [NAMED_FILTERS, "Filter"];

  if (!filters[realMode]) throw new Error(`no ${filterType} named ${realMode}`);

  const showResults = clearScreen =>
    fetchBuilds({ filter: mode, project: options.project || null })
      .then(builds => builds.slice(0, options.max))
      .then(builds => {
        if (clearScreen) {
          process.stdout.write(
            `\u001B[2J\u001B[0f${chalk.white.bold(
              `⚙️ tapdev ${process.argv.slice(2).join(" ")}\n`
            )}`
          );
        }
        if (builds.length) showBuilds(builds, options, realMode);
        else console.log(chalk.bold.yellow("[ no builds to display ]"));
      });

  if (options.watch) {
    logger.shutdown("info", `Beginning watch mode!`);
    const next = () =>
      showResults(true)
        .then(() => console.log(WATCH_BANNER))
        .then(() => queen.delayed(10000))
        .then(next);
    return next(false);
  }
  logger.shutdown("info", `Looking up builds!`);
  return showResults();
}

function fTime(build, field) {
  const t = build[field];
  const now = new Date();
  const fstr = t && sameDay(now, t) ? "h:mm a" : "M/D h:mm a";
  return t ? fecha.format(t, fstr) : chalk.dim("n/a");
}

function fTime2(d) {
  const t = d ? new Date(d) : null;
  const now = new Date();
  const fstr = t && sameDay(now, t) ? "h:mm a" : "M/D h:mm a";
  return t ? fecha.format(t, fstr) : chalk.dim("n/a");
}

function fDur(build, field) {
  const ms = build[field];
  return prettyMs(ms);
}

function fVia(build) {
  const C = chalk.cyan;
  const M = chalk.magenta;
  const Y = chalk.yellow;
  const B = chalk.blue;
  const CC = chalk.bold.cyan;
  const MM = chalk.bold.magenta;
  const YY = chalk.bold.yellow;
  const BB = chalk.bold.blue;

  if (build.isReRun) {
    const idfrag = build.reRunCodebuild.split(":")[1].split("-")[0];
    return B("re-run ") + BB(idfrag) + B(" @ ") + BB(fTime2(build.reRunOriginalDate));
  }

  if (build.isPullRequest) return C(`PR #`) + CC(build.pullRequestId);
  if (build.isPush) return Y(`push to `) + YY(build.pushedTo);
  if (build.isMerge) return M("Merge #") + MM(build.pullRequestId) + M("•") + MM(build.pushedTo);
  return build.startedVia;
}

function getColor(build) {
  const B = chalk.bold;
  if (build.running) return build.isDeploy ? B.magenta : B.white;
  if (build.isDeploy) return build.succeeded ? B.green : B.red;
  if (build.isTest) return build.succeeded ? B.cyan : B.yellow;
}

function showBuilds(builds, options, mode) {
  if (options.inspect) {
    logger.shutdown("success", `inspecting (${mode})`);
    console.log(util.inspect(builds, { depth: null, colors: true }));
    return;
  }

  if (options.json) {
    logger.shutdown("success", `displaying json (${mode})`);
    console.log(JSON.stringify(builds, null, 2));
    return;
  }

  const B = chalk.bold;
  const table = new Table({
    style: { head: ["white", "bold"], "padding-left": 1, "padding-right": 1 },
    chars: TABLE_CHARS,
    head: "id | project | status | mode | by | via | at".split(" | "),
    colAligns: ["right", "left", "left", "left", "left", "left", "left", "left", "left"],
  });
  for (const build of builds) {
    const color = getColor(build);
    const [prj, codebuildId] = build.codebuild.id.split(":");
    const [idChunk] = codebuildId.split("-");
    const shortEnv = build.tapestry.env.replace(/(uction|elopment)$/, "");
    const row = [
      color(idChunk),
      color(prj),
      color(build.status),
      build.isTest ? chalk.dim("run tests") : B.white(`deploy: ${shortEnv}`),
      build.startedBy,
      fVia(build),
      `${fTime(build, "startTime")} (${fDur(build, "elapsed")})`,
    ];
    table.push(row);
  }

  console.log(table.toString());
}

function getPhaseColor(phase) {
  if (phase.status === "succeeded") return chalk.bold.green;
  if (phase.status === "failed") return chalk.bold.red;
  return chalk.bold.yellow;
}

function prettyDescription(build) {
  const color = getColor(build);
  const _statusColor =
    build.status === "succeeded"
      ? chalk.bold.green
      : build.status === "failed"
        ? chalk.bold.red
        : chalk.bold;

  const _GG = chalk.bold.green;
  const _CC = chalk.bold.cyan;
  const _MM = chalk.bold.magenta;
  const _WW = chalk.bold.white;

  const _action = build.isDeploy
    ? `${_MM(`[ Deployment to `)}${_WW(build.tapestry.env)}${_MM(" ]")}`
    : _CC("[ build and run tests ]");
  const _commit = _GG(build.tapestry.commitId);
  const _who = _GG(build.startedBy);
  const _via = fVia(build);
  const _inf = `[ ${color(build.phase)} / ${_statusColor(build.status)} ]`;
  const _lcommit = chalk.dim("commitId");
  const _lby = chalk.dim("triggered by");
  const _lvia = chalk.dim("via");
  return [_action, _lcommit, _commit, _lby, _who, _lvia, _via, _inf].join(" ");
}

class FakeTable {
  constructor() {
    this.parts = [];
  }
  push(...a) {
    this.parts.push(...a);
  }
  toString() {
    return this.parts
      .map((x, idx) => this.renderPart(x, idx === 0, idx === this.parts.length - 1))
      .join("\n");
  }
  renderPart(part, first, last) {
    const line = "─".repeat(80);
    const [[key, value]] = Object.entries(part);
    const _frame = chalk.dim;
    const _hilite = chalk.bold;
    const _top = _frame(first ? "┌\n╞▶ " : "╞▶ "); // _frame(`╒${"═".repeat(50)}\n│ `);
    const _mid = ""; // _frame("├──\n");
    const _bot = `\n${_frame((last ? "└" : "├") + line)}`;
    const flbl = `${_hilite(`******** ${key} ********`)}\n`;
    const fbdy = `${value}`.replace(/^/gm, _frame("│  "));
    const formatted = [_top, flbl, _mid, fbdy, _bot].join("");
    return formatted;
  }
}

function showSingleBuild(build, report, options, id) {
  if (options.inspect) {
    logger.shutdown("success", `inspecting ${build.codebuild.id}`);
    console.log(
      util.inspect(options.verbose ? { build, report } : build, { depth: null, colors: true })
    );
    return;
  }

  if (options.json) {
    logger.shutdown("success", `displaying json for ${build.codebuild.id}`);
    console.log(JSON.stringify(options.verbose ? { build, report } : build, null, 2));
    return;
  }

  if (options.markdown) {
    logger.shutdown("success", `displaying markdown build report for ${build.codebuild.id}`);
    console.log(renderBuildStatusMarkdown(report));
    return;
  }

  const table = new FakeTable();

  table.push({ "ci operation": prettyDescription(build) });
  const _statusColor =
    build.status === "succeeded"
      ? chalk.bold.green
      : build.status === "failed"
        ? chalk.bold.red
        : chalk.bold;

  Object.keys(build).forEach(key => {
    const val = build[key];
    if (["startTime", "endTime", "phases", "phase", "status"].includes(key)) {
      /* no-op : these have special display elsewhere above or below */
    } else if (key === "elapsed") {
      const phaseTable = new Table({
        chars: TABLE_CHARS,
        style: { head: ["cyan"], "padding-left": 1, "padding-right": 1 },
        head: ["phase", "status", "start", "end", "elapsed"],
        colAligns: ["right", "center", "center", "center", "left"],
      });
      build.phases.forEach(phase => {
        const phaseColor = getPhaseColor(phase);
        const _phase = phaseColor(phase.phase);
        const _status = phaseColor(phase.status);
        const _stime = fTime(phase, "startTime");
        const _etimex = fTime(phase, "endTime");
        const _etime = phase.endTime
          ? _etimex
          : phase.phase === "completed"
            ? _stime
            : chalk.dim("[running]");
        const _elaps = fDur(phase, "elapsed");
        phaseTable.push([_phase, _status, _stime, _etime, _elaps]);
      });

      const _T_stime = fTime(build, "startTime");
      const _T_etimex = fTime(build, "endTime");
      const _T_etime = build.endTime ? _T_etimex : chalk.dim("[running]");
      const _T_elaps = fDur(build, "elapsed");
      phaseTable.push(new Array(5).fill(chalk.dim("─────────")));
      phaseTable.push([
        chalk.bold.yellow("TOTAL"),
        _statusColor(build.status),
        _T_stime,
        _T_etime,
        _T_elaps,
      ]);

      table.push({ timing: phaseTable.toString() });
    } else if (key === "logs") {
      table.push({ logs: build.logs.deepLink });
    } else if (key === "codebuildArtifacts" && build.codebuildArtifacts.location) {
      table.push({
        artifacts: build.codebuildArtifacts.location.replace("arn:aws:s3:::", "s3://"),
      });
    } else if (typeof val === "boolean") {
      /* no-op */
    } else if (typeof val === "string") {
      table.push({ [key]: val });
    } else if (Array.isArray(val)) {
      table.push({ [key]: val.map(x => util.inspect(x)).join("\n") });
    } else {
      const objTable = new Table({
        chars: TABLE_CHARS_COLON,
        style: { head: ["cyan"], "padding-left": 1, "padding-right": 1 },
        colAligns: ["left", "left"],
      });
      for (const key2 in val) {
        const val2 = val[key2];
        if (val2 instanceof Date) objTable.push({ [key2]: fTime({ v: val2 }, "v") });
        else if (key2 === "elapsed") objTable.push({ [key2]: fDur({ v: val2 }, "v") });
        else objTable.push({ [key2]: val2 });
      }
      table.push({ [key]: objTable });
    }
  });

  const lbool = (v, k) => (v ? chalk.bold.green(k) : chalk.dim(k));
  const flagsTxt = Object.keys(build)
    .filter(k => typeof build[k] === "boolean")
    .reduce((m, x) => [...m, `${tbool(build[x])} ${lbool(build[x], x)}`], [])
    .join("\n");

  const flagsTable = new Table({
    chars: TABLE_CHARS_COLON,
    style: { head: ["cyan"], "padding-left": 1, "padding-right": 1 },
    colAligns: ["left", "left"],
  });
  for (const key in build) {
    const val = build[key];
    if (typeof val === "boolean") flagsTable.push({ [key]: tbool(val) });
  }
  table.push({ flags: flagsTxt });

  if (report && report.status) {
    const RS_COLORS = {
      deployed: chalk.bold.green,
      published: chalk.bold.cyan,
      error: chalk.bold.red,
      skipped: chalk.dim,
    };
    const BS_COLORS = {
      success: chalk.bold.green,
      pending: chalk.bold.white,
      error: chalk.bold.magenta,
      failure: chalk.bold.red,
    };

    const reportTable = obj => {
      const _rtbl = new Table({
        chars: TABLE_CHARS,
        style: { head: ["cyan"], "padding-left": 1, "padding-right": 1 },
        head: ["name", "type", "status", "version", "time"],
        colAligns: ["left", "center", "center", "center", "left"],
      });

      Object.keys(obj).forEach(name => {
        const _r = obj[name];
        const clr = RS_COLORS[_r.status];
        _rtbl.push(
          [
            name,
            _r.plan.type,
            _r.status,
            _r.plan.version.shortVersion,
            fTime2(_r.plan.version.deploymentTime),
          ].map(x => clr(x))
        );
      });

      return _rtbl.toString();
    };
    table.push({
      buildStatus: [report.status, report.message, fTime2(report.eventDate)]
        .map(x => BS_COLORS[report.status](x.replace(/\n.*$/gm, "")))
        .join(chalk.bold.white(" ● ")),
    });

    if (options.verbose) {
      const _bevtable = new Table({
        chars: TABLE_CHARS,
        style: { head: ["cyan"], "padding-left": 1, "padding-right": 1 },
        head: ["time", "status", "msg", "elapsed"],
        colAligns: ["right", "left", "left", "left"],
      });

      report.buildEvents.forEach(item => {
        _bevtable.push([
          fTime2(item.eventDate),
          item.status,
          item.message.replace(/\n.*$/gm, ""),
          prettyMs(item.elapsed),
        ]);
      });

      table.push({ buildEvents: _bevtable });
    } else {
      table.push({
        buildEvents:
          chalk.cyan("this build contains ") +
          chalk.bold.cyan(report.buildEvents.length) +
          chalk.cyan(" build events. pass --verbose to see them."),
      });
    }

    const ALLREP = Object.assign(
      {},
      (report.buildReport || {}).publishResults || {},
      (report.buildReport || {}).deploymentResults || {}
    );
    if (Object.keys(ALLREP).length) table.push({ deployReport: reportTable(ALLREP) });
    if (report.hasErrors && report.errors && Array.isArray(report.errors)) {
      if (options.verbose) {
        report.errors.forEach((error, index) => {
          table.push({
            [`Error #${index + 1}`]: `${fTime2(error.eventDate)}\n${error.stack}`,
          });
        });
      } else {
        table.push({
          Errors:
            chalk.red("this build contains ") +
            chalk.bold.red(report.errors.length) +
            chalk.red(" build errors. pass --verbose to see them."),
        });
      }
    }
  }

  logger.shutdown("success", build.codebuild.id);
  console.log(table.toString());
}

function launchCloudwatchLogs(build, report, options) {
  logger.log(`launching cloudwatch logs for ${options.id} | ${build.logs.deepLink}`);
  return tapUtil.executor.exec(`open "${build.logs.deepLink}"`).then(r => {
    if (options.verbose) logger.log("results", r);

    logger.shutdown("success", "exiting");
    process.exit();
  });
}

function showLogsOnly(build, report, options) {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2";
  const logs = new AWS.CloudWatchLogs({ region });

  const _processChunk = next => {
    const params = {
      logGroupName: build.logs.groupName,
      logStreamName: build.logs.streamName,
      startFromHead: true,
    };
    if (next) params.nextToken = next;
    return Promise.resolve()
      .then(() => logs.getLogEvents(params).promise())
      .then(results => {
        const idChunk = build.codebuild.id
          .split(":")
          .join(" ")
          .split("-")[0];
        console.log(build.codebuild.id, idChunk);
        results.events.forEach(item => sendMessage(idChunk, item));
        if (results.events.length && results.nextForwardToken)
          return _processChunk(results.nextForwardToken);
        return;
      });
  };

  logger.shutdown(
    "success",
    `fetching logs for ${build.logs.groupName} / ${build.logs.streamName}`
  );
  return _processChunk().then(() => process.exit());
}

function viewLogs(build, report, options) {
  if (build.complete) return showLogsOnly(build, report, options);

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2";
  const logs = new AWS.CloudWatchLogs({ region });
  let latest = 0;
  const seen = {};
  const _processChunk = (next, startTime) => {
    const params = {
      logGroupName: build.logs.groupName,
      logStreamName: build.logs.streamName,
      startFromHead: true,
      startTime: latest,
    };
    if (next) params.nextToken = next;
    return Promise.resolve()
      .then(() => logs.getLogEvents(params).promise())
      .then(results => {
        results.events.forEach(item => {
          if (item.timestamp > latest) latest = item.timestamp;
          const sum = checksum([item.timestamp, item.ingestionTime, item.message].join(":"));
          if (seen[sum]) return;
          const idChunk = build.codebuild.id
            .split(":")
            .join(" ")
            .split("-")[0];
          sendMessage(idChunk, item);
          seen[sum] = true;
        });
        if (results.events.length && results.nextForwardToken)
          return _processChunk(results.nextForwardToken);
        return fetchBuild(build.codebuild.id).then(b => {
          build = b;
          if (build.complete) return Promise.resolve();
          return queen.delayed(1000).then(() => _processChunk());
        });
      });
  };

  return _processChunk().then(() => process.exit());
}

function restartFinishedBuild(build, report, options) {
  if (!build.complete) {
    logger.shutdown("error", `build ${report.buildStr} is not yet complete! cannot re-run!`);
    process.exit();
  }

  const token = options.token || process.env.TAPESTRY_GITHUB_ACCESS_TOKEN || null;
  const sha = build.tapestry.commitId;
  if (!token) {
    logger.error(`
please set the env var TAPESTRY_GITHUB_ACCESS_TOKEN to a valid github
auth token, or pass it as --token FOO. You can get one by going to :
  github.com -> settings -> developer settings -> personal access tokens
`);
    process.exit();
  }

  const github = new GithubApi();
  github.authenticate({ type: "token", token });
  let myUser;

  const addEnvVars = Object.keys(build.envVars).reduce(
    (m, x) =>
      /STARTED|BUILD_STR|DATE|RE_RUN|TOKEN|CONFIG_LOCATION/.test(x)
        ? m
        : Object.assign(m, { [x]: build.envVars[x] }),
    {}
  );

  const startOptions = {};
  return Promise.resolve()
    .then(() => github.users.get({}).then(r => (myUser = r.data)))
    .then(() => {
      addEnvVars.TAPESTRY_CI_STARTED_BY = "manual-restart";
      addEnvVars.TAPESTRY_CI_STARTED_BY_WHOM = myUser.login;
      addEnvVars.TAPESTRY_CI_RE_RUN_OF_CODEBUILD = build.codebuild.id;
      addEnvVars.TAPESTRY_CI_RE_RUN_OF_BUILD_STR = build.tapestry.buildStr;
      addEnvVars.TAPESTRY_CI_RE_RUN_OF_ORIG_DATE = build.tapestry.dateISO;
      Object.assign(startOptions, {
        sha,
        buildMode: build.tapestry.buildMode,
        envName: build.tapestry.env,
        project: { name: build.codebuild.project },
        version: build.codebuild.sourceVersion,
        addEnvVars,
      });
      return tapUtil.startCI.startBuild(startOptions);
    })
    .then(result => {
      const evars = result.build.environment.environmentVariables.reduce(
        (m, x) => Object.assign(m, { [x.name]: [x.value] }),
        {}
      );
      let deets = `• old codebuild id • ${build.codebuild.id}
• old build str    • ${build.tapestry.buildStr}
• new codebuild id • ${result.build.id}
• new build str    • ${evars.TAPESTRY_BUILD_STR}
• build mode       • ${evars.TAPESTRY_BUILD_MODE}
• deployment env   • ${evars.TAPESTRY_ENV}
• source version   • ${result.build.sourceVersion}
• git sha          • ${sha}
• started at       • ${fTime2(result.build.startTime)}
• started by       • ${evars.TAPESTRY_CI_STARTED_BY_WHOM} (${result.build.initiator})`;

      if (evars.TAPESTRY_CI_PULL_REQUEST_URL) {
        deets += `
• pull request     • ${evars.TAPESTRY_CI_PULL_REQUEST_URL}`;
      }

      logger.log(`Start results:`, deets);
      logger.shutdown("success");
    });
}

function stopRunningBuild(build, report, options) {
  if (build.complete) {
    logger.shutdown("error", `build ${report.buildStr} is not running. Can't stop.`);
    process.exit(127);
  }

  const codebuild = new AWS.CodeBuild({ region: process.env.AWS_REGION || "us-west-2" });
  return Promise.resolve()
    .then(() => codebuild.stopBuild({ id: build.codebuild.id }).promise())
    .then(r => {
      logger.shutdown("success", `stopped ${build.codebuild.id}`);
    });
}

const pcolon = color => x =>
  x
    ? x
        .split(":")
        .map(z => chalk[color].bold(z))
        .join(chalk.dim(":"))
    : x;

function sendMessage(id, item) {
  let message = item.message.replace(/\n+$/, "");
  const tapMsg = /^(tapestry:\S+) \| (\w+) > (.+)$/.exec(message);
  const fix = pcolon(tapMsg && tapMsg[2] === "error" ? "red" : "cyan");
  if (tapMsg) {
    const [, sect, level, msg] = [...tapMsg];
    message = `${fix(sect)}${chalk.dim(" | ")}${chalk.cyan(level)}${chalk.dim(" > ")}${msg}`;
  }
  console.log(
    `${chalk.dim.white("[")}${chalk.white(id)} ${chalk.cyan(
      fTime2(item.timestamp)
    )}${chalk.dim.white("]")} ${message}`
  );
}

module.exports = { init, command };
