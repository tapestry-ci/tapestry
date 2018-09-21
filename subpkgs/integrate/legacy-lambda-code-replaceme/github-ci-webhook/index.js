"use strict";

const tapUtil = require("@tapestry-ci/util");
const GithubApi = require("github");

let API_CLIENT = null;

function getApiClient() {
  if (!API_CLIENT) {
    API_CLIENT = new GithubApi();
    API_CLIENT.authenticate({
      type: "token",
      token: process.env.TAPESTRY_GITHUB_ACCESS_TOKEN,
    });
  }
  return API_CLIENT;
}

const EVENT_HANDLERS = {
  pull_request: handlePullRequestEvent,
  push: handlePushEvent,
};

function SKIP(msg) {
  console.log(`Start-CI-Skipping ::: ${msg}`);
  return Promise.resolve(`SKIPPING EVENT ::: ${msg}`);
}

function handlePushEvent(payload, event, context, config) {
  const repo = payload.repository.full_name;
  const { codebuild, rules } = config.repo(repo);
  if (!codebuild || !rules) return SKIP(`unconfigured repo: ${repo}`);

  if (!payload.ref.startsWith("refs/heads/"))
    return SKIP(`ref (${payload.ref}) is not a refs/heads/* on repo ${repo}`);

  const branchName = payload.ref.replace(/^refs\/heads\//, "");
  const sha = payload.after;

  const branchRules = rules[branchName] || rules.$Default || null;
  if (!branchRules) return SKIP(`no CI-Rule for '${branchName}' or '$Default' on repo ${repo}`);

  const addEnvVars = {
    TAPESTRY_CI_STARTED_BY: "push",
    TAPESTRY_CI_STARTED_BY_WHOM: payload.pusher.name,
    TAPESTRY_CI_PUSHED_TO: branchName,
    TAPESTRY_CI_PUSH_TYPE: "push",
  };

  const prMergeMatch = /Merge pull request #(\d+) from (\S+)/.exec(payload.head_commit.message);
  if (prMergeMatch) {
    Object.assign(addEnvVars, {
      TAPESTRY_CI_PUSH_TYPE: "pr-merge",
      TAPESTRY_CI_PULL_REQUEST_ID: `${prMergeMatch[1]}`,
      TAPESTRY_CI_PULL_REQUEST_URL: `${payload.repository.url}/pulls/${prMergeMatch[1]}`,
      TAPESTRY_CI_MERGED_FROM: prMergeMatch[2],
    });
  }

  return startCI(repo, sha, branchRules, addEnvVars, config);
}

function handlePullRequestEvent(payload, event, context, config) {
  const repo = payload.repository.full_name;

  const { codebuild, rules } = config.repo(repo);
  if (!codebuild || !rules) return SKIP(`unconfigured repo: ${repo}`);
  if (!rules.$PullRequest) return SKIP(`no CI-Rule for '$PullRequest' on repo ${repo}`);

  if (!["opened", "synchronize"].includes(payload.action))
    return SKIP(`unhandled pull request action: ${payload.action}`);

  const sha = payload.pull_request.head.sha;
  const addEnvVars = {
    TAPESTRY_CI_STARTED_BY: "pull-request",
    TAPESTRY_CI_STARTED_BY_WHOM: payload.pull_request.user.login,
    TAPESTRY_CI_PULL_REQUEST_ID: payload.pull_request.number,
    TAPESTRY_CI_PULL_REQUEST_URL: payload.pull_request.url,
  };

  return startCI(repo, sha, rules.$PullRequest, addEnvVars, config);
}

function startCI(repo, sha, rules, addEnvVars, config) {
  const { codebuild } = config.repo(repo);
  const projectName = codebuild;
  const token = process.env.TAPESTRY_GITHUB_ACCESS_TOKEN;
  const options = Object.assign(
    { repo, sha, projectName, token, repoType: "github", addEnvVars },
    rules
  );
  if (options.env && !options.envName) options.envName = options.env;

  console.log("Start-CI-Options ::: ", JSON.stringify(options));
  return tapUtil.startCI.start(options).then(report => {
    console.log("Start-CI-Results ::: ", JSON.stringify(report));
    return updateGithub(repo, sha, report).then(() => ({
      started: true,
      options,
      codebuildId: report.build.id,
    }));
  });
}

function updateGithub(repoFull, sha, report) {
  const state = "pending";
  const [owner, repo] = repoFull.split("/");
  const region = process.env.AWS_REGION || "us-west-2";
  const codebuildId = report.build.id;
  const context = "Tapestry-CI";
  const description = `CI Initiated @ ${codebuildId}`;
  const target_url = `https://${region}.console.aws.amazon.com/codebuild/home?region=${region}#/builds/${codebuildId}/view/new`;
  const params = { state, context, description, target_url, owner, repo, sha };
  console.log("Start-CI-Github-Status-Update ::: ", JSON.stringify(params));
  const client = getApiClient();
  return client.repos
    .createStatus(params)
    .catch(e => console.error("github status update failed", e.stack || e));
}

module.exports.handler = (event, context, callback) => {
  console.log("EVENT", event);
  const result = { statusCode: 200 };
  const success = () => {
    console.log("Start-CI-Response ::: ", JSON.stringify(result));
    callback(null, result);
  };
  const error = e => {
    console.error(e.stack);
    callback(null, { statusCode: 500, body: e.stack });
  };
  const eventType = event.headers["X-GitHub-Event"];
  const payload = JSON.parse(event.body);
  const eventHandler =
    EVENT_HANDLERS[eventType] ||
    (() => Promise.reject(new Error(`can't process X-Github-Event=${eventType} events`)));
  const eventCopy = Object.assign({}, event);
  delete eventCopy.body;
  console.log("Start-CI-Event ::: ", JSON.stringify(eventCopy));
  console.log("Start-CI-Payload ::: ", JSON.stringify(payload));
  console.log("Start-CI-Event-Type ::: ", eventType);
  let config = null;

  return Promise.resolve()
    .then(() => tapUtil.ciConfig(undefined, false).then(c => (config = c)))
    .then(() => eventHandler(payload, eventCopy, context, config))
    .then(data => (result.body = JSON.stringify(data)))
    .then(success)
    .catch(error);
};
