"use strict";

const mkdirp = require("mkdirp");
const path = require("path");
const { logging } = require("@tapestry-ci/util");

const PROJECT_ROOT = path.resolve(process.env.CODEBUILD_SRC_DIR || process.env.PROJECT_ROOT || ".");
const ARTIFACT_ROOT = path.resolve(PROJECT_ROOT, "Artifacts");
const ARTIFACT_TEXT = path.resolve(ARTIFACT_ROOT, "CI-Log.txt");
const ARTIFACT_JSON = path.resolve(ARTIFACT_ROOT, "CI-Log.json-stream");

mkdirp.sync(ARTIFACT_ROOT);
logging.saveText(ARTIFACT_TEXT);
logging.saveJson(ARTIFACT_JSON);

const ciLogger = logging.logger("ci");

module.exports = ciLogger;
