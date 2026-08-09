'use strict';

// Explicit Vercel entrypoint for the legacy cron-job.org URL.
// Keeping this route out of the broad catch-all rewrite prevents Vercel from
// serving api/[...path].js as JavaScript instead of executing the function.
let app;
let bootError;

try {
  app = require('../../server/index.js');
} catch (error) {
  bootError = error;
  console.error('Moka sync API bootstrap failed:', error);
}

module.exports = (req, res) => {
  if (bootError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'API bootstrap failed',
      message: bootError.message,
    }));
    return;
  }

  return app(req, res);
};
