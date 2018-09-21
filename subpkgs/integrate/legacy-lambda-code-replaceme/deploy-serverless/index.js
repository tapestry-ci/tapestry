"use strict";

const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const zipper = require("I-NEED-A-ZIP-FILE-TOOLKIT");
const AWS = require("aws-sdk");
const tempfile = require("tempfile");
const tapUtil = require("@tapestry-ci/util");

tapUtil.events.on("message", (...a) => console.log("[tapestry:util]", ...a));

function fetchToBuffer(state, loc) {
  const s3 = new AWS.S3({ region: state.config.region });
  const params = { Bucket: loc.Bucket, Key: loc.Key };
  console.log("FETCHING WITH S3:", params);
  return s3
    .getObject(params)
    .promise()
    .then(res => res.Body);
}

function loadPlan(state) {
  return fetchToBuffer(state, state.event.plan)
    .then(buf => JSON.parse(buf.toString("utf8")))
    .then(plan => (state.plan = plan))
    .then(() => console.log("plan fetched"));
}

function unbundle(state) {
  const file = tempfile(".zip");
  const buildroot = tempfile(".deploy");
  const builddir = path.resolve(buildroot, "build");
  const buildnm = path.resolve(buildroot, "node_modules");
  const ournm = path.resolve(__dirname, "node_modules");
  let out = builddir;
  return (
    Promise.resolve()
      .then(() => fetchToBuffer(state, state.event.bundle))
      .then(buf => fs.writeFile(file, buf))
      .then(() => fs.mkdirRecursive(buildroot))
      // symlink our own node_modules into the parent folder
      .then(() => fs.symlink(ournm, buildnm))
      .then(() => zipper.unzip(file, builddir).then(f => (out = f)))
      .then(() => fs.unlink(file))
      .then(() => (state.execOpts.dir = out))
      .then(() => console.log(`unzipped to ${out}`))
  );
}

function prepareServerless(state) {
  state.serverlessPath = path.resolve(__dirname, "node_modules", "serverless", "bin", "serverless"); // doesnt like it when we call via the symlink
  return Promise.resolve();
}

function fakeHome(state) {
  state.fakeHome = tempfile(".fake-home-dir");
  state.execOpts.env.HOME = state.fakeHome;
  return fs.mkdirRecursive(state.fakeHome);
}

function loadConfig(state) {
  return Promise.resolve()
    .then(() => console.log("attempting to load ci config"))
    .then(() => tapUtil.ciConfig())
    .then(cfg => (state.config = cfg))
    .then(() => console.log("CI config loaded"))
    .then(() => {
      const creds = state.config.deployCreds(state.event.env);
      const deploymentEnvVars = {
        AWS_ACCESS_KEY_ID: creds.access,
        AWS_SECRET_ACCESS_KEY: creds.secret,
        AWS_REGION: creds.region,
        AWS_DEFAULT_REGION: creds.region,
      };

      state.execOpts.env = deploymentEnvVars;
      console.log("deployment credentials set");
    });
}

function serverlessArgs(state) {
  const env = state.event.env;
  return `--stage ${env === "development" ? "dev" : env}`;
}
z;
function deploy(event, context) {
  const state = { event, execOpts: {} };
  const prepSteps = [loadPlan, unbundle, prepareServerless, fakeHome];
  const prepare = step => step(state);
  const prepareAll = () => Promise.all(prepSteps.map(prepare));
  const worker = () => {
    const args = serverlessArgs(state);
    const cmd = `${state.serverlessPath} deploy ${args}`;
    return tapUtil.executor.exec(cmd, state.execOpts);
  };

  return loadConfig(state)
    .then(prepareAll)
    .then(worker);
}

module.exports = {
  handler: (event, context, callback) => {
    console.log("DEPLOY-SERVERLESS-EVENT", event);
    return deploy(event, context)
      .then(r => callback(null, r))
      .catch(callback);
  },
};
