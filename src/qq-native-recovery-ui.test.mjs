import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('the production connection hint shows waiting-for-scan even when login RPC is not available',async()=>{
 const source=await readFile(new URL('../modules/web-console/public/desktop.js',import.meta.url),'utf8'),start=source.indexOf('function renderConnection(){'),end=source.indexOf('\n}',start)+2;
 for(const connected of [false,null]){
  const elements={onlineDot:{classList:{toggle(){}}},connection:{},hint:{dataset:{}}};
  vm.runInNewContext(source.slice(start,end)+'\nrenderConnection()',{updateComposer(){},connected,sending:false,desktopState:{nativeRecovery:{phase:'awaiting_scan',message:'QQ需要手机扫码确认，不再自动重启'}},$:id=>elements[id]});
  assert.match(elements.hint.textContent,/扫码确认/);assert.notEqual(elements.connection.textContent,'QQ 在线');
 }
});
