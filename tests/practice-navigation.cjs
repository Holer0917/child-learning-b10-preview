// 按可见按钮走完出题向导；不修改应用内部状态。
const activate = (page, selector, touch) => page.locator(selector)[touch ? 'tap' : 'click']();
async function returnToSettings(page, touch = false) {
  await page.locator('#practice-next-1, #practice-next-2, #custom-count, #preview-back').first().waitFor();
  if (await page.locator('#preview-back').isVisible()) await activate(page, '#preview-back', touch);
}
async function toKnowledgeStep(page, touch = false) {
  await returnToSettings(page, touch);
  await page.locator('#practice-next-1, #practice-next-2, #custom-count').first().waitFor();
  if (await page.locator('#practice-next-1').isVisible()) await activate(page, '#practice-next-1', touch);
  else if (await page.locator('#custom-count').isVisible()) await activate(page, '#practice-step-2', touch);
  await page.locator('#choose-kp').waitFor();
}
async function openKnowledge(page, touch = false) {
  if (await page.locator('.kp-dialog').isVisible()) return;
  await toKnowledgeStep(page, touch);
  await activate(page, '#choose-kp', touch);
}
async function toSettings(page, touch = false) {
  await returnToSettings(page, touch);
  await page.locator('#practice-next-1, #practice-next-2, #custom-count').first().waitFor();
  if (await page.locator('#practice-next-1').isVisible()) await activate(page, '#practice-next-1', touch);
  if (await page.locator('#practice-next-2').isVisible()) {
    if (!(await page.locator('#practice-next-2').isEnabled())) throw new Error('未选择知识点，不能进入练习设置');
    await activate(page, '#practice-next-2', touch);
  }
  await page.locator('#custom-count').waitFor();
}
async function selectGrade(page, name, touch = false) {
  await returnToSettings(page, touch);
  await activate(page, '#practice-step-1', touch);
  await page.getByRole('button', { name, exact: true })[touch ? 'tap' : 'click']();
  await toSettings(page, touch);
}
module.exports = { toKnowledgeStep, openKnowledge, toSettings, selectGrade };
