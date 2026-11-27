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

async function noOverflow(page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(wide).toBeFalsy();
}

async function chooseParty(page, name) {
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "어디서 시작할까요?" })).toBeVisible();
  await expect(page.locator("#originLabel")).toContainText("누리꿈스퀘어");
  await page.getByRole("button", { name: "이 위치로 식당 보기" }).click();
  await expect(page.locator("#foodList .place").first()).toBeVisible();
}

test.beforeAll(() => fs.mkdirSync(ART, { recursive: true }));

test("인원을 고르기 전에는 식당이 나오지 않고, 네 인원 모두 식당이 있다", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "몇 명이서 드실 건가요?" })).toBeVisible();
  await expect(page.locator("#step-food")).toBeHidden();
  await expect(page.locator("#foodList .place")).toHaveCount(0);
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_start.png` });
  await noOverflow(page);

  await chooseParty(page, "1명 (혼밥)");
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  await expect(page.locator("#foodList")).not.toContainText("전설의 우대갈비");
  await expect(page.locator("#foodList")).not.toContainText("롯데시네마");
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  await expect(page.locator(".map-attr")).toContainText("OpenStreetMap");
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

test("1명 코스: 식후 행사 음료와 요약", async ({ page }, testInfo) => {
  const errors = watch(page);
  await mockWeather(page, false);
  await page.goto("/");
  await chooseParty(page, "1명 (혼밥)");
  await page.locator(".place", { hasText: "틈새라면" }).getByRole("button", { name: "여기로 정하기" }).click();
  await expect(page.getByRole("heading", { name: "식후", exact: true })).toBeVisible();
  await expect(page.locator("#afterList")).toContainText("카페");
  await expect(page.locator("#afterList")).toContainText("디저트");
  await expect(page.locator("#afterList")).toContainText("편의점");
  await expect(page.locator("#promoCard")).toContainText("왜 추천?");
  await expect(page.locator("#promoCard")).toContainText("행사 데이터 수집");
  const drink = page.locator("#promoCard .drink").first();
  await expect(drink).toBeVisible();
  const row = await drink.evaluate((el) => ({ name: el.dataset.name, price: el.dataset.price, promo: el.dataset.promo, chain: el.dataset.chain }));
  expect(["CU", "emart24"]).toContain(row.chain);
  expect(row.promo).toMatch(/1\+1|2\+1|할인|덤증정|골라담기/);
  const found = await page.evaluate((item) => {
    const data = window.DRINK_DATA.items;
    return data.some((x) => x.name === item.name && x.chain === item.chain && String(x.price) === item.price && x.promo === item.promo);
  }, row);
  expect(found).toBeTruthy();
  await expect(page.locator("#afterList .place").first().locator("details")).toHaveCount(0);

  await page.locator("#afterList .place", { hasText: "편의점" }).first().getByRole("button", { name: "식후로 정하기" }).click();
  await expect(page.getByRole("heading", { name: "코스", exact: true })).toBeVisible();
  await expect(page.locator("#rainBanner")).toBeHidden();
  await expect(page.locator("#courseList")).toContainText("DMC 야경");
  await page.locator("#courseList article", { hasText: "DMC 야경" }).getByRole("button", { name: "이 코스로" }).click();
  await expect(page.getByRole("heading", { name: "오늘의 코스" })).toBeVisible();
  await expect(page.locator("#summaryBody")).toContainText("틈새라면");
  await expect(page.locator("#summaryBody")).toContainText("추정");
  await expect(page.locator("#shareUrl")).toHaveValue(/party=1/);
  await expect(page.locator("#shareUrl")).toHaveValue(/rest=/);
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.locator("#copyMsg")).toContainText("복사");
  if (testInfo.project.name === "phone") await page.screenshot({ path: `${ART}/phone_course_summary.png` });
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
  await expect(page.locator("#foodList")).toContainText("틈새라면");
  expect(errors).toEqual([]);
});
