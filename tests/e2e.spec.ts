import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function ready(page: Page, route = "/demo?capture=1") {
  await page.goto(route);
  await page.waitForFunction(
    () => window.__ECHO__?.getState().result.paths.length > 3,
  );
  await page.waitForFunction(
    () => window.__ECHO__?.getState().performance.fps > 0,
  );
}

test("demo renders, updates reflection paths, plays spatial audio, and compares treatments", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.screenshot({ path: "artifacts/demo-desktop.png", fullPage: true });
  const before = await page.evaluate(() => window.__ECHO__.getState());
  console.log(
    "Demo counters:",
    JSON.stringify(before.performance),
    "worker ms:",
    before.result.elapsedMs.toFixed(2),
  );
  await page
    .getByRole("button", { name: "Play spatial audio", exact: true })
    .click();
  await page.waitForFunction(() => window.__ECHO__.getState().audio.tailReady);
  await page.waitForFunction(
    () => window.__ECHO__.getState().audio.rms > 0.00001,
  );
  expect(
    (await page.evaluate(() => window.__ECHO__.getState().audio)).voices,
  ).toBeGreaterThan(6);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  const marker = page.getByTestId("source-marker"),
    box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 65,
    box.y + box.height / 3 + 35,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => window.__ECHO__.getState().result.directDistance,
        ),
    )
    .not.toBe(before.result.directDistance);
  const moved = await page.evaluate(() => window.__ECHO__.getState());
  expect(moved.room.source.x).not.toBe(before.room.source.x);
  const probe1 = await page.evaluate(() => window.__ECHO__.renderProbe());
  await page.evaluate(() =>
    window.__ECHO__.moveListener(
      window.__ECHO__.getState().room.listener,
      window.__ECHO__.getState().room.yaw + Math.PI / 2,
    ),
  );
  const probe2 = await page.evaluate(() => window.__ECHO__.renderProbe());
  console.log(
    "Stereo probes:",
    JSON.stringify({ before: probe1, rotated: probe2 }),
  );
  expect(probe1.leftEnergy + probe1.rightEnergy).toBeGreaterThan(0.001);
  expect(Math.abs(probe1.leftEnergy - probe2.leftEnergy)).toBeGreaterThan(
    0.0001,
  );
  await page
    .getByRole("button", { name: "Add a treatment", exact: true })
    .click();
  await page.getByRole("button", { name: "Acoustics", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__ECHO__.getState().result.rt60[3] <
      window.__ECHO__.getState().result.baselineRT[3] * 0.9,
  );
  const after = await page.evaluate(() => window.__ECHO__.getState());
  expect(after.room.treatments).toHaveLength(1);
  expect(after.treated).toBe(true);
  await page.getByRole("button", { name: "A Original", exact: true }).click();
  await page.waitForFunction(
    () =>
      Math.abs(
        window.__ECHO__.getState().result.rt60[3] -
          window.__ECHO__.getState().result.baselineRT[3],
      ) < 0.001,
  );
  await page.getByRole("button", { name: "B Treated", exact: true }).click();
  await page.getByRole("button", { name: "3D room", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause spatial audio", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/demo-treated.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("walkthrough moves the listener and rotates the hearing direction", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Walkthrough", exact: true }).click();
  await page.screenshot({
    path: "artifacts/walkthrough-entry.png",
    fullPage: true,
  });
  const before = await page.evaluate(() => window.__ECHO__.getState());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
          resolve();
        }, 500);
      }),
  );
  await expect
    .poll(
      async () =>
        await page.evaluate(() => window.__ECHO__.getState().room.listener.x),
    )
    .not.toBe(before.room.listener.x);
  await page.getByRole("button", { name: "Turn right", exact: true }).click();
  expect(
    await page.evaluate(() => window.__ECHO__.getState().room.yaw),
  ).not.toBe(before.room.yaw);
  await page.screenshot({ path: "artifacts/walkthrough.png", fullPage: true });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__ECHO__.getState().mode)).toBe(
    "orbit",
  );
});

test("material edits, undo, backup export and local persistence", async ({
  page,
}) => {
  await ready(page, "/");
  await page
    .getByRole("button", { name: "Floor Timber", exact: false })
    .click();
  await page
    .getByLabel("Surface material", { exact: true })
    .selectOption("carpet");
  await page.waitForFunction(
    () => window.__ECHO__.getState().room.floorMaterial === "carpet",
  );
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(
    () => window.__ECHO__?.getState().room.floorMaterial === "carpet",
  );
  await page.getByRole("button", { name: "Room actions", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export room backup", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toContain(".echo.json");
  await page
    .getByRole("button", { name: "Floor Carpet", exact: false })
    .click();
  await page
    .getByLabel("Surface material", { exact: true })
    .selectOption("timber");
  await page.getByRole("button", { name: "Undo change", exact: true }).click();
  expect(
    await page.evaluate(() => window.__ECHO__.getState().room.floorMaterial),
  ).toBe("carpet");
});

test("floor-plan import with known scale creates an editable room without fabricated openings", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "New room", exact: true }).click();
  // Generate a test plan locally; no downloaded fixture or private data.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 450;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, 600, 450);
    c.strokeStyle = "#222";
    c.lineWidth = 9;
    c.strokeRect(75, 75, 450, 300);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator('[role="dialog"] input[type=file]')
    .first()
    .setInputFiles({
      name: "test-plan.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const canvas = page.getByTestId("trace-canvas");
  const click = async (x: number, y: number) => {
    const p = await canvas.evaluate(
      (el, point) =>
        new DOMPoint(point.x, point.y).matrixTransform(
          (el as SVGSVGElement).getScreenCTM()!,
        ),
      { x, y },
    );
    await page.mouse.click(p.x, p.y);
  };
  await click(75, 75);
  await click(525, 75);
  await page.getByTestId("known-dimension").fill("6");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await click(75, 75);
  await click(525, 75);
  await click(525, 375);
  await click(75, 375);
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const room = await page.evaluate(() => window.__ECHO__.getState().room);
  expect(room.walls).toHaveLength(4);
  expect(room.walls[0].b.x).toBeCloseTo(6, 1);
  expect(room.openings).toHaveLength(0);
  expect(room.provenance).toBe("inferred");
  expect(room.plan?.image).toMatch(/^data:image/);
  await page.screenshot({
    path: "artifacts/imported-plan.png",
    fullPage: true,
  });
});

test("calibration requires explicit consent and cancellation releases the microphone", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const media = navigator.mediaDevices,
      original = media.getUserMedia.bind(media);
    (window as unknown as { captureTracks: MediaStreamTrack[] }).captureTracks =
      [];
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (
        window as unknown as { captureTracks: MediaStreamTrack[] }
      ).captureTracks = stream.getTracks();
      return stream;
    };
  });
  await page.getByRole("button", { name: /Calibrate with your room/ }).click();
  const start = page.getByRole("button", {
    name: "Allow microphone & start",
    exact: true,
  });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await expect(start).toBeEnabled();
  await start.click();
  await page.waitForFunction(
    () =>
      (window as unknown as { captureTracks: MediaStreamTrack[] }).captureTracks
        .length > 0,
  );
  await expect(
    page.getByRole("button", { name: "Stop capture", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
  await expect(start).toBeVisible();
  await page.waitForFunction(() =>
    (
      window as unknown as { captureTracks: MediaStreamTrack[] }
    ).captureTracks.every((t) => t.readyState === "ended"),
  );
  expect(
    (await page.evaluate(() => window.__ECHO__.getState().room)).calibration,
  ).toBeUndefined();
  await page.screenshot({ path: "artifacts/calibration.png", fullPage: true });
});

test("mobile layout remains usable and screenshot routes are deterministic", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/scene/treated?capture=1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/demo-mobile.png", fullPage: true });
  await page.screenshot({ path: "artifacts/mobile-viewport.png" });
  await page
    .getByRole("button", { name: "Play spatial audio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause spatial audio", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await expect(page.getByTestId("plan")).toBeVisible();
  await page.getByRole("button", { name: "Add to room", exact: true }).click();
  await page.getByRole("button", { name: "Door", exact: true }).click();
  expect(
    (
      await page.evaluate(() => window.__ECHO__.getState().room.openings)
    ).filter((o) => o.kind === "door"),
  ).toHaveLength(2);
});

test("microphone denial is actionable and leaves the room untouched", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Access denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: /Calibrate with your room/ }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page
    .getByRole("button", { name: "Allow microphone & start", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Microphone access was not granted",
  );
  expect(
    (await page.evaluate(() => window.__ECHO__.getState().room)).calibration,
  ).toBeUndefined();
});

test("scene updates keep GPU allocations bounded and debug data exportable", async ({
  page,
}) => {
  await ready(page, "/inspect");
  await expect(page.getByTestId("debug-state")).toBeVisible();
  const before = await page.evaluate(() => window.__ECHO__.getState());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let i = 0;
        const step = () => {
          window.__ECHO__.moveSource({
            x: 1.5 + (i % 12) * 0.15,
            z: 1.5 + (i % 7) * 0.2,
            y: 1.25,
          });
          if (++i < 40) setTimeout(step, 35);
          else resolve();
        };
        step();
      }),
  );
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__ECHO__.getState());
  console.log("After movement counters:", JSON.stringify(after.performance));
  expect(after.performance.geometries).toBeLessThan(
    before.performance.geometries + 100,
  );
  expect(after.performance.calls).toBeLessThan(400);
});

test("production build reloads and computes acoustics fully offline", async ({
  page,
  context,
}) => {
  const productionURL = "http://127.0.0.1:4173";
  const externalRequests: string[] = [];
  page.on("request", (req) => {
    if (/^https?:/.test(req.url()) && !req.url().startsWith(productionURL))
      externalRequests.push(req.url());
  });
  await ready(page, productionURL + "/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => window.__ECHO__?.getState().result.paths.length > 3,
  );
  await page
    .getByRole("button", { name: "Add a treatment", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__ECHO__.getState().result.rt60[3] <
      window.__ECHO__.getState().result.baselineRT[3],
  );
  await page
    .getByRole("button", { name: "Play spatial audio", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__ECHO__.getState().audio.tailReady &&
      window.__ECHO__.getState().audio.rms > 0.00001,
  );
  expect(externalRequests).toEqual([]);
  await page.screenshot({
    path: "artifacts/offline-production.png",
    fullPage: true,
  });
});
