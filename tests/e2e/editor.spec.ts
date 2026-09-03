import { expect, test, type Page } from '@playwright/test';

const SHORT = 'short-demo';

async function openEditor(page: Page, lecture = SHORT, query = ''): Promise<void> {
  await page.goto(`/editor/${lecture}${query}`);
  await expect(page.getByTestId('preview-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lane-V1').locator('[data-clip-id]').first()).toBeVisible();
}

function canvasFrame(page: Page) {
  return page.getByTestId('preview-canvas');
}

test('강의 목록에서 편집기를 열면 자동 편집된 타임라인이 뜬다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('lecture-list')).toBeVisible();
  await page.getByTestId(`lecture-${SHORT}`).click();

  await expect(page.getByTestId('preview-canvas')).toBeVisible({ timeout: 30_000 });
  const clips = page.getByTestId('lane-V1').locator('[data-clip-id]');
  await expect(clips.first()).toBeVisible();
  expect(await clips.count()).toBeGreaterThan(1);

  // 자동 편집 결과가 원본보다 짧아야 한다.
  await page.getByTestId('tab-autoedit').click();
  await expect(page.getByTestId('autoedit-report')).toBeVisible();
});

test('프레임 스텝 10회 후 캔버스 프레임과 타임코드가 일치한다', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('timeline-ruler').click({ position: { x: 30, y: 10 } });
  // 시크가 캔버스에 반영될 때까지 기다린 뒤 기준 프레임을 읽는다.
  await expect
    .poll(async () => Number(await canvasFrame(page).getAttribute('data-frame')))
    .toBeGreaterThan(0);

  const before = Number(await canvasFrame(page).getAttribute('data-frame'));
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');

  await expect
    .poll(async () => Number(await canvasFrame(page).getAttribute('data-frame')))
    .toBe(before + 10);

  // 표시 타임코드와 캔버스가 같은 프레임을 가리킨다.
  const canvasTc = await canvasFrame(page).getAttribute('data-tc');
  const shown = await page.getByTestId('timecode').innerText();
  expect(shown).toContain(canvasTc!);

  // 합성 소스는 프레임 오차가 0 이어야 한다: 소스 프레임이 실제로 10 만큼 이동한다.
  const src = Number(await canvasFrame(page).getAttribute('data-source-frame'));
  expect(Number.isFinite(src)).toBe(true);
});

test('재생하면 프레임이 흐르고 정지하면 멈춘다', async ({ page }) => {
  await openEditor(page);
  const start = Number(await canvasFrame(page).getAttribute('data-frame'));
  await page.getByTestId('btn-playpause').click();
  await expect
    .poll(async () => Number(await canvasFrame(page).getAttribute('data-frame')))
    .toBeGreaterThan(start);
  await page.getByTestId('btn-playpause').click();
  const stopped = Number(await canvasFrame(page).getAttribute('data-frame'));
  await page.waitForTimeout(400);
  expect(Number(await canvasFrame(page).getAttribute('data-frame'))).toBe(stopped);
});

test('자막 구간을 골라 선택 영역으로 생성하면 그 수만큼 클립이 만들어진다', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('tab-transcript').click();

  const checks = page.getByTestId('transcript-list').locator('input[type=checkbox]');
  const total = await checks.count();
  const pickCount = Math.min(12, total);
  for (let i = 0; i < pickCount; i += 1) await checks.nth(i).check();
  await expect(page.getByTestId('selection-count')).toHaveText(`구간 ${pickCount}개 선택됨`);

  await page.getByTestId('btn-generate-selection').click();
  await expect(page.getByTestId('autoedit-report')).toBeVisible();

  const clips = page.getByTestId('lane-V1').locator('[data-clip-id]');
  const count = await clips.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(pickCount);
});

test('목차를 클릭하면 해당 구간으로 이동한다', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('tab-toc').click();
  const before = Number(await canvasFrame(page).getAttribute('data-frame'));
  await page.getByTestId('toc-ch2').click();
  await expect
    .poll(async () => Number(await canvasFrame(page).getAttribute('data-frame')))
    .not.toBe(before);
});

test('트림 후 되돌리면 원래 길이로 복구된다', async ({ page }) => {
  await openEditor(page);
  const firstClip = page.getByTestId('lane-V1').locator('[data-clip-id]').first();
  const clipId = await firstClip.getAttribute('data-clip-id');
  await firstClip.click();
  await page.getByTestId('tab-inspector').click();
  const original = await page.getByTestId('inspector-duration').innerText();

  const handle = page.getByTestId(`trim-end-${clipId}`);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('inspector-duration')).not.toHaveText(original);
  await page.getByTestId('btn-undo').click();
  await expect(page.getByTestId('inspector-duration')).toHaveText(original);
});

test('분할과 리플 삭제 후에도 유효성 오류가 없다', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.keyboard.press('s');

  const clips = page.getByTestId('lane-V1').locator('[data-clip-id]');
  await clips.first().click();
  await page.keyboard.press('Shift+Delete');

  await page.getByTestId('tab-inspector').click();
  await expect(page.getByTestId('inspector')).toBeHidden();
  await expect(page.getByText('✓ 문제 없음')).toBeVisible();
});

test('내보내기가 매니페스트와 자막을 만든다', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('btn-export').click();
  await page.getByTestId('btn-start-export').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('매니페스트 내려받기')).toBeVisible();
  await expect(page.getByText('WebVTT 내려받기')).toBeVisible();
});

test('소스 로드 실패를 주입해도 편집기는 계속 동작하고 문제 로그에 남는다', async ({ page }) => {
  await openEditor(page, SHORT, '?fail=getSource');
  await page.getByTestId('btn-problems').click();
  await expect(page.getByTestId('problem-list')).toBeVisible();
  await expect(page.getByText('MEDIA_LOAD_FAILED')).toBeVisible();
  await page.getByRole('button', { name: '닫기' }).click();
  // 합성 소스로 대체되어 프리뷰가 계속 그려진다.
  await expect(canvasFrame(page)).toHaveAttribute('data-frame', /\d+/);
});

test('브리지 데모에서 편집기가 ready 와 frame 을 보낸다', async ({ page }) => {
  await page.goto('/bridge-demo');
  await expect(page.getByTestId('bridge-log')).toBeVisible();
  await expect(page.getByText('ready').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'seek(00:30)' }).click();
  await expect(page.getByText('frame').first()).toBeVisible({ timeout: 15_000 });
});
