import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseURL = process.env.ECHO_SCREENSHOT_URL || "http://127.0.0.1:4173";
const directory = new URL("../docs/screenshots/", import.meta.url);
await mkdir(directory, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1.5,
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  async function openRoom(route) {
    await page.goto(new URL(route, baseURL).href, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () =>
        window.__ECHO__?.getState().performance.fps > 0 &&
        window.__ECHO__?.getState().result.paths.length > 3,
    );
  }

  async function capture(filename) {
    await page.mouse.move(8, 8);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const path = fileURLToPath(new URL(filename, directory));
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    console.log(`Captured ${path}`);
  }

  await openRoom("/demo?capture=1");
  await capture("room-overview.png");

  await openRoom("/scene/treated?capture=1");
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await page.waitForFunction(() => {
    const state = window.__ECHO__.getState();
    return (
      state.mode === "plan" &&
      state.treated &&
      state.result.rt60[3] < state.result.baselineRT[3]
    );
  });
  await capture("treatment-plan.png");
} finally {
  await browser.close();
}
