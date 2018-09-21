"use strict";

const buildInfo = require("./build-info");
const logger = require("./logging").utilLogger("ci");

const AWS = require("aws-sdk");
const FETCH_DEFAULTS = { region: "us-west-2", filter: "running" };

const envReducer = (m, x) => Object.assign(m, { [x.name]: x.value });
const BANNED_ENV = ["TAPESTRY_START_CI_META", "NPM_TOKEN", "TAPESTRY_GITHUB_ACCESS_TOKEN"];
const transformEnv = vars => vars.filter(x => !BANNED_ENV.includes(x.name)).reduce(envReducer, {});

const NAMED_FILTERS = { all: () => true };

`
  running complete succeeded failed
  isDeploy isTest isPush isPullRequest isMerge
`
  .split(/\s+/)
  .filter(x => !!x.length)
  .forEach(x => (NAMED_FILTERS[x] = build => !!build[x]));

const _buildAge = build => ((Date.now() - new Date(build.startTime)) / 60000) | 0;

NAMED_FILTERS.recent = build => build.running || _buildAge(build) <= 60;

const SIMPLE_FILTERS = {
  by: user => build => build.startedBy === user,
  pr: num => build => build.isPullRequest && build.pullRequestId === num,
  push: branch => build => build.isPush && build.pushedTo === "branch",
  sha: hash => build => build.tapestry.commitId === hash,
  recent: mins => build => build.running || _buildAge(build) <= mins,
};

// prettier-ignore
const BAD_STRING_FILTER_ERROR = `options.filter must be either one of ${
  Object.keys(NAMED_FILTERS).join(", ")
} or one of ${
  Object.keys(SIMPLE_FILTERS)
    .map(x => `${x}:QUERY`)
    .join(", ")
}`;

function fetchBuild(codebuildId, _options = {}) {
  const options = Object.assign({}, FETCH_DEFAULTS, _options);
  const region = options.region;
  const cb = new AWS.CodeBuild({ region });

  return Promise.resolve()
    .then(() => cb.batchGetBuilds({ ids: [codebuildId] }).promise())
    .then(({ builds }) => (builds && builds.length ? makePretty(builds[0]) : null));
}

const SIMPLE_FILTER_REGEX = /^(.+?)\s*:\s*(.+)$/;
function fetchBuilds(_options = {}) {
  const options = Object.assign({}, FETCH_DEFAULTS, _options);
  const region = options.region;
  const cb = new AWS.CodeBuild({ region });

  if (typeof options.filter === "string") {
    const hasColon = options.filter.indexOf(":") > -1;
    const [, _flt, _arg] = hasColon ? SIMPLE_FILTER_REGEX.exec(options.filter) : [null, null, null];

    if (NAMED_FILTERS[options.filter]) options.filter = NAMED_FILTERS[options.filter];
    else if (_flt && SIMPLE_FILTERS[_flt]) options.filter = SIMPLE_FILTERS[_flt](_arg);
    else throw new Error(BAD_STRING_FILTER_ERROR);
  }

  return Promise.resolve()
    .then(() => {
      const params = { sortOrder: "DESCENDING" };
      if (options.project) {
        params.projectName = options.project;
        return cb.listBuildsForProject(params).promise();
      }
      return cb.listBuilds(params).promise();
    })
    .then(({ ids }) => cb.batchGetBuilds({ ids }).promise())
    .then(({ builds }) => builds.map(makePretty).filter(options.filter));
}

function fetchBuildsByProject(project, _options = {}) {
  const options = Object.assign({}, _options, { project });
  return fetchBuilds(options);
}

function fixUglyAWS(s) {
  return s.toLowerCase().replace(/_([a-z])/g, ([, l]) => l.toUpperCase());
}
function makePhasePretty(phaseRec) {
  const startTime = new Date(phaseRec.startTime);
  const endTime = phaseRec.endTime ? new Date(phaseRec.endTime) : null;
  const phase = fixUglyAWS(phaseRec.phaseType);
  const status = phase === "completed" ? "succeeded" : fixUglyAWS(phaseRec.phaseStatus || "[n/a]");
  const elapsed = phase === "completed" ? 0 : (endTime || new Date()) - startTime;

  const rec = { phase, status, startTime, endTime, elapsed };
  if (phase.contexts && phase.contexts.length) rec.ctx = phase.contexts;
  return rec;
}

const PRETTY_ENVVARS = {
  TAPESTRY_CI_STARTED_BY_WHOM: "startedBy",
  TAPESTRY_CI_STARTED_BY: "startedVia",
  TAPESTRY_CI_PULL_REQUEST_ID: "pullRequestId",
  TAPESTRY_CI_PULL_REQUEST_URL: "pullRequestURL",
  TAPESTRY_CI_PUSHED_TO: "pushedTo",
  TAPESTRY_CI_PUSH_TYPE: "pushType",
  TAPESTRY_CI_MERGED_FROM: "mergedFrom",
};

function makePretty(build) {
  const envVars = transformEnv(build.environment.environmentVariables);
  const tap = buildInfo.create.fromBuildStr(envVars.TAPESTRY_BUILD_STR);

  const startTime = tap.date; // use the tapestry start date, ever so slightly before the AWS one.
  const endTime = build.endTime ? new Date(build.endTime) : null;
  const elapsed = (endTime || new Date()) - startTime;

  const phases = (build.phases || []).map(makePhasePretty);

  const via = envVars.TAPESTRY_CI_STARTED_BY;
  const pushType = envVars.TAPESTRY_CI_PUSH_TYPE || "push"; // only valid when via===push

  const info = {
    phase: build.currentPhase.toLowerCase(),
    status: build.buildStatus.toLowerCase(),
    startTime,
    endTime,
    elapsed,
    codebuild: {
      id: build.id,
      project: build.projectName,
      sourceVersion: build.sourceVersion,
      region: build.arn.split(":")[3],
    },
    tapestry: tap,
    phases,
    envVars,
    logs: build.logs,
    codebuildArtifacts: build.artifacts,
    // later:
    // tapestryArtifacts: whatev, // look this up out of tapestry's future db mechanics?
    isDeploy: tap.buildMode === "full-deploy",
    isTest: tap.buildMode === "test-only",
    isPush: via === "push" && pushType === "push",
    isMerge: via === "push" && pushType === "pr-merge",
    isPullRequest: via === "pull-request",
    isReRun: via === "manual-restart",
    running: !build.buildComplete,
    complete: build.buildComplete,
    succeeded: build.currentPhase === "COMPLETED" && build.buildStatus === "SUCCEEDED",
    failed: build.currentPhase === "COMPLETED" && build.buildStatus !== "SUCCEEDED",
  };

  if (info.isReRun) {
    info.reRunCodebuild = envVars.TAPESTRY_CI_RE_RUN_OF_CODEBUILD;
    info.reRunBuildStr = envVars.TAPESTRY_CI_RE_RUN_OF_BUILD_STR;
    info.reRunOriginalDate = envVars.TAPESTRY_CI_RE_RUN_OF_ORIG_DATE;
  }

  Object.keys(PRETTY_ENVVARS).forEach(x => {
    if (envVars[x]) info[PRETTY_ENVVARS[x]] = envVars[x];
  });

  if (info.pullRequestURL && !info.pullRequestId)
    info.pullRequestId = info.pullRequestURL.split("/").pop();

  return info;
}

module.exports = { fetchBuilds, fetchBuildsByProject, fetchBuild, NAMED_FILTERS, SIMPLE_FILTERS };
