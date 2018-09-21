"use strict";

const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const zipper = require("I-NEED-A-ZIP-FILE-TOOLKIT");
const path = require("path");
const logger = require("./custom-logger").logger("util:artifacts");
const tapUtil = require("@tapestry-ci/util");
const AWS = require("aws-sdk");

let ARTIFACTS_DIR;

function save() {
  let section, name, data;

  if (arguments.length === 3) [section, name, data] = arguments;
  else [name, data] = arguments;

  const filepath = path.join(ARTIFACTS_DIR, ...(section ? [section, name] : [name]));
  const filedir = path.dirname(filepath);

  if (data instanceof fs.ReadStream) {
    logger.log(`Saving artifact ${path.relative(ARTIFACTS_DIR, filepath)}`);
    return new Promise((resolve, reject) => {
      fs
        .mkdirRecursive(filedir)
        .then(() => {
          const out = fs.createWriteStream(filepath);
          out.on("error", reject);
          data.on("close", resolve);
          data.pipe(out);
        })
        .catch(reject);
    });
  }

  const dataBuf =
    data instanceof Buffer
      ? data
      : typeof data === "string"
        ? Buffer.from(data, "utf8")
        : Buffer.from(JSON.stringify(data), "utf8");

  logger.log(`Saving artifact ${path.relative(ARTIFACTS_DIR, filepath)}`);
  return fs.mkdirRecursive(filedir).then(() => fs.writeFile(filepath, dataBuf));
}

function load(...args) {
  const filepath = path.join(ARTIFACTS_DIR, ...args);
  return fs.readFile(filepath);
}

function loadString(...args) {
  return load(...args).then(x => x.toString("utf8"));
}

function loadJson(...args) {
  return loadString(...args).then(JSON.parse);
}

function bundle() {
  logger.log(`Packaging ${ARTIFACTS_DIR}`);
  return zipper.zip(ARTIFACTS_DIR);
}

function init(buildDir) {
  ARTIFACTS_DIR = path.resolve(buildDir, "Artifacts");
  logger.log(`Initializing artifacts dir @ ${ARTIFACTS_DIR}`);
  return fs.mkdirRecursive(ARTIFACTS_DIR);
}

function upload(dir, reason) {
  logger.log(`Uploading artifacts bundle (${reason})`);

  // since other things call into artifacts, it bypasses local spec/subpackages and does a manual load from tapUtil. this:
  // * takes longer
  // * is safer.
  return Promise.all([
    bundle(),
    tapUtil.ciConfig(),
    tapUtil.serviceSpec.load(dir),
    tapUtil.subpackages.init(dir),
  ])
    .then(([zip, config, spec, sp]) => {
      const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
      const ctx = {
        project: spec.service.name,
        env: inf.env,
        buildMode: inf.buildMode,
        buildStr: process.env.TAPESTRY_BUILD_STR,
      };

      const loc = config.s3Location("builds.artifacts", ctx);
      const s3 = new AWS.S3({ region: config.region });
      const params = {
        Bucket: loc.Bucket,
        Key: loc.Key,
        Body: fs.createReadStream(zip),
      };

      const copyParams = {
        Bucket: loc.Bucket,
        Key: loc.Key.replace(/\.zip$/, `-${reason}.zip`),
        Body: fs.createReadStream(zip),
      };

      const surl = k => `s3://${loc.Bucket}/${k}`;
      const general = surl(loc.Key);
      const specific = surl(copyParams.Key);
      const hookName = "upload-artifacts";
      const hookOpts = {
        env: {
          TAPESTRY_HOOK_UPLOAD_ARTIFACTS_REASON: reason,
          TAPESTRY_HOOK_UPLOAD_ARTIFACTS_ZIP_S3_LOC: general,
          TAPESTRY_HOOK_UPLOAD_ARTIFACTS_INCREMENTAL_ZIP_S3_LOC: specific,
          TAPESTRY_HOOK_UPLOAD_ARTIFACTS_ZIP_LOCAL_FILE: zip,
        },
      };
      return (
        Promise.resolve()
          .then(() => sp.runBeforeHook(hookName, hookOpts))
          .then(() => logger.log(`uploading ${zip} to ${general}`))
          .then(() => s3.putObject(params).promise())
          // this used to call .copyObject(), but i'd rather upload twice than have to make sure .putObject and .copyObject permissions are everywhere 9_9
          .then(() => logger.log(`uploading ${zip} to ${specific}`))
          .then(() => s3.putObject(copyParams).promise())
          .then(() => sp.runAfterHook(hookName, hookOpts))
      );
    })
    .catch(e => {
      console.error(e.stack);

      logger.error("NON-FATAL ERROR WHILE UPLOADING ARTIFACTS", e);
    });
}

const getDir = () => ARTIFACTS_DIR;
const getPath = (...parts) => path.resolve(ARTIFACTS_DIR, ...parts);

module.exports = { init, save, load, loadString, loadJson, bundle, getDir, getPath, upload };
