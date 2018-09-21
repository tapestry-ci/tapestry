"use strict";

const archives = require("./archives");
const buildInfo = require("./build-info");
const AWS = require("aws-sdk");
const fs = require("fs");
const logger = require("./logging").utilLogger("ci:start-ci");

const awsopt = {
  region: process.env.REGION || process.env.AWS_REGION || "us-west-2",
};
const codebuild = new AWS.CodeBuild(awsopt);
const s3 = new AWS.S3(awsopt);

const DEFAULTS = {
  buildMode: "test-only",
  envName: "none",
  addEnvVars: {},
};

function startCI(options) {
  const opts = Object.assign({}, DEFAULTS, options);
  return Promise.resolve()
    .then(() => fetchProject(opts.projectName).then(p => (opts.project = p)))
    .then(() =>
      archives
        .archive(opts.repoType, opts.sha, {
          repo: opts.repo,
          token: opts.token,
        })
        .then(z => (opts.zip = z))
    )
    .then(() => uploadZip(opts.project, opts.zip).then(r => (opts.version = r.VersionId)))
    .then(() => startBuild(opts));
}

function fetchProject(name) {
  return codebuild
    .batchGetProjects({ names: [name] })
    .promise()
    .then(r => r.projects[0] || null);
}

function uploadZip(project, zip) {
  if (project.source.type !== "S3")
    return Promise.reject(new Error(`${project.arn} is not an s3 codebuild project`));

  const [, Bucket, Key] = project.source.location
    .split(":")
    .pop()
    .match(/^([^\/]+)\/(.+)/);
  return s3.putObject({ Bucket, Key, Body: fs.createReadStream(zip) }).promise();
}

// {sha:x, buildMode:x, envName:x, project:{name:x}, artifactBucketName, addEnvVars, version, addEnvVars}

function startBuild(options) {
  const opts = Object.assign({}, DEFAULTS, options);
  const inf = buildInfo.create(opts.sha, new Date(), opts.buildMode, opts.envName);
  const params = buildInfo.codeBuildArgs({
    projectName: opts.project.name,
    artifactBucketName: opts.artifactBucketName,
    buildInfo: inf,
    addEnvVars: Object.assign({}, opts.addEnvVars || {}),
  });
  params.sourceVersion = opts.version; // override the source version to be s3 rather than commitid
  logger.debug("Starting codebuild", params);
  return codebuild.startBuild(params).promise();
}

module.exports = { startCI, start: startCI, startBuild };
