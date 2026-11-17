// Opens only the isolated, already authenticated test profiles for human review.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = path.resolve('.backups/manual-sync');
const setup = JSON.parse(fs.readFileSync(path.join(dir, 'browsers.json'), 'utf8'));
assert.equal(setup.url, 'http://127.0.0.1:3100');
const response = await fetch(setup.url);
assert.ok(response.ok && (await response.text()).includes('demo-appcar-manual'), 'Start the isolated preview first');
const opened=[];
for (const browser of setup.profiles) {
  const resolved=path.resolve(browser.profile);
  assert.ok(resolved.startsWith(dir+path.sep), 'Profile must stay within the isolated test directory');
  const executable=browser.name==='chrome' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const debuggerPort=browser.name==='chrome'?9322:9323;
  const log=fs.openSync(path.join(dir,browser.name+'-visible.log'),'a');
  const child=spawn(executable,['--no-first-run','--disable-gpu','--disable-sync','--disable-features=msImplicitSignin','--disable-background-networking','--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debuggerPort,
    '--user-data-dir='+resolved,'--new-window',setup.url],{detached:true,windowsHide:false,stdio:['ignore',log,log]});
  fs.closeSync(log);
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();
  let ready=false;
  for(let attempt=0;attempt<40;attempt++) {
    try { const result=await fetch('http://127.0.0.1:'+debuggerPort+'/json/list');const pages=await result.json();ready=pages.some(page=>page.url===setup.url+'/');if(ready)break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,browser.name+' did not open the test page; inspect its visible log');
  await new Promise(resolve=>setTimeout(resolve,1500));
  const stillOpen=await fetch('http://127.0.0.1:'+debuggerPort+'/json/version');
  assert.ok(stillOpen.ok,browser.name+' closed during startup');
  opened.push({name:browser.name,pid:child.pid,debuggerPort});
}
fs.writeFileSync(path.join(dir,'opened-browsers.json'),JSON.stringify(opened,null,2));
console.log('Chrome and Edge opened with dedicated test profiles at '+setup.url);
console.log('Keep this process running while reviewing the two test windows.');
await new Promise(resolve=>{
  // Keep the runner alive: restricted Windows process jobs may close detached
  // browser children when their initiating command finishes.
  const keepAlive=setInterval(()=>{},10000);
  const stop=()=>{clearInterval(keepAlive);resolve();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
});
