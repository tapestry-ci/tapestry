"use strict";

const _nextVersion = require("./next-version");
const _buildInfo = require("./build-info");
const timestring = require("timestring");
const _rejecto = m => Promise.reject(m instanceof Error ? m : new Error(m));
const logger = require("./logging").utilLogger("deployments");
const debug = (...a) => logger.debug(...a);

const { DEFAULT_ENV_TAGS } = require("./definitions");

const $T = str => timestring(str, "ms"); // helper

const syms = {
  // for tapestry-ci-tools
  createBuildJob: Symbol("BuildJob: create"),
  checkBuildJob: Symbol("BuildJob: check"),
  waitForBuildJob: Symbol("BuildJob: waitFor"),

  // for tapestry-buildbot
  startBuildJob: Symbol("BuildJob: start"),
  isStartedBuildJob: Symbol("BuildJob: isStarted"),
  updateBuildJob: Symbol("BuildJob: update"),
  completeBuildJobWithSuccess: Symbol("BuildJob: completed successfully"),
  completeBuildJobWithError: Symbol("BuildJob: completed with error"),

  // totally internal
  updateVersion: Symbol("Update a version record"),
};

class DeploymentManager {
  constructor(serviceName, deploymentType, deploymentName, mongoClient, envTags) {
    Object.assign(this, {
      serviceName,
      deploymentType,
      deploymentName,
      mongoClient,
      envTags,
    });

    if (
      !mongoClient ||
      !mongoClient.get ||
      !mongoClient.create ||
      !mongoClient.constructor ||
      mongoClient.constructor.name !== "Manager"
    )
      throw new Error("deployment manager must be given a 'monk' (mongodb client) instance.");

    this.deploymentsDb = this.mongoClient.get("deployments");
    this.buildJobsDb = this.mongoClient.get("deploymentBuilds");
  }

  get deploymentId() {
    return `${this.serviceName}:${this.deploymentType}:${this.deploymentName}`;
  }

  getEnvTag(forEnv) {
    if (typeof this.envTags[forEnv] === "undefined") return forEnv;
    return this.envTags[forEnv];
  }

  getVersionInfo(version) {
    const versionField = version.includes("+") ? "fullVersion" : "shortVersion";
    const qry = { deploymentId: this.deploymentId, [versionField]: version };
    return this.deploymentsDb.findOne(qry);
  }

  allVersions() {
    const qry = { deploymentId: this.deploymentId };
    return this.deploymentDb.find(qry);
  }

  checkVersions(targetVersion, onlyDeployed = false, fullResults = true) {
    const qry = { deploymentId: this.deploymentId, targetVersion };
    if (onlyDeployed) qry.status = "deployed";
    const fields = fullResults ? {} : { fullVersion: 1 };
    const xform = fullResults ? x => x : x => x.fullVersion;
    const postprocess = results => results.map(xform);
    return this.deploymentsDb.find(qry, fields).then(postprocess);
  }

  checkLatest(targetVersion, forEnv) {
    const getVersion = lst => {
      const latest = _nextVersion.checkLatest(lst, targetVersion, this.getEnvTag(forEnv));
      if (latest) return this.getVersionInfo(latest);
      return Promise.resolve(null);
    };

    return Promise.all([
      this.checkVersions(targetVersion, false, false),
      this.checkVersions(targetVersion, true, false),
    ])
      .then(r => Promise.all(r.map(getVersion)))
      .then(r => ({ latest: r[0], latestDeployed: r[1] }));
  }

  nextVersion(targetVersion, forEnv, extraVersions = []) {
    const append = extraVersions.filter(x => x.startsWith(targetVersion));
    return Promise.resolve()
      .then(() => this.checkVersions(targetVersion, false, false))
      .then(list => list.concat(append))
      .then(list => _nextVersion(list, targetVersion, this.getEnvTag(forEnv)));
  }

  createVersion(shortVersion, buildStr, fingerprint) {
    const buildInfo = _buildInfo.create.fromBuildStr(buildStr);
    const fullVersion = `${shortVersion}+${buildStr}`;
    const targetVersion = shortVersion.split(".", 2).join(".");
    const item = Object.assign({}, buildInfo, {
      serviceName: this.serviceName,
      deploymentId: this.deploymentId,
      deploymentName: this.deploymentName,
      deploymentType: this.deploymentType,
      deploymentTime: new Date().toISOString(),
      buildDate: buildInfo.dateISO,
      environment: buildInfo.env,
      fingerprint,
      shortVersion,
      fullVersion,
      targetVersion,
      buildStr,
      status: "pending",
    });

    return this.deploymentsDb.insert(item).then(() => this.getVersionInfo(fullVersion));
  }

  createNextVersion(targetVersion, forEnv, buildStr, fingerprint, extraVersions = []) {
    return Promise.resolve()
      .then(() => this.nextVersion(targetVersion, forEnv, extraVersions))
      .then(version => this.createVersion(version, buildStr, fingerprint));
  }

  [syms.updateVersion](versionObj, updateSpec) {
    const qry = { deploymentId: this.deploymentId, fullVersion: versionObj.fullVersion };
    return this.deploymentsDb
      .findOneAndUpdate(qry, { $set: updateSpec })
      .then(() => this.getVersionInfo(versionObj.fullVersion));
  }

  recordDeploymentSuccess(versionObj) {
    return this[syms.updateVersion](versionObj, {
      status: "deployed",
      deploymentEndTime: new Date(),
    });
  }

  recordDeploymentFailure(versionObj, error) {
    return this[syms.updateVersion](versionObj, {
      status: "failed",
      deploymentEndTime: new Date(),
      error: getError(error),
    });
  }

  buildJob(fullVersion) {
    // mostly for convenience for external use. Tapestry always uses the proper .buildJobForWhatever() internally
    return Object.assign({}, this.buildJobForCI(fullVersion), this.buildJobForBots(fullVersion));
  }

  buildJobForCI(fullVersion) {
    // called by CI engine
    return {
      create: (...a) => this[syms.createBuildJob](fullVersion, ...a),
      check: (...a) => this[syms.checkBuildJob](fullVersion, ...a),
      wait: (...a) => this[syms.waitForBuildJob](fullVersion, ...a),
    };
  }

  buildJobForBots(fullVersion) {
    // called by BuildBot
    return {
      start: (...a) => this[syms.startBuildJob](fullVersion, ...a),
      isStarted: (...a) => this[syms.isStartedBuildJob](fullVersion, ...a),
      update: (...a) => this[syms.updateBuildJob](fullVersion, ...a),
      success: (...a) => this[syms.completeBuildJobWithSuccess](fullVersion, ...a),
      error: (...a) => this[syms.completeBuildJobWithError](fullVersion, ...a),
    };
  }

  [syms.createBuildJob](fullVersion, meta = {}) {
    const status = "requested";
    const date = new Date();
    const buildJob = {
      fullVersion,
      deploymentId: this.deploymentId,
      serviceName: this.serviceName,
      deploymentType: this.deploymentType,
      deploymentName: this.deploymentName,
      createdAt: date,
      status,
      meta,
      date,
      started: false,
      complete: false,
      history: [{ date, status, meta, elapsed: 0 }],
    };

    [buildJob.shortVersion, buildJob.buildStr] = buildJob.fullVersion.split("+");

    const qry = { fullVersion, deploymentId: this.deploymentId };

    return Promise.resolve()
      .then(() => this.buildJobsDb.findOne(qry))
      .then(res => (res ? _rejecto("Can not create a build job that already exists!") : null))
      .then(() => this.buildJobsDb.insert(buildJob))
      .then(() => this.buildJobsDb.findOne(qry));
  }

  [syms.checkBuildJob](fullVersion) {
    const qry = { fullVersion, deploymentId: this.deploymentId };
    return this.buildJobsDb.findOne(qry);
  }

  [syms.updateBuildJob](fullVersion, status, meta = {}, extra = {}) {
    const vstr = fullVersion.replace(/\+.+/, "");
    logger.log(`[build-job ${this.deploymentId} @ ${vstr}] ${status}`);

    return this[syms.checkBuildJob](fullVersion)
      .then(job => {
        const date = new Date();
        const elapsed = date - new Date(job.createdAt);
        const evt = () => Object.assign({ date, status, meta, elapsed }, extra);
        const action = { $set: evt(), $push: { history: evt() } };
        const qry = { fullVersion, deploymentId: this.deploymentId };
        return this.buildJobsDb.findOneAndUpdate(qry, action);
      })
      .then(() => this[syms.checkBuildJob](fullVersion));
  }

  [syms.startBuildJob](fullVersion, meta = {}) {
    const extra = { started: true };
    return this[syms.updateBuildJob](fullVersion, "started", meta, extra);
  }

  [syms.isStartedBuildJob](fullVersion) {
    return this[syms.checkBuildJob](fullVersion).then(job => {
      if (!job || !job.history.find(x => x.status === "started")) return false;

      return true;
    });
  }

  [syms.completeBuildJobWithSuccess](fullVersion, meta = {}) {
    const extra = { complete: true, success: true };
    return this[syms.updateBuildJob](fullVersion, "success", meta, extra);
  }

  [syms.completeBuildJobWithError](fullVersion, error, meta = {}) {
    const extra = { complete: true, success: false, error: error.stack };
    return this[syms.updateBuildJob](fullVersion, "error", meta, extra);
  }

  [syms.waitForBuildJob](
    fullVersion,
    pollTime = $T("10sec"),
    startTimeout = $T("5min"),
    completeTimeout = $T("20min")
  ) {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const elapsedPretty = () => `${elapsed()}ms`;
    const tooSlowStart = () => elapsed() > startTimeout;
    const tooSlowComplete = () => elapsed() > completeTimeout;
    const hasStatus = (j, s) => j.history.find(i => i.status === s);
    const prefix = () =>
      `[waitForBuildJob: ${fullVersion} @ ${this.deploymentId}: ${elapsedPretty()}]`;
    const sleep = n => new Promise(r => setTimeout(r, n));

    const _errNoJob = () => _rejecto(`${prefix()} Could not find build job.`);
    const _errTooSlow = () =>
      _rejecto(`${prefix()} did not complete within timeout (${completionTimeout}ms)!`);
    const _errUnstarted = () =>
      _rejecto(`${prefix()} did not start within timeout (${startTimeout}ms)!`);

    const poll$ = () =>
      Promise.resolve()
        .then(() => debug(`${prefix()} polling...`))
        .then(() => this[syms.checkBuildJob](fullVersion))
        .then(job => {
          debug(`${prefix()} poll result: `, job);

          if (!job) return _errNoJob();

          if (job.complete) {
            logger.log(`${prefix()} Job complete`);
            return Promise.resolve(job);
          }

          if (tooSlowComplete()) {
            debug(`${prefix()} Too slow to complete`);
            return _errTooSlow();
          }

          if (!hasStatus(job, "started") && tooSlowStart()) {
            debug(`${prefix()} Too slow to start`);
            return _errUnstarted();
          }

          return sleep(pollTime).then(poll$);
        });

    logger.log(`${prefix()} Waiting for build to complete`);
    return poll$();
  }
}

function getError(e) {
  if (!e) return "Unknown error";

  if (e instanceof Error) return e.stack;

  if (typeof e === "string") return e;

  if ("stack" in e) return e.stack;

  // pretending to be an Error ?
  try {
    return `Unknown error: ${JSON.stringify(e)}`;
  } catch (x) {}

  try {
    return `Unknown error: ${Object.prototype.toString.call(e)}`;
  } catch (x) {}

  return "Unknown error";
}

function manage(...args) {
  return new DeploymentManager(...args);
}

function manageById(deploymentId, client, envTags = DEFAULT_ENV_TAGS) {
  const [service, type, name] = deploymentId.split(":");
  return manage(service, type, name, client, envTags);
}

module.exports = { manage, manageById, DeploymentManager };
