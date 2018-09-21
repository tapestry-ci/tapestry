"use strict";

// const helpers = require("./helpers");
const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger("news");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const chalk = require("chalk");
const queen = require("prom-queen");

const newsObj = require("./tapdev-news.json");

function init(cmdr) {
  cmdr
    .command("news")
    .option("-l, --limit <count>", "limit the number of items to show", 10)
    .option("-A, --all", "show news items even if you have seen them before")
    .description("shows recently implemented tapestry-dev-tools features")
    .action(options => command(cmdr, options));
}
const viewedFile = () => `${process.env.HOME}/.tapdev-news`;
const saveViewed = obj => fs.writeFile(viewedFile(), JSON.stringify(obj), "utf8");
const fetchViewed = () =>
  fs
    .readFile(viewedFile(), "utf8")
    .then(JSON.parse)
    .catch(e => ({}));
const checkUnviewed = obj => newsObj.filter(x => !obj[x.id]);
const fetchUnviewed = () => fetchViewed().then(obj => checkUnviewed(obj));
const markViewed = (obj, lst) => lst.forEach(x => (obj[x.id] = 1));
const hasUnviewed = () => fetchUnviewed().then(x => x.length);
const alertIfUnviewed = () =>
  fetchUnviewed().then(unviewed => {
    if (!unviewed.length) return Promise.resolve();
    logger.line("warn");
    logger.warn("UNSEEN TAPDEV NEWS");
    const _tnews = chalk.bold.green("tapdev news");
    const ct = unviewed.length;
    logger.warn(
      `there are ${ct} unviewed tapestry updates. run ${_tnews} to view details:`,
      `${unviewed.map(f => ` • ${chalk.yellow(f.date)} • ${chalk.bold(f.desc)}`).join("\n")}`
    );
    logger.line("warn");
    return queen.delayed(50);
  });

function command(cmdr, options = {}) {
  logger.log("Looking for new news...");

  return fetchViewed()
    .then(obj => {
      let unviewed = checkUnviewed(obj);
      if (options.all) {
        unviewed = newsObj;
      } else if (!unviewed.length) {
        logger.info("Latest update: (you have no unread news items. pass --all to see all)");
        const feature = newsObj[0];
        logger.info(
          `[${feature.date}] [${feature.id}] ${chalk.bold(feature.items.length)} items`,
          `\n${chalk.cyan.bold(feature.desc)}\n\n${feature.items.join("\n")}`
        );
        return;
      }
      if (options.limit) unviewed = unviewed.slice(0, options.limit);
      logger.info("Recently updated tapestry features:");
      unviewed.forEach(feature => {
        logger.line("info");
        logger.info(
          `[${feature.date}] [${feature.id}] ${chalk.bold(feature.items.length)} items`,
          `\n${chalk.cyan.bold(feature.desc)}\n\n${feature.items.join("\n")}`
        );
      });
      markViewed(obj, unviewed);
      return saveViewed(obj);
    })
    .then(() => logger.shutdown("success"));
}

module.exports = { init, command, hasUnviewed, fetchUnviewed, alertIfUnviewed };
