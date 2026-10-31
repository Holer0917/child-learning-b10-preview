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
 const base=process.env.STATS_SITE||`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),checks=[];
 try{
  for(const width of [360,390,1440]){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'#/home');await page.getByRole('button',{name:'创建档案',exact:true}).click();
   await page.locator('#profile-name').fill('统计检查');await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('.start-page').waitFor();
   await page.goto(base+'#/stats');await page.locator('.stats-page').waitFor();
   const mastery=page.locator('details[data-stats-section="mastery"]'),calendar=page.locator('details[data-stats-section="calendar"]');
   assert.equal(await mastery.evaluate(n=>n.open),false);assert.equal(await calendar.evaluate(n=>n.open),false);
   await mastery.locator('summary').click();await page.getByText('还没有练习过的知识点。',{exact:true}).waitFor();
   await mastery.locator('summary').click();
   await page.evaluate(async()=>{
    const {write}=await import(new URL('src/core/storage.js',location.href).href);
    const {getActiveProfile}=await import(new URL('src/domain/profile.js',location.href).href);
    const id=getActiveProfile().id;
    write('sessions:'+id,[10,50,70,95].map((correct,i)=>({id:'fold-'+i,profileId:id,finishedAt:Date.now()-i*1000,total:100,correct,wrong:100-correct,skipped:0,elapsedMs:1000,compressed:true,kpAnswered:{['G1-0'+(i+1)]:100},kpCorrect:{['G1-0'+(i+1)]:correct}})));
   });
   await page.reload();await page.locator('.stats-page').waitFor();
   assert.equal(await mastery.evaluate(n=>n.open),false);assert.equal(await calendar.evaluate(n=>n.open),false);
   assert.equal(await page.locator('.mastery-list').isVisible(),false);assert.equal(await page.locator('.activity-calendar').isVisible(),false);
   assert.equal(await page.locator('.priority-practice a:visible').count(),3);
   for(const summary of [mastery.locator('summary'),calendar.locator('summary')])assert.ok((await summary.boundingBox()).height>=44);
   await mastery.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.mastery-entry:visible').count(),4);
   await calendar.locator('summary').click();assert.equal(await page.locator('.activity-day:visible').count(),56);
   await page.locator('#range-7').click();assert.equal(await mastery.evaluate(n=>n.open),true);assert.equal(await calendar.evaluate(n=>n.open),true);
   await mastery.locator('summary').focus();await page.keyboard.press('Space');assert.equal(await mastery.evaluate(n=>n.open),false);assert.equal(await calendar.evaluate(n=>n.open),true);
   await calendar.locator('summary').click();assert.equal(await calendar.evaluate(n=>n.open),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(!process.env.STATS_SITE){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await fs.mkdir(path.join(root,'.tmp'),{recursive:true});await page.screenshot({path:path.join(root,'.tmp',`stats-fold-${width}.png`),fullPage:true});}
   await page.locator('.priority-practice a').first().click();await page.locator('#custom-count').waitFor();
   assert.ok(new URL(page.url()).hash.includes('kp=G1-01'));
   await page.goto(base+'#/stats');await page.locator('.stats-page').waitFor();
   assert.equal(await mastery.evaluate(n=>n.open),false);assert.equal(await calendar.evaluate(n=>n.open),false);
   assert.deepEqual(errors,[]);checks.push({width,passed:true});await context.close();
  }
  await fs.mkdir(path.join(root,'.tmp'),{recursive:true});
  await fs.writeFile(path.join(root,'.tmp/stats-fold-results.json'),JSON.stringify({executedAt:new Date().toISOString(),passed:true,site:base,checks},null,2));
  console.log('PASS: default collapsed, independent click/Enter/Space toggles, range-state preservation, empty state, 56-day calendar, recommendation links at 360/390/1440px');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
