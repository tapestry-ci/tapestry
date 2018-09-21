"use strict";

const tapUtil = require("@tapestry-ci/util");
const monk = require("monk");
const { StatusManager } = tapUtil.buildStatusUpdates;
const GithubApi = require("github");
const fecha = require("fecha");
const stripAnsi = require("strip-ansi");
const queen = require("prom-queen");
const { renderSlackMessage, renderSlackErrorDM } = require("./render-slack-message");
const lceq = (a, b) => a.toLowerCase() === b.toLowerCase();

const Slack = require("slack");
const slackbot = new Slack({ token: process.env.TAPESTRY_SLACK_ACCESS_TOKEN });

const COMMENT_META_COLLECTION = "githubPRComments";
const MAX_ERROR_BODY_SIZE = 8192;

let SLACK_USERS;
let TAPESTRY_USERS;
let COMBINED_USERS;

const loadGithubApi = token => {
  const api = new GithubApi();
  api.authenticate({ type: "token", token });
  return api;
};

function handleEvent(allEvent, event, context) {
  const payloadStr = Buffer.from(event.kinesis.data, "base64").toString("utf8");
  const { project, buildStr } = JSON.parse(payloadStr);
  let config, db, commentsDb, manager, api, users;
  let state;
  return queen
    .delayed(3000)
    .then(() => tapUtil.ciConfig(undefined, false).then(c => (config = c)))
    .then(() => loadUsers(config).then(u => (users = u)))
    .then(() => {
      db = monk(config.deployments.mongodbOptions);
      api = loadGithubApi(config.github.accessToken);
      manager = new StatusManager(project, buildStr, db, api);
      commentsDb = db.get(COMMENT_META_COLLECTION);
      ["buildStr", "date", "owner", "repo"].forEach(x => commentsDb.index(x));
      state = { config, db, commentsDb, api, manager, project, buildStr, users };
      console.log(`loading build for ${project} @ ${buildStr}`);
      return manager.load().then(rec => {
        if (rec.buildReport) rec.buildReport = JSON.parse(rec.buildReport); // expand the build report
        console.log("report", JSON.stringify(rec));
        state.report = rec;
      });
    })
    .then(() => {
      const cbid = state.report.codebuildId;
      if (!cbid) {
        db.close();
        return Promise.resolve();
      }

      return Promise.resolve()
        .then(() => tapUtil.ciStatus.fetchBuild(cbid).then(b => (state.build = b)))
        .then(() => console.log("build", JSON.stringify(state.build)))
        .then(() =>
          Promise.all([
            triggerGithubActions(state, state.build, state.report),
            triggerSlackActions(state, state.build, state.report),
          ])
        )
        .then(() => db.close());
    })
    .catch(e => {
      try {
        db.close();
      } catch (e) {}
      return Promise.reject(e);
    });
}

function loadUsers(config) {
  if (COMBINED_USERS) return Promise.resolve(COMBINED_USERS);

  return Promise.resolve()
    .then(() => TAPESTRY_USERS || config.fetchUserDb().then(u => (TAPESTRY_USERS = u)))
    .then(() => loadSlackUsers())
    .then(() => {
      const slackMap = SLACK_USERS.reduce(
        (m, x) => Object.assign(m, { [x.slack.toLowerCase()]: x.slackId }),
        {}
      );
      const combined = TAPESTRY_USERS.map(tapU =>
        Object.assign(
          {},
          tapU,
          slackMap[tapU.slack] ? { slackId: slackMap[tapU.slack.toLowerCase()] } : {}
        )
      );
      COMBINED_USERS = combined;
      return Promise.resolve(COMBINED_USERS);
    });
}

function loadSlackUsers() {
  if (SLACK_USERS) return Promise.resolve(SLACK_USERS);
  const tapNames = TAPESTRY_USERS.map(u => u.slack);
  const users = [];
  const fetchNext = cursor => {
    const params = {};
    if (cursor) params.cursor = cursor;
    return slackbot.users.list(params).then(results => {
      users.push(
        ...results.members
          .filter(u => !u.deleted && tapNames.includes(u.name))
          .map(u => ({ slack: u.name, slackId: u.id }))
      );

      if (results.response_metadata && results.response_metadata.next_cursor)
        return fetchNext(results.response_metadata.next_cursor);

      SLACK_USERS = users;
      return Promise.resolve(SLACK_USERS);
    });
  };
  return fetchNext(null);
}

function triggerSlackActions(state) {
  const { build, report, users } = state;

  const message = Object.assign(
    {
      username: `tapestry-${build.isDeploy ? "deployment" : "testing"}-robot`,
      channel: process.env.TAPESTRY_SLACK_EVENTS_CHANNEL,
    },
    renderSlackMessage(build, report, users || [])
  );

  const messages = [message];
  if (report.status === "error" || report.status === "failure") {
    const userEntry = users.find(user => lceq(user.github, build.startedBy));
    if (userEntry && userEntry.slackId) {
      const msg = Object.assign({ channel: userEntry.slackId }, renderSlackErrorDM(build, report));
      messages.push(msg);
    }
  }

  return queen.sequential(messages, msg => slackbot.chat.postMessage(msg));
}

function triggerGithubActions(state) {
  const { report, build, buildStr } = state;
  const project = build.envVars.TAPESTRY_GITHUB_PROJECT;
  const [owner, repo] = project.split("/");
  const number = `${build.pullRequestId}`;

  if (!number || Number.isNaN(Number(number))) {
    console.log("skip github comments: this build isn't a pull request!", build.pullRequestId);
    return Promise.resolve();
  }

  const initialCommentRec = (commentId, body) => ({
    owner,
    repo,
    number,
    commentId,
    buildStr,
    body,
  });

  const comment = body =>
    state.api.issues
      .createComment({ owner, repo, number: Number(number), body })
      .then(result => state.commentsDb.insert(initialCommentRec(result.data.id, body)));

  const workers = renderErrors(state).map(item => () => comment(item));
  if (report.buildReport) workers.push(() => comment(renderDeployReport(state)));
  console.log(`GITHUB WORKER COUNT: ${workers.length}`);
  workers.push(() => removeOldGithubComments(state, owner, repo, number));
  workers.push(() => console.log(`DONE with github actions for ${state.buildStr}`));
  return workers.reduce((p, w) => p.then(w), Promise.resolve());
}

const collapsify = (summary, body) => `<details>
<summary><i>${summary}</i></summary>
  <p>

${body}

  </p>
</details>
`;

function removeOldGithubComments(state, owner, repo, number) {
  const outdatedQuery = { owner, repo, number };
  outdatedQuery.buildStr = { $ne: state.buildStr };
  const aWhileAgo = new Date(Date.now() - 1000 * 86400 * 1000 * 30);
  const expiredQuery = { owner, repo, date: { $lt: aWhileAgo } };
  const query = { $or: [outdatedQuery, expiredQuery] };
  const editComment = cmt => {
    const id = cmt.commentId;
    const summary =
      cmt.buildStr === state.buildStr
        ? `this automated comment is quite old and has been marked stale`
        : `this automated comment references an older build: ${cmt.buildStr}`;
    const body = collapsify(`<i>${summary}</i>`, cmt.body);
    return state.api.issues
      .editComment({ owner, repo, id, body })
      .then(() => state.commentsDb.remove({ _id: cmt._id }));
  };
  return state.commentsDb
    .find(query)
    .then(
      comments => queen.sequential(comments, editComment)
      // .then(() => state.commentsDb.remove({ _id: { $in: comments.map(x => x._id) } }))
    )
    .catch(e => console.error("ERROR WHEN REMOVING OLD COMMENTS", e.stack));
}

const _errSummary = error => {
  const m = error.message;
  if (m.indexOf("\n") === -1 && m.length < 60) return m;
  return `${m.replace(/\n.*$/gm, "").slice(0, 55)} ... `;
};

function renderErrors(state) {
  const { report, build } = state;
  const LF = "\n";
  const QUOT = "\n```\n";
  const msgs = [];
  if (report.hasErrors) {
    const count = report.errors.length;
    const combinedError = [`${build.tapestry.commitId} has ${count} errors:${LF}${LF}`];
    const renderError = (error, index) => {
      let errorDeets = error.stack;
      let extra = "";
      if (errorDeets.length > MAX_ERROR_BODY_SIZE) {
        extra = `

**Message was truncated. see [build logs](${build.logs.deepLink}) for more info.**

`;
        const snipped = errorDeets
          .replace(/^\n+/, "")
          .replace(/\n.+$/, "")
          .slice(0, MAX_ERROR_BODY_SIZE);

        errorDeets = `This error message was too long for full display! See logs for full details. Snippet included below:${
          LF
        }${LF}${snipped}${LF}${LF}`;
      }

      return collapsify(
        `Error ${index + 1}: ${_errSummary(error)}`,
        `

### Error ${index + 1} of ${count}

${QUOT}
${errorDeets}
${QUOT}
${extra}
`
      );
    };

    const addError = (error, index) => combinedError.push(renderError(error, index));
    report.errors.forEach(addError);

    if (build.envVars.TAPESTRY_CI_STARTED_BY_WHOM)
      combinedError.push(`${LF}@${build.envVars.TAPESTRY_CI_STARTED_BY_WHOM}${LF}`);

    combinedError.push(commentFooter(state).trim());

    msgs.push(combinedError.join(`${LF}${LF}`));
  }
  return msgs.map(x => stripAnsi(x));
}

const ghStatus = {
  deployed: ":rocket:",
  published: ":black_nib:",
  error: ":no_entry_sign:",
  skipped: ":ok:",
};
const ghLegend = `Legend:
 *   ${ghStatus.deployed} Deployed
 *   ${ghStatus.published} NPM-Published
 *   ${ghStatus.error} Error`;

function renderDeployReport(state) {
  const { report, build } = state;
  const LF = "\n";
  console.log(`${state.buildStr} ::: ${build.tapestry.commitId} ::: rendering deployment report!`);
  let output = `### ${build.tapestry.commitId} ::: Deployment Report:${LF}${LF}`;

  const ALLREP = Object.assign(
    {},
    (report.buildReport || {}).publishResults || {},
    (report.buildReport || {}).deploymentResults || {}
  );

  const ct = Object.keys(ALLREP).reduce(
    (m, k) => Object.assign(m, { [ALLREP[k].status]: (m[ALLREP[k].status] || 0) + 1 }),
    {}
  );

  const summary = Object.keys(ct)
    .filter(x => ct[x])
    .map(x => `${x}:${ct[x]}`)
    .join(" | ");

  output += `<details><summary>${summary}</summary><p>${LF}${LF}`;
  output += `| name / type | status / version |${LF}`;
  output += `| ----------- | ---------------- |${LF}`;

  const skipped = [];
  Object.keys(ALLREP).forEach(key => {
    const val = ALLREP[key];
    if (val.status === "skipped") {
      skipped.push({ key, val });
      return;
    }

    const fields = [
      `**${key}** (${val.plan.type})`,
      `${ghStatus[val.status] || val.status} ${val.plan.version.shortVersion}`,
    ];
    output += `| ${fields.join(" | ")} |${LF}`;
  });
  if (ct.skipped) {
    const skippedList = skipped
      .map(
        ({ key, val }) =>
          `**${key}** *(${val.plan.version.shortVersion} @ ${fecha.format(
            new Date(val.plan.version.deploymentTime),
            "M/D h:mm a"
          )})*`
      )
      .join(", ");
    output += `${LF}${LF}The following deployments were skipped due to not needing updates: ${
      skippedList
    }`;
  }

  output += `${LF}${LF}${ghLegend}`;

  output += `${LF}${LF}</p></details>`;

  if (build.envVars.TAPESTRY_CI_STARTED_BY_WHOM)
    output += `${LF}${LF}@${build.envVars.TAPESTRY_CI_STARTED_BY_WHOM}${LF}`;

  output += commentFooter(state);

  return output;
}

function commentFooter(state) {
  const longId = state.build.codebuild.id;
  const shortId = longId.split(":")[1].split("-")[0];
  const cbreg = state.build.codebuild.region || state.config.region || "us-west-2";
  return `

[build logs](${state.build.logs.deepLink}) (or use \`tapdev ci logs ${shortId}\`)
[build status](https://us-west-2.console.aws.amazon.com/codebuild/home?region=${cbreg}#/builds/${
    longId
  }/view/new) (or use \`tapdev ci show ${shortId}\`)

<details><summary>tapestry-meta</summary><p>

* buildStr: ${state.buildStr}
* project: ${state.project}
${Object.keys(state.build.tapestry)
    .filter(x => x !== "buildStr" && (x.startsWith("date") ? x === "dateISO" : true))
    .map(k => `* ${k}: ${state.build.tapestry[k]}`)
    .join("\n")}

</p></details>`;
}

module.exports = {
  handler: (event, context, callback) => {
    console.log("BUILD-FINISHED-EVENT", JSON.stringify(event));
    const promises = event.Records.map(rec => handleEvent(event, rec, context));
    return Promise.all(promises)
      .then(r => {
        console.log("BUILD-FINISHED-RESULT", r);
        callback(null, r);
      })
      .catch(e => {
        console.log("BUILD-FINISHED-ERROR", e);
        return callback(e);
      });
  },
};
