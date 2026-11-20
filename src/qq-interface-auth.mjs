import {matchesDesktopKey} from './qq-desktop-access.mjs';

export function authorizeLoopback(req, res, {port, key, browser = false}) {
  const host = req.headers.host;
  const peer = req.socket.remoteAddress;
  const local = peer === '127.0.0.1' || peer === '::ffff:127.0.0.1';
  const validHost = host === '127.0.0.1:' + port || host === 'localhost:' + port;
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (!local || !validHost || (origin !== undefined && (!browser || origin !== 'http://' + host)) ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')) {
    res.writeHead(403, {'cache-control':'no-store'}).end();
    return false;
  }
  if (matchesDesktopKey(req.headers['x-qq-desktop-key'], key)) return true;
  // HTTP authentication is scoped to the Hub's origin. It works for ordinary
  // navigation, fetch and image/audio requests without putting secrets in URLs.
  if (browser) {
    const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization || '');
    const pair = basic && Buffer.from(basic[1], 'base64').toString('utf8');
    if (pair?.startsWith('qq:') && matchesDesktopKey(pair.slice(3), key)) return true;
  }
  const headers = {'cache-control':'no-store'};
  if (browser) headers['www-authenticate'] = 'Basic realm="QQ Hub", charset="UTF-8"';
  res.writeHead(401, headers).end();
  return false;
}
