"use strict";

const prettyMs = require("pretty-ms");
const fecha = require("fecha");

const sameDay = (a, b) =>
  a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getYear() === b.getYear();

const lceq = (a, b) => a.toLowerCase() === b.toLowerCase();

function renderSlackErrorDM(build, report) {
  const prefix = build.isDeploy ? `*deploy failed:* ` : "tests failed: ";
  const longId = build.codebuild.id;
  const shortId = longId.split(":")[1].split("-")[0];

  const rendered = {
    text: `${prefix} ${report.project}\n${prettyDescription(build)}).\nSee \`tapdev ci show ${
      shortId
    }\`, \`tapdev ci logs ${shortId}\`, or ${build.logs.deepLink}`,
  };

  return rendered;
}

function renderSlackMessage(build, report, users) {
  const _action = build.isDeploy ? `deploy to ${build.tapestry.env}` : "run tests only";
  const pstat = prettyStatus(build, report);
  const start = fecha.format(new Date(build.startTime), "hh:mm a");
  const ela = prettyMs(build.elapsed);
  const userEntry = users.find(user => lceq(user.github, build.startedBy));

  const reportType = build.isDeploy ? "Deployment" : "Test";
  const rendered = {
    text: `*Tapestry-CI ${reportType} Report for ${report.project}* (${ela})`,
    link_names: true,
  };

  if (build.hasErrors && userEntry) {
    const atWhat = build.isDeploy ? "deployment problem" : "test failure";
    const atDetails = `${atWhat}: ${prettyVia(build)}`;
    rendered.text = `@${userEntry.slack} ${atDetails}\n${rendered.text}`;
  }

  const flagsTxt = Object.keys(build)
    .filter(k => typeof build[k] === "boolean" && build[k] === true)
    .reduce((m, x) => [...m, `${x}`], [])
    .join(", ");

  const fullText = `
*codebuild*: ${(build.codebuild && build.codebuild.id) || "none"}
*git-sha*: ${build.tapestry.commitId}
*started*: _by_ *${build.startedBy}* _via_ *${prettyVia(build)}* _at_ *${start}*
*flags*: ${flagsTxt}
`;

  const attach = {
    fallback: prettyDescription(build),
    color: pstat.color,
    mrkdwn_in: ["text", "fields"],
    title: `${report.project} • ${_action} • ${pstat.msg}`,
    title_link: build.logs.deepLink,
    fields: [],
  };
  const extraAttach = [];
  const addField = (title, value, short = true) => attach.fields.push({ title, value, short });

  if (build.pullRequestId)
    addField("PR URL", `https://github.com/${report.project}/pull/${build.pullRequestId}`, false);

  if (build.isReRun) {
    const time = prettyTime(build.reRunOriginalDate);
    addField("Re-Run of", `${build.reRunCodebuild} _at_ ${time}`, false);
  }

  if (build.codebuild && build.codebuild.id) {
    // const [cbprj, cbuuid] = build.codebuild.id.split(":");
    // const shortId = cbuuid.split("-")[0];
    const _quot = "```\n";
    const tcmd = which => `tapdev ci ${which} ${build.codebuild.id} \n`;
    addField("More Info", [_quot, tcmd("show"), tcmd("logs"), _quot].join(""), false);
  }

  // addField("Logs", build.logs.deepLink, false);

  // if (build.codebuildArtifacts.location) {
  // const loc = build.codebuildArtifacts.location;
  // const artsS3 = loc.replace("arn:aws:s3:::", "s3://");
  // addField("Artifacts", artsS3, false);
  // }

  if (report.hasErrors) {
    addField(
      `Errors (${report.errors.length})`,
      report.errors.map(x => ` • ${x.message.replace(/\n.*$/gm, "")}`).join("\n"),
      false
    );
  }

  if (report.buildReport) {
    const br = report.buildReport;
    const showVersion = x => `${x.name} (${x.rec.plan.type}) @ ${x.rec.plan.version.shortVersion}`;
    const showBulVersion = x => ` • ${showVersion(x)}`;

    const ALLREP = Object.assign({}, br.publishResults, br.deploymentResults);
    const allSkipped = Object.keys(ALLREP)
      .sort()
      .filter(x => ALLREP[x].status === "skipped")
      .map(name => ({ name, rec: ALLREP[name] }));
    const hasSkipped = !!allSkipped.length;

    const allDeplFails = Object.keys(ALLREP)
      .sort()
      .filter(x => ALLREP[x].status === "error")
      .map(name => ({ name, rec: ALLREP[name] }));
    const hasDeplFails = !!allDeplFails.length;

    const allDeplSucc = Object.keys(ALLREP)
      .sort()
      .filter(x => ["published", "deployed"].includes(ALLREP[x].status))
      .map(name => ({ name, rec: ALLREP[name] }));
    const hasDeplSucc = !!allDeplSucc.length;

    if (hasSkipped) {
      extraAttach.push({
        fallback: `Skipped: ${allSkipped.map(x => x.name).join(", ")}`,
        color: "#aaa",
        pretext: `*These deployments were up to date and were not deployed or published:*`,
        text: allSkipped.map(x => x.name).join(", "),
        mrkdwn_in: ["text", "pretext"],
      });
    }

    if (hasDeplSucc) {
      extraAttach.push({
        fallback: `Deployed: ${allDeplSucc.map(showVersion).join("\n")}`,
        color: "good",
        pretext: `*These deployments succeeded:*`,
        text: allDeplSucc.map(showBulVersion).join("\n"),
        mrkdwn_in: ["text", "pretext"],
      });
    }

    if (hasDeplFails) {
      extraAttach.push({
        fallback: `Deploy Failures: ${allDeplFails.map(x => x.name).join(", ")}`,
        color: "danger",
        pretext: `*THESE DEPLOYMENTS FAILED:*`,
        text: allDeplFails.map(x => x.name).join(", "),
        mrkdwn_in: ["text", "pretext"],
      });
    }
  }

  attach.text = fullText;
  rendered.attachments = [attach, ...extraAttach];

  return rendered;
}

function prettyStatus(build, report) {
  try {
    if (report.status === "pending") return { color: "#aaaaaa", msg: "CI still running" };
    if (report.buildMode === "test-only") {
      if (report.status === "success") return { color: "#00e0f0", msg: "passed all tests!" };
      if (report.status === "error" || report.status === "failure")
        return { color: "#f0d000", msg: "has failed tests!" };
    }
    if (report.buildMode === "full-deploy") {
      if (report.status === "success") return { color: "good", msg: "deployed successfully!" };
      if (report.status === "error" || report.status === "failure") {
        if (!report.buildReport) return { color: "danger", msg: "deployment failed" };
        const br = report.buildReport;
        const ALLREP = Object.assign({}, br.publishResults || {}, br.deploymentResults || {});
        const hasSuccess = Object.keys(ALLREP).filter(x =>
          ["deployed", "published"].includes(ALLREP[x].status)
        );
        if (hasSuccess) return { color: "danger", msg: "deployment partially succeeded" };
        return { color: "danger", msg: "deployment failed" };
      }
    }
  } catch (e) {
    console.error("PRETTY STATUS RENDER ERROR", e.stack);
  }
  return { color: "warning", msg: `${report.buildMode}:${report.status}` };
}

function prettyVia(build) {
  if (build.isReRun) {
    const idFrag = build.codebuild.id.split(":")[1].split("-")[0];
    return `Re-Run of ${idFrag}`;
  }
  if (build.isPullRequest) return `PR #${build.pullRequestId}`;
  if (build.isPush) return `push to ${build.pushedTo}`;
  if (build.isMerge) return `Merge #${build.pullRequestId} into ${build.pushedTo}`;
  return build.startedVia;
}

function prettyTime(d) {
  const t = d ? new Date(d) : null;
  const now = new Date();
  const fstr = t && sameDay(now, t) ? "h:mm a" : "M/D h:mm a";
  return t ? fecha.format(t, fstr) : "n/a";
}

function prettyDescription(build) {
  const _action = build.isDeploy
    ? `[Deployment to ${build.tapestry.env}]`
    : "[build and run tests]";

  const _commit = build.tapestry.commitId;
  const _who = build.startedBy;
  const _via = prettyVia(build);
  const _inf = `[${build.phase} / ${build.status}]`;
  const _lcommit = "commitId";
  const _lby = "triggered by";
  const _lvia = "via";
  return [_action, _lcommit, _commit, _lby, _who, _lvia, _via, _inf].join(" ");
}

module.exports = { renderSlackMessage, renderSlackErrorDM };
