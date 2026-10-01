import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** 2×1 px PNG (red, blue). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAMBgEAFfVt8QAAAABJRU5ErkJggg==", "base64");

const projectTemplate = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __hs: { useProject: { getState(): { project: { drawingTemplate: { name: string; logo: unknown; sheets: { blocks: { kind: string }[] }[] } | null } } } } };
    return w.__hs.useProject.getState().project.drawingTemplate;
  });

test("drawing templates: customize with a logo, edit blocks, save, use, export and upload", async ({ page }) => {
  await page.goto("/");
  await page.getByText("open an example", { exact: false }).click();
  await expect(page.locator("[data-hit='wire']")).toHaveCount(10, { timeout: 15_000 });
  await page.keyboard.press("3");
  await expect(page.getByLabel("Drawing template", { exact: true })).toHaveValue("classic");
  await page.getByRole("button", { name: "Customize" }).click();
  const editor = page.getByRole("dialog", { name: "Drawing template editor" });
  await expect(editor).toBeVisible();
  await expect(editor.locator("[data-block='titleBlock']")).toHaveCount(1);

  // Logo upload (template settings shown while nothing is selected)
  const chooser = page.waitForEvent("filechooser");
  await editor.getByRole("button", { name: "Upload logo" }).click();
  await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(editor.locator("[data-block='logo'] img")).toHaveCount(1);

  // Add a text block, drag it, delete it, undo
  await editor.getByRole("button", { name: "Text", exact: true }).click();
  const text = editor.locator("[data-block='text']");
  await expect(text).toHaveCount(1);
  const before = await text.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + 160, before!.y - 120, { steps: 8 });
  await page.mouse.up();
  const after = await text.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(50);
  await page.keyboard.press("Delete");
  await expect(text).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(text).toHaveCount(1);

  // Edit a title-block cell through the properties panel
  await editor.locator("[data-block='titleBlock'] [data-cell]").first().click();
  const value = editor.getByLabel("Cell value").first();
  await value.fill("{company} DRAWING");
  await value.blur();
  await expect(editor.locator("[data-block='titleBlock']")).toContainText("DRAWING");

  // Save to the library, use in the project, close
  await editor.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByText("to your template library")).toBeVisible();
  await editor.getByRole("button", { name: "Use in this project" }).click();
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(editor).toHaveCount(0);
  const t = await projectTemplate(page);
  expect(t?.name).toBe("New template");
  expect(t?.logo).toBeTruthy();
  expect(t?.sheets[0]!.blocks.some((b) => b.kind === "text")).toBe(true);
  await expect(page.getByText("Your library (this browser)")).toBeVisible();

  // The drawing PDF is generated from the template: one page per sheet (no overflow in this example)
  const pages = await page.evaluate(async () => {
    const docs = await import("/src/lib/docs.ts");
    const s = new TextDecoder("latin1").decode(await (await docs.drawingBlob()).arrayBuffer());
    return (s.match(/\/Type\s*\/Page\b/g) ?? []).length;
  });
  expect(pages).toBe(t!.sheets.length);

  // Export, then upload the file back: it's added to the library under a fresh id and used by the project
  const dl = page.waitForEvent("download");
  await page.getByRole("main").getByRole("button", { name: "Export", exact: true }).click();
  const file = await (await dl).path();
  const json = JSON.parse(readFileSync(file!, "utf8"));
  expect(json.kind).toBe("harness-drawing-template");
  const up = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload…" }).click();
  await (await up).setFiles({ name: "acme.harnesstemplate.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
  await expect(page.getByText("Imported drawing template")).toBeVisible();
  expect((await projectTemplate(page))?.name).toBe("New template (imported)");

  // A file that isn't a template is refused with a reason
  const bad = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload…" }).click();
  await (await bad).setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ hello: 1 })) });
  await expect(page.getByText("Not a drawing template file", { exact: false })).toBeVisible();
});
