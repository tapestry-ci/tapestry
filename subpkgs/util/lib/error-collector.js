"use strict";

const AggregateError = require("aggregate-error");

// this is handy for use like so:
// const ec = new ErrorCollector;
// Promise.all(items.map(x => asyncOp(x).catch(ec.catcher))).then(this.checker)

class ErrorCollector {
  constructor() {
    this.errors = [];
    this.catcher = e => this.add(e); // bound version of add()
    this.checker = () => this.check();
  }

  add(error) {
    this.errors.push(error);
  }

  check(thing) {
    const errs = this.errors;
    if (!errs.length) return thing;
    if (errs.length === 1) throw errs[0];
    throw new AggregateError(errs);
  }
}

module.exports = ErrorCollector;
