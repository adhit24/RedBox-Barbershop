let app = null;
let bootError = null;

try {
  app = require('../server/index.js');
} catch (error) {
  bootError = error;
  console.error('API bootstrap failed:', error);
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
