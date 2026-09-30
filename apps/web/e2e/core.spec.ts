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

  // Quote updates (demo): the order button shows a price. Unreviewed catalog data makes it an estimate
  // ("Request quote ~$…") rather than an instant order.
  const orderBtn = page.getByRole("button", { name: /^(Order|Request quote)\s*~?\$/ });
  await expect(orderBtn).toBeVisible({ timeout: 15_000 });

  // Undo removes the last wire, redo brings it back
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /Wires \(2\)/ })).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("button", { name: /Wires \(3\)/ })).toBeVisible();

  // Order review
  await orderBtn.click();
  await expect(page.getByText("ORDER LINES", { exact: false })).toBeVisible();
  await expect(page.getByText("Nothing is submitted", { exact: false })).toBeVisible();

  expect(outbound).toEqual([]);
});

test("example opens; unreviewed reference data is never claimed ready", async ({ page }) => {
  await page.goto("/");
  await page.getByText("open an example", { exact: false }).click();
  // Seed/unreviewed catalog data (insert geometry, tooling) blocks the "ready" claim (FIX-10).
  await expect(page.getByText("Needs review before it can be called ready").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ready for automated build")).toHaveCount(0);
  await expect(page.getByText("52 checks", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Saved on this device")).toBeVisible({ timeout: 10_000 });
});

test("three connectors: combine two bundles into a trunk and re-attach a branch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Add your first connector")).toBeVisible();
  await placeConnector(page, 400, 400, "13-35");
  await placeConnector(page, 950, 300, "13-35 pin");
  await placeConnector(page, 1150, 720, "13-35 pin");
  await page.keyboard.press("Escape");
  const hs = () => page.evaluate(() => {
    const w = window as unknown as { __hs: { useProject: { getState(): { project: { currentRevisionId: string; revisions: { id: string; harness: { segments: { id: string; a: string; b: string }[]; nodes: { id: string; kind: string; connectorId?: string; position: { x: number; y: number } }[]; connectors: { id: string; refDes: string }[] } }[] } } } } };
    const p = w.__hs.useProject.getState().project;
    return p.revisions.find((r) => r.id === p.currentRevisionId)!.harness;
  });
  // Connect J1 to P1 and J1 to P2 through the model (drag-to-connect is covered by the core-flow test)
  await page.evaluate(() => {
    const w = window as unknown as { __hs: { useProject: { getState(): { dispatch(c: unknown): boolean; project: { currentRevisionId: string; revisions: { id: string; harness: { connectors: { id: string }[] } }[] } } } } };
    const st = w.__hs.useProject.getState();
    const h = st.project.revisions.find((r) => r.id === st.project.currentRevisionId)!.harness;
    const [a, b, c] = h.connectors.map((x) => x.id);
    st.dispatch({ type: "connectPins", payload: { pairs: [{ a: { connectorId: a, cavityId: "1" }, b: { connectorId: b, cavityId: "1" } }, { a: { connectorId: a, cavityId: "2" }, b: { connectorId: c, cavityId: "1" } }] } });
  });
  let h = await hs();
  expect(h.segments).toHaveLength(2);
  // Select both bundles (Shift+click) and combine them into a trunk from the context bar
  await page.evaluate(() => {
    const w = window as unknown as { __hs: { useUi: { getState(): { select(k: string, ids: string[]): void } }; useProject: { getState(): { project: { currentRevisionId: string; revisions: { id: string; harness: { segments: { id: string }[] } }[] } } } } };
    const p = w.__hs.useProject.getState().project;
    w.__hs.useUi.getState().select("segment", p.revisions.find((r) => r.id === p.currentRevisionId)!.harness.segments.map((s) => s.id));
  });
  await page.getByRole("button", { name: "Combine into trunk" }).click();
  h = await hs();
  expect(h.segments).toHaveLength(3);
  expect(h.nodes.filter((n) => n.kind === "breakout")).toHaveLength(1);
  // The branching tip explains the gestures
  await expect(page.getByText("Adjusting how bundles branch")).toBeVisible();
});
