const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=http.createServer(async(req,res)=>{
 try{
  const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname),f=path.resolve(root,'.'+(p==='/'?'/index.html':p));
  if(!f.startsWith(root+path.sep))throw Error('Invalid path');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'text/plain'}).end(await fs.readFile(f));
 }catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=process.env.ENTRY_SITE||`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const checks=[],errors=[];
 try{
  for(const width of [360,390,1440]){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
   context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'#/home');await page.locator('.profiles-entry').waitFor();
   assert.equal(await page.locator('.profile-card').count(),0);
   assert.equal(await page.locator('.header-nav').isVisible(),false);
   await page.locator('.brand').click();assert.equal(await page.locator('.start-page').count(),0);
   await page.goto(base+'#/history');await page.locator('.profiles-entry').waitFor();
   await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('#profile-name').fill('小蓝');
   await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('.start-page').waitFor();
   assert.equal(new URL(page.url()).hash,'#/home');
   assert.ok((await page.locator('.profile-chip').innerText()).includes('小蓝'));
   assert.equal(await page.locator('.header-nav a[href="#/profiles"]').count(),0);
   await page.reload();await page.locator('.start-page').waitFor();
   await page.waitForFunction(()=>document.querySelector('#pwa-panel')?.dataset.ready==='true');
   await context.setOffline(true);await page.reload();await page.locator('.start-page').waitFor();
   const offlineTab=await context.newPage();await offlineTab.goto(base+'#/home');await offlineTab.locator('.profiles-entry').waitFor();
   await offlineTab.getByRole('button',{name:'选择并进入',exact:true}).click();await offlineTab.locator('.start-page').waitFor();
   await offlineTab.close();await context.setOffline(false);
   await page.locator('.profile-chip').click();await page.getByRole('button',{name:'创建档案',exact:true}).click();
   await page.locator('#profile-name').fill('小绿');await page.getByRole('button',{name:'创建档案',exact:true}).click();
   await page.locator('.profile-form').waitFor({state:'detached'});assert.equal(await page.locator('.profile-card').count(),2);
   const ids=await page.evaluate(async()=>{const {listProfiles}=await import(new URL('src/domain/profile.js',location.href).href);return listProfiles().map(p=>p.id);});
   await page.evaluate(async()=>{
    const {createSession,saveDraft}=await import(new URL('src/app/quizSession.js',location.href).href);
    const {generatePaper}=await import(new URL('src/domain/generator.js',location.href).href);
    createSession(generatePaper({kpIds:['G1-01'],count:5,types:['horizontal'],seed:1}));saveDraft('7');
   });
   const tab=await context.newPage();await tab.goto(base+'#/home');await tab.locator('.profiles-entry').waitFor();
   assert.equal(await tab.getByRole('button',{name:'选择并进入',exact:true}).count(),2);
   const second=tab.locator('.profile-card').filter({has:tab.getByRole('heading',{name:'小绿',exact:true})});
   tab.once('dialog',d=>d.dismiss());await second.getByRole('button',{name:'选择并进入',exact:true}).click();
   assert.equal(await tab.locator('.profiles-entry').count(),1);
   tab.once('dialog',d=>d.accept());await second.getByRole('button',{name:'选择并进入',exact:true}).click();await tab.locator('.start-page').waitFor();
   assert.ok((await tab.locator('.profile-chip').innerText()).includes('小绿'));
   const draft=await tab.evaluate(async id=>{const {read}=await import(new URL('src/core/storage.js',location.href).href);return read('quiz:active:'+id).draft;},ids[0]);
   assert.equal(draft,'7');
   await tab.locator('.entry-practice').click();await tab.locator('.practice-flow').waitFor();
   assert.equal(await tab.locator('.header-nav').isVisible(),true);
   assert.equal(await tab.locator('.nav-link').count(),5);
   assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await tab.locator('.brand').click();await tab.locator('.start-page').waitFor();
   await page.reload();await page.locator('.profiles-entry').waitFor();
   await page.locator('.profile-card').filter({has:page.getByRole('heading',{name:'小蓝',exact:true})}).getByRole('button',{name:'选择并进入',exact:true}).click();
   await page.locator('.start-page').waitFor();await page.getByRole('link',{name:'继续练习',exact:true}).click();
   await page.getByRole('button',{name:'继续练习',exact:true}).click();assert.equal(await page.locator('#quiz-answer').inputValue(),'7');
   checks.push({width,passed:true});await context.close();
  }
  const emptyContext=await browser.newContext({viewport:{width:390,height:844}}),last=await emptyContext.newPage();
  await last.goto(base+'#/home');await last.locator('.profiles-entry').waitFor();
  await last.getByRole('button',{name:'创建档案',exact:true}).click();await last.locator('#profile-name').fill('最后档案');
  await last.getByRole('button',{name:'创建档案',exact:true}).click();await last.locator('.start-page').waitFor();
  await last.locator('.profile-chip').click();last.once('dialog',d=>d.accept());
  await last.getByRole('button',{name:'删除',exact:true}).click();await last.locator('.profiles-entry').waitFor();
  assert.equal(await last.locator('.profile-card').count(),0);
  await last.reload();await last.locator('.profiles-entry').waitFor();assert.equal(await last.locator('.profile-card').count(),0);
  await emptyContext.close();
  checks.push({case:'delete final profile stays empty after refresh',passed:true});
  const blocked=await browser.newContext({viewport:{width:390,height:844}});
  await blocked.addInitScript(()=>Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('blocked','SecurityError');}}));
  const restricted=await blocked.newPage();await restricted.goto(base+'#/home');await restricted.locator('.profiles-entry').waitFor();
  await restricted.getByRole('button',{name:'创建档案',exact:true}).click();await restricted.locator('#profile-name').fill('本次档案');
  await restricted.getByRole('button',{name:'创建档案',exact:true}).click();await restricted.locator('.start-page').waitFor();
  await restricted.locator('.entry-history').click();await restricted.locator('.history-page').waitFor();
  await blocked.close();checks.push({case:'blocked session storage falls back to current document',passed:true});
  assert.deepEqual(errors,[]);
  await fs.mkdir(path.join(root,'.tmp'),{recursive:true});
  await fs.writeFile(path.join(root,'.tmp/profile-entry-results.json'),JSON.stringify({executedAt:new Date().toISOString(),passed:true,site:base,checks,errors},null,2));
  console.log('PASS: 360/390/1440px empty entry, create, reload, new tab selection, canceled switch, draft retention, five nav items and personal-info access');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
