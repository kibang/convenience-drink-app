const { test, expect } = require("@playwright/test");
const fs = require("fs");

const ART = "/opt/cursor/artifacts";

function watch(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function mockWeather(page, rainy) {
  await page.route("**/api.open-meteo.com/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        rainy
          ? {
              current: { precipitation: 1.5, weather_code: 63 },
              hourly: { precipitation: [1.2, 0.8], precipitation_probability: [80, 70], weather_code: [63, 61] },
            }
          : {
              current: { precipitation: 0, weather_code: 1 },
              hourly: { precipitation: [0, 0], precipitation_probability: [0, 5], weather_code: [1, 2] },
            }
      ),
    })
  );
}

async function photosOk(page, root) {
  await page.locator(`${root} .place`).first().scrollIntoViewIfNeeded();
  await page.waitForFunction((sel) => {
    const first = document.querySelector(`${sel} .thumb`);
    if (!first) return false;
    const img = first.querySelector("img");
    const ph = first.querySelector(".ph");
    if (!img) return !!(ph && !ph.hidden);
    return img.complete;
  }, root);
  const kinds = await page.locator(`${root} .thumb`).evaluateAll((nodes) =>
    nodes.map((n) => {
      const img = n.querySelector("img");
      const ph = n.querySelector(".ph");
      if (!img) return ph && !ph.hidden ? "fallback" : "broken";
      if (!img.complete) return "pending";
      if (img.naturalWidth > 0 && !img.hidden) return "photo";
      if (ph && !ph.hidden) return "fallback";
      return "broken";
    })
  );
  expect(kinds.length).toBeGreaterThan(0);
  expect(kinds).not.toContain("broken");
  return kinds;
}

async function noOverflow(page) {
  const box = await page.evaluate(() => ({
    sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    iw: window.innerWidth,
  }));
  expect(box.sw).toBeLessThanOrEqual(box.iw + 1);
}

async function passMealPrefs(page) {
  await expect(page.getByRole("heading", { name: "어떻게 드실래요?" })).toBeVisible();
  await page.getByRole("button", { name: "건너뛰기" }).click();
  await expect(page.getByRole("heading", { name: "어떤 음식?" })).toBeVisible();
  await page.getByRole("button", { name: "건너뛰기" }).click();
  await expect(page.locator("#foodList .place").first()).toBeVisible();
}

async function chooseParty(page, name) {
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "어디서 시작할까요?" })).toBeVisible();
  await expect(page.locator("#originLabel")).toContainText("누리꿈스퀘어");
  await page.getByRole("button", { name: "이 위치로 식당 보기" }).click();
  await passMealPrefs(page);
}

test.beforeAll(() => fs.mkdirSync(ART, { recursive: true }));

test("인원을 고르기 전에는 식당이 나오지 않고, 네 인원 모두 식당이 있다", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("width=device-width");
  expect(viewport).toContain("initial-scale=1");
  expect(viewport).toContain("viewport-fit=cover");
  await expect(page.getByRole("heading", { name: "몇 명이서 드실 건가요?" })).toBeVisible();
  const partyCols = await page.locator("#partyChoices").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(partyCols).toBe(2);
  const partyH = await page.locator("#partyChoices button").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(partyH).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#step-food")).toBeHidden();
  await expect(page.locator("#foodList .place")).toHaveCount(0);
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_start.png` });
  await noOverflow(page);

  await chooseParty(page, "1명 (혼밥)");
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  await expect(page.locator("#foodList")).not.toContainText("전설의 우대갈비");
  await expect(page.locator("#foodList")).not.toContainText("롯데시네마");
  const mapH = await page.locator("#map").evaluate((el) => el.getBoundingClientRect().height);
  expect(mapH).toBeGreaterThanOrEqual(230);
  expect(mapH).toBeLessThanOrEqual(250);
  await expect.poll(async () => page.locator("#map .leaflet-tile").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length), { timeout: 20000 }).toBeGreaterThan(0);
  const foodCount = Number((await page.locator("#foodIntro").textContent()).match(/(\d+)곳/)[1]);
  expect(foodCount).toBeGreaterThan(8);
  await expect(page.locator("#map .pin.place")).toHaveCount(foodCount);
  expect(await page.locator("#foodList .place").count()).toBeLessThan(foodCount);
  const backH = await page.locator("#dockBack").evaluate((el) => el.getBoundingClientRect().height);
  expect(backH).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  await expect(page.locator("#step-food .map-attr")).toContainText("OpenStreetMap");
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_restaurants_solo.png` });
  await noOverflow(page);

  await page.locator("#steps").getByRole("button", { name: "인원" }).click();
  await chooseParty(page, "2명");
  await expect(page.locator("#foodList")).toContainText("그집김밥애라면");
  await expect(page.locator("#foodList")).not.toContainText("틈새라면");

  await page.locator("#steps").getByRole("button", { name: "인원" }).click();
  await chooseParty(page, "3~4명");
  await expect(page.locator("#foodList")).toContainText("새참당");
  await expect(page.locator("#foodList")).not.toContainText("틈새라면");

  await page.locator("#steps").getByRole("button", { name: "인원" }).click();
  await chooseParty(page, "5명 이상");
  await expect(page.locator("#foodList")).toContainText("전설의 우대갈비");
  await expect(page.locator("#foodList")).not.toContainText("틈새라면");
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("1명 코스: 식후는 카페·디저트만, 지도 마커는 목록과 같다", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  await chooseParty(page, "1명 (혼밥)");
  const foodCount = Number((await page.locator("#foodIntro").textContent()).match(/(\d+)곳/)[1]);
  await expect(page.locator("#map .pin.place")).toHaveCount(foodCount);
  await expect.poll(async () => page.locator("#map .leaflet-tile").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length), { timeout: 20000 }).toBeGreaterThan(0);
  const foodPhotos = await photosOk(page, "#foodList");
  expect(foodPhotos).toContain("photo");
  expect(foodPhotos).toContain("fallback");
  await expect(page.locator("#foodList .place", { hasText: "새참당" })).toContainText("사진: 네이버 블로그");
  await expect(page.locator("#foodList .place", { hasText: "맥도날드" })).toContainText("대표 이미지 · 가게 사진 아님");
  await noOverflow(page);
  if (testInfo.project.name === "phone") {
    await page.locator("#foodList .place").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_restaurants_photos.png` });
    await page.locator("#map").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_restaurants_map.png` });
  }

  await page.locator("#map").scrollIntoViewIfNeeded();
  await page.locator('#map .leaflet-marker-icon[title="미분당 상암DMC점"]').click();
  await expect(page.locator("#foodList .place.on")).toContainText("미분당");
  await expect(page.locator("#map .leaflet-popup-content")).toHaveCount(1);
  await expect(page.locator("#map .leaflet-popup-content")).toContainText("미분당");
  await expect(page.locator("#map .leaflet-popup-content")).toContainText("도보 약");
  await page.locator("#foodList .place", { hasText: "새참당" }).locator("h3").click();
  await expect(page.locator("#map .leaflet-popup-content")).toContainText("새참당");
  const nearCenter = await page.evaluate(() => {
    const mapEl = document.getElementById("map");
    const marker = mapEl.querySelector('.leaflet-marker-icon[title="새참당 상암DMC본점"]');
    const mr = marker.getBoundingClientRect();
    const br = mapEl.getBoundingClientRect();
    const dx = mr.left + mr.width / 2 - (br.left + br.width / 2);
    const dy = mr.top + mr.height / 2 - (br.top + br.height / 2);
    return Math.hypot(dx, dy) < 90;
  });
  expect(nearCenter).toBeTruthy();

  await page.locator(".place", { hasText: "틈새라면" }).getByRole("button", { name: "여기로 정하기" }).click();
  await expect(page.getByRole("heading", { name: "식후", exact: true })).toBeVisible();
  await expect(page.locator("#afterList")).toContainText("카페");
  await expect(page.locator("#afterList")).toContainText("디저트");
  await expect(page.locator("body")).not.toContainText("편의점");
  await expect(page.locator("#promoCard")).toHaveCount(0);
  const afterCount = Number((await page.locator("#afterIntro").textContent()).match(/(\d+)곳/)[1]);
  expect(afterCount).toBeGreaterThan(0);
  await expect(page.locator("#afterMap .pin.place")).toHaveCount(afterCount);
  await expect(page.locator("#afterMap .pin.chosen")).toHaveCount(1);
  await expect(page.locator("#afterMap .pin.me")).toHaveCount(1);
  const afterH = await page.locator("#afterMap").evaluate((el) => el.getBoundingClientRect().height);
  expect(afterH).toBeGreaterThanOrEqual(230);
  await expect.poll(async () => page.locator("#afterMap .leaflet-tile").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length), { timeout: 20000 }).toBeGreaterThan(0);
  const afterPhotos = await photosOk(page, "#afterList");
  expect(afterPhotos).toContain("photo");
  await noOverflow(page);
  if (testInfo.project.name === "phone") {
    await page.locator("#afterList .thumb img").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_after_photos.png` });
    await page.locator("#afterMap").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_after_map.png` });
  }
  await page.locator("#afterList .place").first().locator("summary").click();
  await expect(page.locator("#afterList .place").first()).toContainText("가봤어요");
  const cafe = page.locator("#afterList .place").first();
  const cafeName = (await cafe.locator("h3").textContent()).trim();
  await cafe.locator("h3").click();
  await expect(page.locator("#afterMap .leaflet-popup-content")).toContainText(cafeName);
  await expect(page.locator("#afterMap .leaflet-popup-content")).toContainText("도보 약");
  await noOverflow(page);

  await page.locator("#afterList .place").first().getByRole("button", { name: "식후로 정하기" }).click();
  await expect(page.getByRole("heading", { name: "코스", exact: true })).toBeVisible();
  await expect(page.locator("#rainBanner")).toBeHidden();
  await expect(page.locator("#courseList")).toContainText("DMC 야경");
  await page.locator("#courseList article", { hasText: "DMC 야경" }).getByRole("button", { name: "이 코스로" }).click();
  await expect(page.getByRole("heading", { name: "오늘의 코스" })).toBeVisible();
  await expect(page.locator("#summaryBody")).toContainText("틈새라면");
  await expect(page.locator("#summaryBody")).toContainText("추정");
  await expect(page.locator("#shareUrl")).toHaveValue(/party=1/);
  await expect(page.locator("#shareUrl")).toHaveValue(/rest=/);
  await expect(page.locator("#summaryMap .pin")).toHaveCount(3);
  await expect(page.locator("#summaryMap path.leaflet-interactive")).toHaveCount(1);
  const sumH = await page.locator("#summaryMap").evaluate((el) => el.getBoundingClientRect().height);
  expect(sumH).toBeGreaterThanOrEqual(230);
  await expect.poll(async () => page.locator("#summaryMap .leaflet-tile").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.locator("body")).not.toContainText("편의점");
  await page.locator("#summaryMap").scrollIntoViewIfNeeded();
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_course_summary.png` });
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.locator("#copyMsg")).toContainText("복사");
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("비 예보면 실내 코스로 바꾸고 야외로 되돌릴 수 있다", async ({ page }) => {
  const errors = watch(page);
  await mockWeather(page, true);
  await page.goto("/");
  await chooseParty(page, "1명 (혼밥)");
  await page.locator(".place", { hasText: "틈새라면" }).getByRole("button", { name: "여기로 정하기" }).click();
  await page.locator("#afterList .place").first().getByRole("button", { name: "식후로 정하기" }).click();
  await expect(page.locator("#rainBanner")).toContainText("비 예보가 있어 실내 코스로 바꿨어요");
  await expect(page.locator("#courseList")).toContainText("비 오는 날");
  await expect(page.locator("#courseList")).not.toContainText("DMC 야경");
  await page.getByRole("button", { name: "야외 코스 보기" }).click();
  await expect(page.locator("#courseList")).toContainText("DMC 야경");
  await page.getByRole("button", { name: "실내 코스로 돌아가기" }).click();
  await expect(page.locator("#courseList")).toContainText("비 오는 날");
  await expect(page.locator("#courseList")).not.toContainText("DMC 야경");
  expect(errors).toEqual([]);
});

test("가봤어요는 새로고침 뒤에도 흐리게 맨 아래 남고, 기록은 내보내고 가져온다", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  await chooseParty(page, "1명 (혼밥)");
  const before = await page.locator("#foodList .place h3").allTextContents();
  expect(before[0]).toContain("새참당");
  const openSaecham = async () => {
    const card = page.locator("#foodList .place", { hasText: "새참당" });
    if ((await card.locator("details").getAttribute("open")) === null) await card.locator("summary").click();
    return card;
  };
  if (testInfo.project.name === "phone") {
    const opened = await openSaecham();
    await opened.getByText("가봤어요").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_card_open.png` });
  }
  await (await openSaecham()).getByRole("checkbox", { name: "가봤어요" }).click();
  await expect(page.locator("#foodList .place.visited", { hasText: "새참당" })).toBeVisible();
  await expect(page.locator("#map .pin.visited")).toHaveCount(1);
  await (await openSaecham()).getByRole("checkbox", { name: /유린기/ }).click();
  const typed = await openSaecham();
  await typed.locator(".menu-input").fill("김치찌개");
  await typed.getByRole("button", { name: "추가" }).click();
  const card = () => page.locator("#foodList .place.visited", { hasText: "새참당" });
  await expect(card()).toContainText("김치찌개");
  await expect(card()).toContainText("유린기 덮밥");
  await expect(card()).toContainText("가본 곳");

  await page.reload();
  await chooseParty(page, "1명 (혼밥)");
  const names = await page.locator("#foodList .place h3").allTextContents();
  expect(names.at(-1)).toContain("새참당");
  expect(names[0]).not.toContain("새참당");
  const visited = page.locator("#foodList .place.visited", { hasText: "새참당" });
  await expect(visited).toContainText("가본 곳");
  await expect(visited).toContainText("김치찌개");
  await expect(visited.getByRole("button", { name: "여기로 정하기" })).toBeEnabled();
  if (testInfo.project.name === "phone") {
    await visited.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ART}/phone_visited_bottom.png` });
  }

  await page.getByRole("button", { name: "내 기록" }).click();
  await expect(page.locator("#logList")).toContainText("새참당");
  await expect(page.locator("#logList")).toContainText("김치찌개");
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_history.png` });
  await page.getByRole("button", { name: "내보내기" }).click();
  const raw = await page.locator("#transferJson").inputValue();
  const dumped = JSON.parse(raw);
  expect(dumped.places).toBeTruthy();
  expect(JSON.stringify(dumped)).toContain("김치찌개");

  await page.evaluate(() => localStorage.removeItem("course-history-v1"));
  await page.reload();
  await page.getByRole("button", { name: "내 기록" }).click();
  await expect(page.locator("#logList")).toContainText("아직 기록이 없어요");
  await page.locator("#transferJson").fill(raw);
  await page.getByRole("button", { name: "가져오기" }).click();
  await expect(page.locator("#logList")).toContainText("김치찌개");
  await page.getByRole("button", { name: "뒤로" }).click();
  await chooseParty(page, "1명 (혼밥)");
  const again = await page.locator("#foodList .place h3").allTextContents();
  expect(again.at(-1)).toContain("새참당");
  await expect(page.locator("#foodList .place.visited")).toContainText("유린기 덮밥");
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("위치 권한이 없어도 누리꿈스퀘어로 식당을 본다", async ({ page, context }) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await context.clearPermissions();
  await page.goto("/");
  await page.getByRole("button", { name: "1명 (혼밥)" }).click();
  await page.getByRole("button", { name: "내 위치로" }).click();
  await expect(page.locator("#locMsg")).toContainText("거부");
  await expect(page.locator("#originLabel")).toContainText("누리꿈스퀘어");
  await page.getByRole("button", { name: "이 위치로 식당 보기" }).click();
  await passMealPrefs(page);
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  expect(errors).toEqual([]);
});

test("홀과 음식 종류를 고르면 목록과 지도가 그 조건만 보여 준다", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "1명 (혼밥)" }).click();
  await page.getByRole("button", { name: "이 위치로 식당 보기" }).click();
  await expect(page.getByRole("heading", { name: "어떻게 드실래요?" })).toBeVisible();
  const hallCols = await page.locator("#hallChoices").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(hallCols).toBe(2);
  const hallH = await page.locator("#hallChoices button").first().evaluate((el) => el.getBoundingClientRect().height);
  expect(hallH).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("button", { name: "홀에서 먹기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "포장·배달도 OK" })).toBeVisible();
  await expect(page.getByRole("button", { name: "건너뛰기" })).toBeVisible();
  await noOverflow(page);
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_hall.png` });

  await page.getByRole("button", { name: "건너뛰기" }).click();
  await expect(page.getByRole("heading", { name: "어떤 음식?" })).toBeVisible();
  const foodCols = await page.locator("#cuisineChoices").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(foodCols).toBe(2);
  await expect(page.getByRole("button", { name: /^한식/ })).toContainText("4곳");
  await expect(page.getByRole("button", { name: /^일식/ })).toContainText("3곳");
  await expect(page.getByRole("button", { name: /^중식/ })).toContainText("1곳");
  await expect(page.getByRole("button", { name: /^양식/ })).toContainText("1곳");
  await expect(page.getByRole("button", { name: /^분식/ })).toContainText("2곳");
  await expect(page.getByRole("button", { name: /^면·라멘/ })).toContainText("4곳");
  await expect(page.getByRole("button", { name: /^패스트푸드/ })).toContainText("1곳");
  await expect(page.getByRole("button", { name: /고기/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^기타/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "상관없음" })).toBeVisible();
  await noOverflow(page);
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_food_types.png` });

  await page.getByRole("button", { name: /^한식/ }).click();
  await page.getByRole("button", { name: /^면·라멘/ }).click();
  await expect(page.locator('[data-food="han"]')).toHaveClass(/on/);
  await expect(page.locator('[data-food="noodle"]')).toHaveClass(/on/);
  await expect(page.locator('[data-food="any"]')).not.toHaveClass(/on/);
  await page.getByRole("button", { name: "이 음식으로" }).click();

  await expect(page.locator("#filterChips")).toContainText("한식");
  await expect(page.locator("#filterChips")).toContainText("면·라멘");
  await expect(page.locator("#foodList")).toContainText("새참당");
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  await expect(page.locator("#foodList")).not.toContainText("맥도날드");
  await expect(page.locator("#foodIntro")).toContainText("상암 조사");
  const mapH = await page.locator("#map").evaluate((el) => el.getBoundingClientRect().height);
  expect(mapH).toBeGreaterThanOrEqual(230);
  await expect.poll(async () => page.locator("#map .leaflet-tile").evaluateAll((imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length), { timeout: 20000 }).toBeGreaterThan(0);
  await noOverflow(page);
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_filtered_list.png` });

  await page.getByRole("button", { name: "한식 해제" }).click();
  await expect(page.locator("#filterChips")).not.toContainText("한식");
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  await expect(page.locator("#foodList")).not.toContainText("새참당");

  await page.locator("#steps").getByRole("button", { name: "음식" }).click();
  await page.getByRole("button", { name: /^한식/ }).click();
  await page.getByRole("button", { name: "이 음식으로" }).click();
  await expect(page.locator("#foodList")).toContainText("새참당");
  await page.locator("#steps").getByRole("button", { name: "홀" }).click();
  await page.getByRole("button", { name: "포장·배달도 OK" }).click();
  await expect(page.locator("#cuisineMissing")).toContainText("한식");
  await expect(page.getByRole("button", { name: /^분식/ })).toContainText("1곳");
  await expect(page.getByRole("button", { name: /^한식/ })).toHaveCount(0);
  await page.getByRole("button", { name: "이 음식으로" }).click();
  await expect(page.locator("#foodList")).toContainText("이 조건에 맞는 식당이 없어요");
  await expect(page.locator("#filterChips")).toContainText("포장·배달도 OK");
  await expect(page.locator("#filterChips")).toContainText("한식");
  const emptyMap = await page.locator("#map").evaluate((el) => el.getBoundingClientRect().height);
  expect(emptyMap).toBeGreaterThanOrEqual(230);
  await page.getByRole("button", { name: "조건 풀기" }).click();
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  await expect(page.locator("#foodList")).toContainText("새벽집");
  await expect(page.locator("#filterChips")).toBeEmpty();

  const openCard = async (name) => {
    const card = page.locator("#foodList .place", { hasText: name });
    if ((await card.locator("details").getAttribute("open")) === null) await card.locator("summary").click();
    return card;
  };
  await expect(await openCard("새참당")).toContainText("홀 있음");
  await expect(page.locator("#foodList .place", { hasText: "새참당" })).not.toContainText("홀 있을 수 있음");
  await expect(await openCard("그집김밥애라면")).toContainText("포장 후기가 있어요");
  await expect(await openCard("새벽집")).toContainText("홀 확인 필요");
  await noOverflow(page);
  expect(errors).toEqual([]);
});
