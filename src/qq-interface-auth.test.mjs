import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {authorizeLoopback} from './qq-interface-auth.mjs';
import {createAdminFetch} from '../scripts/qq-admin-fetch.mjs';

const secret = randomBytes(32).toString('hex');
const header = {'x-qq-desktop-key':secret};
const basic = {authorization:'Basic '+Buffer.from('qq:'+secret).toString('base64')};
function check(port, headers, remoteAddress = '127.0.0.1') {
  const req = {socket:{remoteAddress}, headers:{host:'127.0.0.1:'+port,...headers}};
  const res = {writeHead(status, fields){this.status = status; this.fields = fields; return this;}, end(){}};
  return {ok:authorizeLoopback(req, res, {port, key:secret, browser:port===3789}), res};
}
test('Hub challenges missing and invalid keys; the bridge accepts only its service header', () => {
  for (const port of [3789,3000]) {
    assert.equal(check(port,header).ok,true);
    for (const fields of [{},{'x-qq-desktop-key':'bad'},{authorization:'Basic notvalid'}]) {
      const {ok,res} = check(port,fields);
      assert.equal(ok,false); assert.equal(res.status,401);
      assert.equal(Boolean(res.fields['www-authenticate']),port===3789);
    }
  }
  assert.equal(check(3789,basic).ok,true);
  assert.equal(check(3000,basic).ok,false);
});
test('loopback peer, host and browser origin are checked even for correct credentials', () => {
  assert.equal(check(3789,{...basic,origin:'http://127.0.0.1:3789','sec-fetch-site':'same-origin'}).ok,true);
  for (const fields of [{host:'other.invalid'},{origin:'null'},{origin:'http://127.0.0.1:5099'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])
    assert.equal(check(3789,{...basic,...fields}).res.status,403);
  assert.equal(check(3789,header,'192.0.2.1').res.status,403);
  assert.equal(check(3000,{...header,origin:'http://127.0.0.1:3000'}).res.status,403);
});
test('authenticated client preserves method and body and never forwards the key to another origin', async () => {
  let reads = 0, received;
  const call = createAdminFetch(() => {reads++; return secret;}, (url,options) => {received={url,...options};});
  for (const url of ['https://example.invalid/','http://127.0.0.1:18083/','http://user@127.0.0.1:3789/'])
    await assert.rejects(call(url));
  assert.equal(reads,0);
  await call('http://127.0.0.1:3000/get_msg',{method:'POST',body:'{}',headers:{'content-type':'application/json'}});
  assert.equal(received.headers.get('x-qq-desktop-key'),secret);
  assert.equal(received.headers.get('content-type'),'application/json'); assert.equal(received.body,'{}');
  assert.equal(received.redirect,'error');
});
