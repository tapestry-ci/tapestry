"use strict";

// const documentationers = require("./documentationers");
const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger("docs");
const chalk = require("chalk");

const marked = require("marked");
const TerminalRenderer = require("marked-terminal");

const RENDER_OPTIONS = {
  reflowText: true,
  width: 80,
};
marked.setOptions({ renderer: new TerminalRenderer(RENDER_OPTIONS) });

let DOCS;
const subtopics = topic => Object.keys(DOCS).filter(n => n.startsWith(`${topic}/`));

function init(cmdr) {
  cmdr
    .command("docs [topic]")
    .alias("documentation")
    .description(
      "Browse tapestry documentation. If [topic] not passed, show all available documentation topics."
    )
    .option("-a --all", "show all documentation subjects including subtopics")
    .action((topic, options) => command(cmdr, topic, options));
}

function command(cmdr, topic, options = {}) {
  try {
    if (!DOCS) DOCS = require("./docs.json");
  } catch (e) {
    logger.error(
      "TAPESTRY compiled-docs ARE MISSING :( tapdev's own pre-deploy build step didn't run or something?"
    );
  }

  if (!topic) return showTopicList(cmdr, "", options);
  if (topic.endsWith("/")) return showTopicList(cmdr, topic, options);
  return showHelpTopic(cmdr, topic, options);
}

function showHelpTopic(cmdr, topic, options = {}) {
  if (!DOCS[topic]) {
    logger.shutdown("error", `no documentation topic named '${topic}' :(`);
    return;
  }

  logger.info(`${topic} • ${DOCS[topic].description}`, marked(DOCS[topic].contents));
  const subs = subtopics(topic);
  if (subs.length)
    showTopicList(cmdr, `${topic}/`, { overrideTitle: `see also: subtopics for ${topic}:` });
  else logger.shutdown("success");
}

function showTopicList(cmdr, prefix, options = {}) {
  const descsubs = topic =>
    subtopics(topic).length
      ? `${subtopics(topic).length} subtopics: \`tapdev docs ${topic}/\``
      : chalk.dim("--");
  const documentationLine = (str, topic) =>
    `${str}| ${topic} | ${DOCS[topic].description} | ${descsubs(topic)} |\n`;
  const documentationText = `# Available documentation topics${prefix ? ` under ${prefix}` : ""}
| topic | description | subtopics |
| ----- | ----------- | --------- |
${Object.keys(DOCS)
    .filter(n => options.all || (prefix ? n.startsWith(prefix) : !n.includes("/")))
    .sort()
    .reduce(documentationLine, "")} `;
  logger.info(options.overrideTitle || "Documentation Topics", marked(documentationText));
  logger.shutdown("success");
}

module.exports = { init, command, showHelpTopic, showTopicList };
