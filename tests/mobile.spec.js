const { test, expect } = require("@playwright/test");
const fs = require("fs");

const ART = "/opt/cursor/artifacts";
const CITY_HALL = { latitude: 37.5663, longitude: 126.9779 };
const ARIRANG = { latitude: 37.6012361, longitude: 127.0088198 };

function attach(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function noOverlap(page) {
  const box = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, vis: b.width > 0 && b.height > 0 };
    };
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      header: r("header"),
      map: r("#map"),
      tabs: r("[role=tablist]"),
      panel: r('[role="tabpanel"]:not([hidden])'),
    };
  });
  expect(box.sw).toBeLessThanOrEqual(box.cw + 1);
  const ov = (a, b) =>
    a && b && a.vis && b.vis && a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
  expect(ov(box.header, box.map)).toBeFalsy();
  expect(ov(box.map, box.tabs)).toBeFalsy();
  expect(ov(box.tabs, box.panel)).toBeFalsy();
  expect(box.map.w).toBeGreaterThan(300);
  expect(box.map.w).toBeLessThanOrEqual(box.cw + 1);
  const spill = await page.evaluate(() =>
    [...document.querySelectorAll(".food-card, .item, .chip, .tabs button, input, select, .maplink, .store-hit")].some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
    })
  );
  expect(spill).toBeFalsy();
}

async function useHere(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "현재 위치 사용" }).click();
  await expect(page.locator("#locMsg")).toContainText("반경");
  await expect(page.locator(".pin.me")).toBeVisible();
  await expect(page.locator(".store-pin").first()).toBeVisible();
  await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
  await expect(page.locator(".map-attr a")).toHaveAttribute("href", /openstreetmap\.org\/copyright/);
}

async function photoAudit(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".food-card img")].every((img) => img.complete), null, { timeout: 20000 });
  const cards = await page.locator(".food-card").evaluateAll((els) =>
    els.map((el) => ({
      kind: el.dataset.kind,
      cap: el.querySelector(".photo-cap")?.textContent || "",
      src: el.querySelector("img")?.getAttribute("src") || "",
    }))
  );
  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) {
    expect(c.src).not.toMatch(/unsplash|pexels|pixabay|placeholder\.com|loremflickr|foodish/i);
    if (c.kind === "1") {
      expect(c.cap).toContain("OSM");
    } else if (c.kind === "2") {
      expect(c.cap).toMatch(/이 매장 사진이 아님|대신 넣지 않았습니다/);
      expect(c.cap).not.toContain("이 식당의 OSM");
    } else if (c.kind === "3") {
      expect(c.cap).toContain("일반 음식");
      expect(c.cap).toContain("아님");
    } else {
      expect(c.cap).toContain("등록된 매장 사진 없음");
      expect(c.src).toBe("");
    }
  }
  expect(cards.some((c) => c.kind === "0")).toBeTruthy();
  expect(cards.some((c) => c.kind === "2" || c.kind === "1")).toBeTruthy();
  const dists = (await page.locator(".food-card .dist").allTextContents()).map((t) => parseInt(t, 10));
  const sorted = [...dists].sort((a, b) => a - b);
  expect(dists).toEqual(sorted);
  for (const d of dists) expect(d).toBeLessThanOrEqual(1000);
  const href = await page.locator(".maplink").first().getAttribute("href");
  expect(href).toContain("openstreetmap.org");
  expect(href).toContain("mlat=");
}

test.beforeAll(() => {
  fs.mkdirSync(ART, { recursive: true });
});

test.describe("서울시청", () => {
  test.use({ geolocation: CITY_HALL, permissions: ["geolocation"] });

  test("지도, 편의점 필터, 혼밥 탭", async ({ page }) => {
    const errors = attach(page);
    await useHere(page);
    await noOverlap(page);
    await page.screenshot({ path: `${ART}/mobile_cityhall_convenience_map.png` });

    const before = await page.locator(".store-pin").count();
    await page.selectOption("#radius", "500");
    await expect(page.locator("#locMsg")).toContainText("500m");
    const after = await page.locator(".store-pin").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    const storeDists = await page.locator("#storeList .store-hit").allTextContents();
    for (const t of storeDists) {
      const m = t.match(/(\d+)m/);
      expect(m).toBeTruthy();
      expect(Number(m[1])).toBeLessThanOrEqual(500);
    }
    await page.selectOption("#radius", "1000");
    await expect(page.locator("#locMsg")).toContainText("1000m");

    await page.locator("#fGenre .chip", { hasText: "커피" }).click();
    await expect(page.locator(".item").first()).toBeVisible();
    const genres = await page.locator(".item").evaluateAll((els) => els.map((e) => e.dataset.genre));
    expect(genres.length).toBeGreaterThan(0);
    expect(new Set(genres)).toEqual(new Set(["커피"]));
    await page.getByRole("button", { name: "초기화" }).click();
    await expect(page.locator("#fGenre .chip.on")).toHaveCount(0);

    const pin = page.locator('.store-pin[data-chain="CU"]').first();
    await expect(pin).toBeVisible();
    await pin.evaluate((el) => {
      el.closest(".leaflet-marker-icon").style.zIndex = "10000";
    });
    await pin.click();
    await expect(page.locator("#pickMsg")).toContainText("CU");
    await expect(page.locator("#pickMsg")).toContainText("브랜드 행사");
    await expect(page.locator("#fChain .chip.on")).toHaveText("CU");
    const chains = await page.locator(".item").evaluateAll((els) => els.map((e) => e.dataset.chain));
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.every((c) => c === "CU")).toBeTruthy();
    await expect(page.locator(".item.picked").first()).toBeVisible();
    await expect(page.locator(".item.picked mark").first()).toHaveText("선택");
    await page.screenshot({ path: `${ART}/mobile_cityhall_store_filter.png` });
    await page.getByRole("button", { name: "매장 선택 해제" }).click();
    await expect(page.locator("#pickMsg")).toBeHidden();
    await expect(page.locator("#fChain .chip.on")).toHaveCount(0);

    await page.getByRole("tab", { name: "혼밥 식당" }).click();
    await expect(page.getByRole("tab", { name: "혼밥 식당" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "편의점" })).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#honbapNote")).toContainText("추정");
    await expect(page.locator(".food-card").first()).toBeVisible();
    await expect(page.locator(".store-pin")).toHaveCount(0);
    await expect(page.locator(".food-pin").first()).toBeVisible();
    await expect(page.locator(".pin.me")).toBeVisible();
    await photoAudit(page);
    await noOverlap(page);
    await page.screenshot({ path: `${ART}/mobile_cityhall_restaurants.png` });
    const brand = page.locator('.food-card[data-kind="2"]').first();
    await brand.scrollIntoViewIfNeeded();
    await brand.screenshot({ path: `${ART}/mobile_cityhall_brand_photo.png` });
    const none = page.locator('.food-card[data-kind="0"]').first();
    await none.scrollIntoViewIfNeeded();
    await none.screenshot({ path: `${ART}/mobile_cityhall_photo_fallback.png` });

    const foodPin = page.locator(".food-pin").first();
    await foodPin.evaluate((el) => {
      el.closest(".leaflet-marker-icon").style.zIndex = "10000";
    });
    await foodPin.click();
    await expect(page.locator(".food-card.on")).toBeVisible();

    await page.getByRole("tab", { name: "혼밥 식당" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "편의점" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "혼밥 식당" })).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
  });
});

test.describe("아리랑로19길", () => {
  test.use({ geolocation: ARIRANG, permissions: ["geolocation"] });

  test("모킹 위치의 편의점과 혼밥 식당", async ({ page }) => {
    const errors = attach(page);
    await useHere(page);
    await expect(page.locator("#locMsg")).toContainText("현재 위치");
    await noOverlap(page);
    await page.screenshot({ path: `${ART}/mobile_arirang_convenience.png` });
    await page.locator("#fPrice .chip", { hasText: "1,500~2,500원" }).click();
    const prices = await page.locator(".item").evaluateAll((els) => els.map((e) => Number(e.dataset.price)));
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p >= 1501 && p <= 2500)).toBeTruthy();
    await page.getByRole("button", { name: "초기화" }).click();

    await page.getByRole("tab", { name: "혼밥 식당" }).click();
    await expect(page.locator(".food-card").first()).toBeVisible();
    await expect(page.locator("#foodStatus")).toContainText("혼밥 추정");
    await photoAudit(page);
    await expect(page.locator(".store-pin")).toHaveCount(0);
    await noOverlap(page);
    await page.screenshot({ path: `${ART}/mobile_arirang_restaurants.png` });
    expect(errors).toEqual([]);
  });

  test("주소 검색도 모킹한 아리랑로19길로 식당을 연다", async ({ page }) => {
    await page.route("**/nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          { lat: "37.6012361", lon: "127.0088198", display_name: "아리랑로19길, 정릉2동, 성북구" },
        ]),
      })
    );
    await page.route("**/photon.komoot.io/**", (route) => route.fulfill({ contentType: "application/json", body: '{"features":[]}' }));
    await page.goto("/");
    await page.fill("#addr", "아리랑로19길");
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page.locator("#locMsg")).toContainText("아리랑로19길");
    await expect(page.locator(".store-pin").first()).toBeVisible();
    await page.getByRole("tab", { name: "혼밥 식당" }).click();
    await expect(page.locator(".food-card").first()).toBeVisible();
    await expect(page.locator("#foodStatus")).toContainText("아리랑로19길");
  });
});

test("식당 로딩과 오류", async ({ page }) => {
  await page.route("**/restaurants.json", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "혼밥 식당" }).click();
  await expect(page.locator("#foodStatus")).toContainText("불러오는 중");
  await page.screenshot({ path: `${ART}/mobile_restaurants_loading.png` });
  await expect(page.locator("#foodStatus")).toContainText("위치를 설정하면", { timeout: 10000 });
});

test("식당 데이터 실패", async ({ page }) => {
  await page.route("**/restaurants.json", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("tab", { name: "혼밥 식당" }).click();
  await expect(page.locator("#foodStatus")).toContainText("불러오지 못했어요");
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await page.screenshot({ path: `${ART}/mobile_restaurants_error.png` });
});
