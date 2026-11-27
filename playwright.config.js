const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:8765",
    deviceScaleFactor: 1,
    hasTouch: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  projects: [
    { name: "w360", use: { browserName: "chromium", channel: "chrome", viewport: { width: 360, height: 780 } } },
    { name: "phone", use: { browserName: "chromium", channel: "chrome", viewport: { width: 390, height: 844 } } },
    { name: "w430", use: { browserName: "chromium", channel: "chrome", viewport: { width: 430, height: 932 } } },
    { name: "desktop", use: { browserName: "chromium", channel: "chrome", viewport: { width: 1280, height: 800 } } },
    { name: "iphone13", use: { ...devices["iPhone 13"], browserName: "webkit", channel: "" } },
    { name: "pixel7", use: { ...devices["Pixel 7"], browserName: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: "python3 -m http.server 8765",
    port: 8765,
    reuseExistingServer: true,
  },
});
