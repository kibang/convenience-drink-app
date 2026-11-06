const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:8765",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    channel: "chrome",
    locale: "ko-KR",
  },
  webServer: {
    command: "python3 -m http.server 8765",
    port: 8765,
    reuseExistingServer: true,
  },
});
