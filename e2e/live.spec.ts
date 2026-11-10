import { expect, modeButton, sprite, test } from './fixtures';

/**
 * The whole path once against a real service: choosing the provider by name,
 * a real connection test, and a page translated and annotated by a real
 * model. It costs a little money, so it only runs when WISP_TEST_API_KEY is
 * set; WISP_TEST_PROVIDER names the provider as the options page lists it
 * (default DeepSeek).
 */
const apiKey = process.env.WISP_TEST_API_KEY ?? '';
const provider = process.env.WISP_TEST_PROVIDER ?? 'DeepSeek';
const CHINESE = /[\u4e00-\u9fff]/;

test('translates and annotates a page with a real model', async ({ context, site }) => {
  test.skip(!apiKey, 'needs WISP_TEST_API_KEY');
  test.setTimeout(120_000);

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await options.getByLabel('用哪家的模型').selectOption({ label: provider });
  await options.getByLabel('密钥').fill(apiKey);
  await options.getByLabel('密钥').blur();
  await expect(options.getByLabel('模型', { exact: true })).not.toHaveValue('');
  await expect(options.locator('#models option')).not.toHaveCount(0);
  await options.getByRole('button', { name: '保存并测试连接' }).click();
  await expect(options.getByRole('status')).toContainText('连接成功', { timeout: 60_000 });
  await options.close();

  const page = await context.newPage();
  await page.goto(`${site.origin}/article`);
  await sprite(page).click();
  for (const id of ['title', 'first', 'second']) {
    await expect(page.locator(`#${id} .wisp-translation`)).toHaveText(CHINESE, { timeout: 60_000 });
  }
  await expect(page.locator('#first .wisp-translation')).toContainText('编译器');

  // Learn mode ends without a failure, whether or not it finds anything worth a note in so plain a text.
  await modeButton(page).click();
  await expect(page.locator('#second[data-wisp-noted]')).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('#wisp-sprite [data-state="error"]')).toHaveCount(0);
  console.log(
    await page.locator('#first, #second').evaluateAll((blocks) => blocks.map((block) => block.textContent).join('\n')),
  );
});
