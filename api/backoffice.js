// Serves the Backoffice SPA (backoffice/dist) for backoffice.redboxbarbershop.com.
// Isolated from server/index.js on purpose — this function must never import or
// depend on the main Express app, so it cannot affect existing API routes.
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'backoffice', 'dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function resolveWithinDist(urlPath) {
  const withoutQuery = urlPath.split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }
  const normalized = path.normalize(decoded).replace(/^([/\\]?\.\.[/\\])+/, '');
  const resolved = path.join(DIST_DIR, normalized);
  if (!resolved.startsWith(DIST_DIR)) return null;
  return resolved;
}

function sendFile(res, filePath, data) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Cache-Control',
    ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  );
  res.end(data);
}

function sendIndexFallback(res) {
  fs.readFile(INDEX_FILE, (err, data) => {
    if (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Backoffice build not found. Run `npm --workspace=backoffice run build`.');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  });
}

module.exports = (req, res) => {
  const requestedPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = resolveWithinDist(requestedPath);

  if (!filePath) {
    sendIndexFallback(res);
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // No matching static file → SPA client-side route (e.g. /hr, /attendance).
      sendIndexFallback(res);
      return;
    }
    sendFile(res, filePath, data);
  });
};
