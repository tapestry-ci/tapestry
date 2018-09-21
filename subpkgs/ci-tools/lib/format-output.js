"use strict";

module.exports = (log, logErr) => ({
  error: (error, elapsed) => logErr(`ERROR (elapsed ${elapsed / 1000} seconds):`, error),
  success: (data, elapsed) => log(`done (elapsed ${elapsed / 1000} seconds)!`, data || ""),
});
