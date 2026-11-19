// Real browser check against a disposable test app; never accepts a remote origin.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

let input='';
for await(const chunk of process.stdin)input+=chunk;
const fixture=JSON.parse(input);
if(new URL(fixture.url).hostname!=='127.0.0.1')throw Error('Loopback test app required');
const profile=mkdtempSync(join(tmpdir(),'managerhr-org-browser-'));
const browser=spawn(fixture.browser,['--headless=new','--disable-gpu','--no-first-run','--disable-extensions',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
browser.on('error',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
let nextId=0;
const pending=new Map();
const exceptions=[];
async function until(check,label){for(let n=0;n<150;n++){if(await check())return;await delay(100);}throw Error('Timeout: '+label);}
async function send(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value;}
try{
  await until(()=>existsSync(join(profile,'DevToolsActivePort')),'headless browser startup');
  const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);});
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(const identity of fixture.identities){
    await send('Network.clearBrowserCookies');
    await send('Page.navigate',{url:fixture.url+'/login'});
    await until(()=>evaluate("!!document.querySelector('input[name=email]')"),'login form');
    await evaluate(`document.querySelector('input[name=email]').value=${JSON.stringify(identity.email)};document.querySelector('input[name=password]').value=${JSON.stringify(fixture.password)};document.querySelector('form').requestSubmit();`);
    await until(()=>evaluate("location.pathname==='/app' && !document.querySelector('input[name=password]')"),'authenticated app');
    await send('Page.navigate',{url:fixture.url+'/admin/org-chart'});
    await until(()=>evaluate("document.body.innerText.includes('Visible Department') && document.body.innerText.includes('Nested Team')"),'chart data');
    const body=await evaluate('document.body.innerText');
    if(identity.role==='MANAGER'&&body.includes('Private Department'))throw Error('Manager chart leaked private branch');
    if(identity.role==='ADMIN'&&!body.includes('Private Department'))throw Error('Admin chart missing tenant branch');
    if(!await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Thu gọn'))"))throw Error('Collapse action missing');
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Thu gọn')).click()");
    await until(()=>evaluate("!document.body.innerText.includes('Nested Team')"),'collapsed branch');
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Mở rộng')).click()");
    await until(()=>evaluate("document.body.innerText.includes('Nested Team')"),'expanded branch');
    if(identity.role==='MANAGER'){
      if(!await evaluate("!!document.querySelector('a[href=\"/admin/departments\"]')"))throw Error('Scoped navigation missing');
      await evaluate('document.fonts.ready.then(()=>true)');
      if(!await evaluate("document.fonts.check('16px Roboto') && getComputedStyle(document.body).fontFamily.includes('Roboto')"))throw Error('Roboto unavailable');
      if(fixture.evidence){mkdirSync(fixture.evidence,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(fixture.evidence,'manager-desktop.png'),Buffer.from(shot.data,'base64'));}
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await delay(300);
      if(await evaluate('document.documentElement.scrollWidth>innerWidth+1'))throw Error('Mobile horizontal overflow');
      if(await evaluate("document.querySelector('.org-view>.dash-page-subtitle').scrollWidth>document.querySelector('.org-view>.dash-page-subtitle').clientWidth+1"))throw Error('Mobile subtitle clipped');
      if(fixture.evidence){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(fixture.evidence,'manager-mobile.png'),Buffer.from(shot.data,'base64'));}
      for(const path of ['/admin/departments','/admin/positions']){
        await send('Page.navigate',{url:fixture.url+path});
        await until(()=>evaluate(`document.body.innerText.includes(${JSON.stringify(path.endsWith('positions')?'Scoped Position':'Visible Department')})`),'scoped listing');
        const text=await evaluate('document.body.innerText');
        if(text.includes('Private Department')||text.includes('Private Position')||text.includes('+ Thêm'))throw Error('Manager listing scope or mutation controls incorrect');
      }
    }
    console.log('PASS authenticated browser '+identity.role+' chart, scope and expand/collapse');
  }
  if(exceptions.length)throw Error('Browser runtime exceptions: '+exceptions.length);
  console.log('PASS Roboto, mobile layout, scoped navigation and no runtime exceptions');
}finally{
  if(socket?.readyState===1){try{await send('Browser.close');}catch{/* Browser closes its socket. */}socket.close();}
  if(browser.exitCode===null)browser.kill();
  await delay(600);
  // Only remove this mkdtemp-created profile beneath the OS temporary directory.
  if(dirname(resolve(profile))===resolve(tmpdir())&&basename(profile).startsWith('managerhr-org-browser-')){
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{/* Browser may release files after exit. */}
  }
}
