"use strict";

const tapUtil = require("@tapestry-ci/util");
const chalk = require("chalk");
const _rejecto = m => Promise.reject(new Error(m));

const logger = tapUtil.logging.devLogger("ci");

function init(cmdr) {
  cmdr
    .command("start-ci <sha> [envName] [buildMode]")
    .option(
      "-t, --token <token>",
      "specify github access token. can also set env var TAPESTRY_GITHUB_ACCESS_TOKEN. required for github builds",
      process.env.TAPESTRY_GITHUB_ACCESS_TOKEN
    )
    .option(
      "-l, --local <repo>",
      "specify a filesystem path to a local git repository. either --local or --global is required."
    )
    .option(
      "-g, --github <repo>",
      "specify the name of a github repository in format user-or-organization-name/repo-name. either --local or --global is required."
    )
    .option("-p, --project <name>", "specify codebuild project name. required.")
    .description("prepares production dependencies (including tapestry local-dependencies)")
    .on("--help", () => {
      console.log(
        [
          "",
          "sha       : anything supported by `git archive` if --local, or by github's zipball api if --github",
          "buildMode : either 'test-only' or 'full-deploy'. Defaults to 'test-only'. 't' is equivalent to 'test-only' and 'd'/'deploy'/'f' are equivalent to 'full-deploy'",
          "envName   : 'none', 'development', 'staging', or 'production'. These may be shortened to n/d/s/p/dev/prod (only first letter is checked)",
        ].join("\n\t")
      );
    })
    .action((sha, envName, buildMode, options) => command(cmdr, sha, envName, buildMode, options));
}

function fixEnvName(name) {
  if (!name) return "none";

  if (name.startsWith("d")) return "development";

  if (name.startsWith("s")) return "staging";

  if (name.startsWith("p")) return "production";

  if (name.startsWith("u")) return "uat";

  if (name.startsWith("n")) return "none";

  throw new Error(`"${name}" is not a valid environment-name`);
}

function fixBuildMode(mode) {
  if (!mode) return "test-only";

  if (mode.startsWith("f")) return "full-deploy";

  if (mode.startsWith("d")) return "full-deploy";

  if (mode.startsWith("t")) return "test-only";

  throw new Error(`"${mode}" is not a valid build-mode`);
}

function command(cmdr, sha, envName, buildMode, options) {
  // console.log("sha", sha);
  // console.log("options", options);

  envName = fixEnvName(envName);
  buildMode = fixBuildMode(buildMode);

  if (options.local && options.github) return _rejecto("Can't specify both --local and --github");

  if (!options.local && !options.github) return _rejecto("Must specify either --local or --github");

  if (!options.project) return _rejecto("--project is required.");

  if (options.github && !options.token) {
    return _rejecto(
      "--token (or TAPESTRY_GITHUB_ACCESS_TOKEN env var) is required when --github is in use"
    );
  }

  const startOptions = {
    repo: options.local || options.github,
    repoType: options.local ? "localgit" : "github",
    sha: sha,
    projectName: options.project,
    token: options.token,
    buildMode,
    envName,
  };
  logger.log("Starting CI with options: ", startOptions);
  return tapUtil.startCI.start(startOptions).then(r => report(r, sha, envName, buildMode));
}

function report(result, sha, envName, buildMode) {
  logger.log(`Start results: ${sha} ${envName} ${buildMode}`, result);
}

module.exports = { init, command };
