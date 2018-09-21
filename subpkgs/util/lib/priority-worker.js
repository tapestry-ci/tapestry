"use strict";

const queen = require("prom-queen");
const logger = require("./logging").utilLogger("pworker");

const defaultGetPriority = x => x.priority;
const sorter = getPriority => (a, b) => getPriority(b) - getPriority(a);
const reducer = getPriority => (rootAry, item) => {
  const lastAry = rootAry[rootAry.length - 1];
  const lastItem = lastAry.length ? lastAry[lastAry.length - 1] : null;
  if (!lastItem || getPriority(lastItem) === getPriority(item)) lastAry.push(item);
  else rootAry.push([item]);

  return rootAry;
};

const groups = (items, getPriority) =>
  items
    .slice()
    .sort(sorter(getPriority))
    .reduce(reducer(getPriority), [[]]);

const priorityWorker = (items, workerFunction, max = 0, getPriority = defaultGetPriority) =>
  queen.sequential(groups(items, getPriority), tasks => {
    if (max) {
      if (max === 1) {
        logger.debug("max parallelism is 1, using sequential mode");
        return queen.sequential(tasks, workerFunction);
      }
      logger.debug(`max parallelism is ${max}, using batched mode instead of parallel!`);
      return queen.batch(tasks, max, workerFunction);
    }
    return queen.parallel(tasks, workerFunction);
  });

module.exports = priorityWorker;
