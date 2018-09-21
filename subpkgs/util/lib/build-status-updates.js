"use strict";

const _buildInfo = require("./build-info");
const uuid = require("uuid");
const _rejecto = m => Promise.reject(new Error(m));
const logger = require("./logging").logger("builds");
const prettyMs = require("pretty-ms");
const fecha = require("fecha");

const syms = {
  doUpdate: Symbol("send status updates to all status-update consumers."),
  doDatabaseUpdate: Symbol("send status updates to mongodb 'buildStatus' collection (always)"),
  doGithubUpdate: Symbol("send status updates to github status api (if appropriate)"),
  doConsoleUpdate: Symbol("send status updates to console.log via tap-utils logger"),
  doOtherUpdates: Symbol("send any updates registered externally using StatusManager.register()"),
  getUpsertQuery: Symbol("generate the upsert query required to upsert an event into a document"),
  query: Symbol("canonical query to find the full build info for a specific buildStr / id"),
  base: Symbol("the basic information that should be a part of every build record in the db"),
  priv: Symbol("object holding various private state (db handles, etc)"),
  extras: Symbol("additional status-update hooks mgr[syms.doOtherUpdates]() calls these"),
};

const _hasErrors = rec => {
  const str = `build had ${rec.errors.length} errors`;
  return [str, new Error(str)];
};

const _brIsPending = rec => rec.status === "pending";
const _brHasErrors = rec =>
  rec.hasErrors && rec.errors && Array.isArray(rec.errors) && rec.errors.length;
const _brIsSuccess = rec => !_brHasErrors(rec);
const _brHasPublishes = rec =>
  rec.buildReport &&
  rec.buildReport.publishResults &&
  Object.keys(rec.buildReport.publishResults).length;
const _brHasDeploys = rec =>
  rec.buildReport &&
  rec.buildReport.deploymentResults &&
  Object.keys(rec.buildReport.deploymentResults).length;
const _brDate = x => {
  const d = x instanceof Date ? x : new Date(x);
  return ["ddd, MMM D, YYYY", "hh:mm:ssa"].map(s => fecha.format(d, s)).join(" at ");
};
const _brMdRow = ary => `| ${ary.join(" | ")} |`;
const _brMdTbl = (hdrs, rows) =>
  ["", _brMdRow(hdrs), _brMdRow(hdrs.map(x => "---")), ...rows.map(row => _brMdRow(row)), ""].join(
    "\n"
  );

const _brMdErrors = errs => errs.map((itm, idx) => `${idx + 1}. `);

const _brMdResultsTbl = results =>
  _brMdTbl(
    ["name", "type", "status", "version", "last deployed at"],
    Object.entries(results).map(([name, _r]) => {
      console.log("WTF", name, _r);
      return [
        (_r.plan.packageJson && _r.plan.package && _r.plan.package.name) || name,
        _r.plan.type,
        _r.status,
        _r.plan.version.shortVersion,
        _brDate(_r.plan.version.deploymentTime),
      ];
    })
  );

const buildReportMarkdown = (rec, generatedAppend, showPending) => `

# Build Results: ${rec.project} - ${rec.buildStr}
_[[ generated: ${_brDate(new Date())}${generatedAppend ? ` ${generatedAppend}` : ""} ]]_

## Summary

${_brMdTbl(
  ["name", "val"],
  [
    ["Github Project", rec.project],
    ["Build Mode", rec.buildMode],
    ["Build/Deployment Environment", rec.env],
    ["Codebuild ID", rec.codebuildId],
    [
      "Status",
      (showPending && _brIsPending(rec) ? "running " : "complete ") + _brIsSuccess(rec)
        ? "(Success)"
        : "(Failure)",
    ],
    ...(_brHasErrors(rec) ? [["Error Count", rec.errors.length]] : []),
    ["Started", _brDate(new Date(rec.buildDate))],
    ["Duration", prettyMs(rec.elapsed)],
  ]
)}

## Build Event Timeline

${_brMdTbl(
  ["event id", "status", "time", "elapsed", "message"],
  rec.buildEvents.map(x => [
    x.eventId,
    x.status,
    _brDate(x.eventDate),
    prettyMs(x.elapsed),
    x.message,
  ])
)}

${_brHasErrors(rec) ? `\n## Build Errors\n\n${_brMdErrors(rec.errors)}\n\n` : ""}

${
  _brHasPublishes(rec)
    ? `\n## NPM Publish Results\n\n${_brMdResultsTbl(rec.buildReport.publishResults || {})}\n\n`
    : ""
}

${
  _brHasDeploys(rec)
    ? `\n## Deployment Results\n\n${_brMdResultsTbl(rec.buildReport.deploymentResults || {})}\n\n`
    : ""
}

`;

class StatusManager {
  static register(handler) {
    if (!this[syms.extras]) this[syms.extras] = [];
    this[syms.extras].push(handler);
  }

  static markdownSummary(rec, generatedAppend, showPending) {
    return buildReportMarkdown(rec, generatedAppend, showPending);
  }

  constructor(project, buildStr, monkClient, githubApiClient) {
    if (
      !monkClient ||
      !monkClient.get ||
      !monkClient.create ||
      !monkClient.constructor ||
      monkClient.constructor.name !== "Manager"
    )
      throw new Error("deployment manager must be given a 'monk' (mongodb client) instance.");

    this[syms.priv] = {};
    this.project = project;
    this.buildStr = buildStr;
    this.buildInfo = _buildInfo.create.fromBuildStr(buildStr);
    this[syms.priv].monkClient = monkClient;
    this[syms.priv].statusDb = this[syms.priv].monkClient.get("buildStatus");
    this[syms.priv].githubApiClient = githubApiClient;
  }

  get elapsed() {
    return Date.now() - this.buildInfo.date;
  }

  get elapsedPretty() {
    return prettyMs(this.elapsed);
  }

  sendStarted() {
    return this[syms.doUpdate]("pending", "Tapestry-CI Started!");
  }

  sendFinished() {
    return this.load().then(
      rec =>
        rec.hasErrors
          ? this.sendFailed(..._hasErrors(rec))
          : this[syms.doUpdate]("success", "Tapestry-CI Finished Successfully")
    );
  }

  sendFailed(message, error) {
    return this[syms.doUpdate]("failure", `Tapestry-CI Finished with Errors: ${message}`, error);
  }

  sendStatus(message, opts = {}) {
    return this[syms.doUpdate]("pending", message, opts);
  }

  sendError(message, error) {
    return this[syms.doUpdate]("error", message, { error });
  }

  load() {
    return this[syms.priv].statusDb.findOne(this[syms.query]).then(r => r || this[syms.base]);
  }

  get [syms.query]() {
    const project = this.project;
    const buildStr = this.buildStr;
    return { project, buildStr };
  }

  get [syms.base]() {
    return {
      project: this.project,
      buildStr: this.buildStr,
      buildMode: this.buildInfo.buildMode,
      buildDate: this.buildInfo.date,
      commitId: this.buildInfo.commitId,
      env: this.buildInfo.env,
      codebuildId: process.env.CODEBUILD_BUILD_ID,
    };
  }

  [syms.getUpsertQuery](status, message, opts = {}) {
    const eventDate = Date.now();
    const eventId = uuid.v4();
    const _event = () =>
      Object.assign(
        { status, message, eventDate, eventId, elapsed: this.elapsed },
        opts.error ? { hasErrors: true } : {},
        opts.meta || {}
      );
    const _errEvent = error =>
      Object.assign(_event(), {
        message: error.message,
        stack: error.stack,
        eventMessage: message,
      });
    const $set = Object.assign({}, this[syms.base], _event());
    const $push = { buildEvents: _event() };

    if (opts.error) {
      $set.hasErrors = true;
      $push.buildEvents.hasErrors = true;
      $push.errors = _errEvent(opts.error);
    }

    return { $set, $push };
  }

  [syms.doDatabaseUpdate](status, message, opts = {}) {
    const db = this[syms.priv].statusDb;
    const query = this[syms.query];
    const action = this[syms.getUpsertQuery](status, message, opts);
    const updateOpts = { upsert: true };
    return db.update(query, action, updateOpts);
  }

  [syms.doGithubUpdate](status, message, opts = {}) {
    if (!this[syms.priv].githubApiClient) return Promise.resolve();
    const region = process.env.AWS_REGION;
    const codebuildId = process.env.CODEBUILD_BUILD_ID;
    if (!codebuildId) return Promise.resolve();
    const sha = this.buildInfo.commitId;
    const githubrepo = this.project;
    const [owner, repo] = githubrepo.split("/");
    const elapsed = this.elapsedPretty;
    const context = "Tapestry-CI";
    const target_url = `https://${region}.console.aws.amazon.com/codebuild/home?region=${region}#/builds/${codebuildId}/view/new`;
    let description = `${message} (Elapsed: ${elapsed})`;
    if (description.length > 140) description = `${description.slice(0, 135)} ...`;
    const params = { state: status, context, description, target_url, owner, repo, sha };
    const client = this[syms.priv].githubApiClient;
    return client.repos.createStatus(params).catch(e => {
      console.error("GITHUB UPDATE FAILED:", e.stack || e);
    });
  }

  [syms.doOtherUpdates](status, message, opts = {}) {
    const items = this.constructor[syms.extras] || [];
    const info = this[syms.getUpsertQuery](status, message, opts).$set;
    const call = func => Promise.resolve(func(info, opts)).catch(e => {});
    return Promise.all(items.map(call));
  }

  [syms.doConsoleUpdate](status, message, opts = {}) {
    if (opts.error) logger.error(`[status:${status}] ${message}`, opts.error);
    else logger.log(`[status:${status}] ${message}`, ...(opts.data || []));
    return Promise.resolve();
  }

  [syms.doUpdate](status, message, opts = {}) {
    const errs = [];
    const noerr = e => {
      errs.push(e);
    };
    return Promise.all([
      this[syms.doDatabaseUpdate](status, message, opts).catch(noerr),
      this[syms.doGithubUpdate](status, message, opts).catch(noerr),
      this[syms.doConsoleUpdate](status, message, opts).catch(noerr),
      this[syms.doOtherUpdates](status, message, opts).catch(noerr),
    ]).then(() => {
      if (errs.length) {
        const msgs = errs.map(x => x.message).join(" ::: ");
        const msg = `received ${errs.length} errors: ${msgs}`;
        errs.forEach(x => logger.error("status-update error", x));
        return _rejecto(msg);
      }

      return this.load();
    });
  }
}

function manage(project, buildStr, monkClient, githubApiClient) {
  return new StatusManager(project, buildStr, monkClient, githubApiClient);
}

module.exports = { manage, StatusManager };
