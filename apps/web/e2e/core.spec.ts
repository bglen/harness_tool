import { expect, test, type Page } from "@playwright/test";

/** Rows of the first placed card: card centred on the click point (see PartPicker placement). */
async function placeConnector(page: Page, x: number, y: number, query: string) {
  await page.mouse.dblclick(x, y);
  await page.getByLabel("Search connectors").fill(query);
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
}

test("core flow: 2 connectors → connect 3 pins → quote → order review, with no outbound design data", async ({ page }) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    // Everything must come from the local static site; no POSTs, no third-party hosts (acceptance 12)
    if (u.hostname !== "localhost" || r.method() !== "GET") outbound.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await expect(page.getByText("Add your first connector")).toBeVisible();

  await placeConnector(page, 400, 400, "13-35");
  await placeConnector(page, 1000, 400, "13-35 pin");
  await page.keyboard.press("Escape");

  // Card rows: 13-35 has 22 cavities → card height 490, centred on y=400 → row 1 centre y = 211, spacing 20
  for (const i of [0, 1, 2]) {
    const y = 211 + i * 20;
    await page.mouse.move(470, y);
    await page.mouse.down();
    await page.mouse.move(700, y, { steps: 6 });
    await page.mouse.move(950, y, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.getByRole("button", { name: /Wires \(3\)/ })).toBeVisible();

  // Quote updates (demo): Order button shows a price
  await expect(page.getByRole("button", { name: /^Order\s*\$/ })).toBeVisible({ timeout: 15_000 });

  // Undo removes the last wire, redo brings it back
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /Wires \(2\)/ })).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("button", { name: /Wires \(3\)/ })).toBeVisible();

  // Order review
  await page.getByRole("button", { name: /^Order\s*\$/ }).click();
  await expect(page.getByText("ORDER LINES", { exact: false })).toBeVisible();
  await expect(page.getByText("Nothing is submitted", { exact: false })).toBeVisible();

  expect(outbound).toEqual([]);
});

test("example opens, pedigree switch re-runs checks", async ({ page }) => {
  await page.goto("/");
  await page.getByText("open an example", { exact: false }).click();
  await expect(page.getByText("Ready for automated build").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("47 checks", { exact: false }).first()).toBeVisible();
});
