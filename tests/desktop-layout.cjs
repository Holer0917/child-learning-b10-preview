const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
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
 const base=process.env.LAYOUT_SITE||`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),checks=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'#/home');await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('#profile-name').fill('布局检查');
  await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('.start-page').waitFor();
  await page.evaluate(async()=>{
   const {write}=await import(new URL('src/core/storage.js',location.href).href),{getActiveProfile}=await import(new URL('src/domain/profile.js',location.href).href);const id=getActiveProfile().id;
   write('sessions:'+id,[10,50,70,95].map((correct,i)=>({id:'layout-'+i,profileId:id,finishedAt:Date.now()-i*1000,total:100,correct,wrong:100-correct,skipped:0,elapsedMs:1000,compressed:true,kpAnswered:{['G1-0'+(i+1)]:100},kpCorrect:{['G1-0'+(i+1)]:correct}})));
  });
  for(const width of [390,1024,1099,1100,1280,1440,1920,2560]){
   await page.setViewportSize({width,height:width>=1920?1080:900});
   for(const route of ['home','practice','history','mistakes','stats','settings','profiles']){
    await page.goto(base+'#/'+route);await page.locator('#app h1').waitFor();await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${route}/${width}`);
    if(width>=1100){
     const app=await page.locator('#app').boundingBox(),header=await page.locator('#topbar').boundingBox();
     assert.ok(app.width>=width-1);assert.ok(header.width>=width-1);
     if(route==='stats'){
      const stats=await page.locator('.stats-page').boundingBox(),trend=await page.locator('.stats-trend').boundingBox(),mastery=await page.locator('.mastery-card').boundingBox();
      assert.ok(stats.width>=width*.9);assert.ok(mastery.x>trend.x+trend.width);assert.ok(Math.abs(mastery.y-trend.y)<2);
     }
     if(route==='settings'){
      const cards=await page.locator('.settings-page>.card').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y};}));
      assert.equal(cards.length,3);assert.ok(cards.every(n=>Math.abs(n.y-cards[0].y)<2));assert.ok(cards[2].x>cards[1].x&&cards[1].x>cards[0].x);
      const bounds=await page.locator('.site-footer').boundingBox();assert.ok(bounds.y+bounds.height>=page.viewportSize().height-1);
     }
    }else if(route==='stats')assert.equal(await page.locator('.stats-page').evaluate(n=>getComputedStyle(n).display),'block');
    if(!process.env.LAYOUT_SITE&&[390,1920].includes(width)&&['stats','settings','home'].includes(route)){
     await fs.mkdir(path.join(root,'.tmp'),{recursive:true});await page.screenshot({path:path.join(root,'.tmp',`desktop-${route}-${width}.png`),fullPage:true});
    }
    checks.push({width,route,passed:true});
   }
  }
  assert.deepEqual(errors,[]);await fs.mkdir(path.join(root,'.tmp'),{recursive:true});await fs.writeFile(path.join(root,'.tmp/desktop-layout-results.json'),JSON.stringify({executedAt:new Date().toISOString(),passed:true,site:base,checks,errors},null,2));
  console.log('PASS: 56 route/viewport checks, fluid desktop width, stats/settings columns, full-height canvas, mobile unchanged');await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
