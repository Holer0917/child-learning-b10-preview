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
 const base=process.env.ANIMAL_SITE||`http://127.0.0.1:${server.address().port}/`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}),checks=[];
 try{
  for(const [width,height] of [[360,640],[390,844],[568,320],[1440,900]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:width<1000,hasTouch:width<1000}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'#/home');await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('#profile-name').fill('动物反馈检查');
   await page.getByRole('button',{name:'创建档案',exact:true}).click();await page.locator('.start-page').waitFor();
   await page.waitForFunction(()=>document.querySelector('#pwa-panel').dataset.ready==='true');
   await page.evaluate(async()=>{
    const {createSession}=await import(new URL('src/app/quizSession.js',location.href).href),{generatePaper}=await import(new URL('src/domain/generator.js',location.href).href);
    createSession(generatePaper({kpIds:['G1-03'],count:5,types:['horizontal'],seed:1}));location.hash='#/quiz?start=1';
   });await page.locator('#quiz-answer').waitFor();
   const answer=()=>page.evaluate(async()=>{const {resumeSession}=await import(new URL('src/app/quizSession.js',location.href).href);const s=resumeSession();return s.paper.questions[s.cursor].answer;});
   const enter=async value=>{await page.locator('#quiz-answer').evaluate((n,v)=>{n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.locator('#submit-answer').click();};
   const fit=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width<1000)assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),true,`${width}x${height} feedback scroll`);assert.equal(await page.locator('.quiz-actions button').evaluateAll(ns=>ns.every(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>=44&&r.height>=44&&(hit===n||n.contains(hit));})),true);};
   const image=async file=>{await page.locator(`.feedback-animal[src$="/${file}.png"]`).waitFor();await page.waitForFunction(()=>document.querySelector('.feedback-animal')?.naturalWidth>0);await fit();};
   await enter('abc');assert.equal(await page.locator('.feedback-animal').count(),0);
   await context.setOffline(true);await enter(await answer());await image('correct');assert.equal(await page.locator('.animal-title').textContent(),'答对了！');
   if(!process.env.ANIMAL_SITE&&width===390)await page.screenshot({path:path.join(root,'.tmp/animal-correct.png')});
   await page.getByText('第 2 / 共 5 题',{exact:true}).waitFor();assert.equal(await page.locator('.feedback-animal').count(),0);
   await enter('999');await image('incorrect');assert.equal(await page.locator('.animal-title').textContent(),'答错了，再试试');assert.ok((await page.locator('#answer-status').textContent()).includes('正确答案'));
   if(!process.env.ANIMAL_SITE&&[390,1440].includes(width))await page.screenshot({path:path.join(root,'.tmp',`animal-incorrect-${width}.png`)});
   await page.locator('.feedback-animal').evaluate(n=>{n.src='missing-feedback-art.png';});
   await page.locator('.feedback-animal').waitFor({state:'hidden'});assert.equal(await page.locator('.animal-title').isVisible(),true);
   await page.reload();await page.getByRole('button',{name:'继续练习',exact:true}).click();await image('incorrect');
   await page.locator('#retry-answer').click();assert.equal(await page.locator('.feedback-animal').count(),0);
   await enter(await answer());await image('correct');assert.ok((await page.locator('#answer-status').textContent()).includes('首次成绩保留'));
   await page.getByText('第 3 / 共 5 题',{exact:true}).waitFor();await page.locator('#skip-question').click();assert.equal(await page.locator('.feedback-animal').count(),0);await fit();
   assert.deepEqual(errors,[]);checks.push({width,height,passed:true});await context.close();
  }
  await fs.mkdir(path.join(root,'.tmp'),{recursive:true});await fs.writeFile(path.join(root,'.tmp/animal-feedback-results.json'),JSON.stringify({executedAt:new Date().toISOString(),passed:true,site:base,checks},null,2));
  console.log('PASS: correct/regret images with cartoon text, offline image restore, retry clears art and preserves first score, invalid/skip have no judgment image, mobile single-screen at 360/390/568/1440');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
