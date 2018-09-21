"use strict";

const blessed = require("blessed");
const contrib = require("blessed-contrib");
const multisel = require("./blessed-multisel");
const helpers = require("./helpers");

const tapUtil = require("@tapestry-ci/util");
const path = require("path");
const logger = tapUtil.logging.devLogger("link");

function init(cmdr) {
  cmdr
    .command("edit-links")
    .alias("link")
    .option("-A, --all", "link all packages")
    .option("-N, --none", "link no packages")
    .description("interactive local dependency linker")
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();

  let list, available, selected;
  const sortByName = (a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0);

  return Promise.resolve()
    .then(() => helpers.init(cwd, options, "subpackages"))
    .then(() => options.subpackages.getPackages().then(l => (list = l.sort(sortByName))))
    .then(() => (available = list.map(x => `${x.name} (${x.dir})`)))
    .then(() => selectPackages(available, options))
    .then(s => (selected = s.map(idx => list[idx].path)))
    .then(() => options.subpackages.autoLink(selected))
    .then(() => (options.$WARN_FOOLISH_LINK_ALL ? warnLinkAll(logger) : Promise.resolve()));
}

function selectPackages(available, options) {
  if (options.none) return Promise.resolve([]);

  if (options.all) {
    options.$WARN_FOOLISH_LINK_ALL = true;
    return Promise.resolve(available.map((x, i) => i));
  }

  return new Promise((resolve, reject) => {
    const screen = blessed.screen({
      smartCSR: true,
    });

    const thingy = multisel(
      " [tapdev link] ",
      `Select which packages you are actively working on right now, or that have local changes which aren't published to npm. Selected packages will be linked together for development use.

    Press space to select/deselect the current package, ctrl-a to select all, ctrl-d to select none, or enter to accept.`,
      available
    );
    thingy.focus();
    thingy.on("results", (list, indexes) => {
      screen.destroy();
      // console.log("RESULT-INDEXES", indexes);
      // console.log("RESULTS", list);
      if (indexes.length === available.length) options.$WARN_FOOLISH_LINK_ALL = true;

      return resolve(indexes);
    });
    screen.key(["C-c"], () => {
      screen.destroy();
      logger.log("Ctrl-C received. Exiting.");
      process.exit();
    });
    screen.append(thingy);
    screen.render();
  });
}

function warnLinkAll(logger) {
  if (process.env.TAPESTRY_NO_WARN_FOOLISH_LINK_ALL) return;

  logger.line();
  logger.warn(`

    WARNING: LAZY AND/OR FOOLISH USE OF LINK ALL!

        You are linking all packages together. You have just increased the likelihood that you are
        going to run into a future issue which will require you to wipe all of your node_modules
        folders to recover. The more packages in this monorepo, the higher chances of weirdness.

        In general, you should only need to link together packages which you're actively working
        on, which have dependencies in this same monorepo where those dependencies have unpublished
        changes because they are also being actively worked on.

        For Example, if you have libraries/user, and libraries/items, and also a routes/user
        requires changes you've made to libraries/user, but haven't touched anything else in the
        repository, you should be linking *ONLY* libraries/user and routes/user.

        In short, I'm not going to stop you from doing this. It can come in handy and I myself
        use it from time to time out of laziness. But its almost definitely not necessary, probably
        unwise, and likely to confuse some other tools. Be ready to re-run 'tapdev install -D' or
        'tapdev local' to restore your modules back to pristine condition if anything gets strange.

        To suppress this warning, set the environment variable TAPESTRY_NO_WARN_FOOLISH_LINK_ALL
        to any value.

  `);
  logger.line();
}

module.exports = { init, command };
