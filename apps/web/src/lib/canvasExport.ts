import { downloadBlob } from "./files";

/** Serialize the canvas harness (without grid/overlays) to a standalone SVG with resolved theme colors. */
export function canvasSvgString(): string {
  const svg = document.querySelector("#hs-canvas svg") as SVGSVGElement | null;
  if (!svg) throw new Error("Canvas not visible (switch to Design view)");
  const g = svg.querySelector(":scope > g") as SVGGElement;
  const bb = g.getBBox();
  const pad = 24;
  const clone = g.cloneNode(true) as SVGGElement;
  clone.removeAttribute("transform");
  clone.querySelectorAll("[data-hit='drag-preview']").forEach((n) => n.remove());
  const css = getComputedStyle(document.documentElement);
  const resolve = (s: string) => s.replace(/var\((--[\w-]+)\)/g, (_, v: string) => css.getPropertyValue(v).trim() || "#888");
  const walk = (el: Element) => {
    for (const attr of ["fill", "stroke", "style", "stop-color"]) {
      const v = el.getAttribute(attr);
      if (v && v.includes("var(")) el.setAttribute(attr, resolve(v));
    }
    if (el.classList.contains("mono")) el.setAttribute("font-family", "JetBrains Mono, monospace");
    [...el.children].forEach(walk);
  };
  walk(clone);
  const bg = css.getPropertyValue("--bg-canvas").trim();
  const defs = svg.querySelector("defs")?.cloneNode(true) as Element | undefined;
  if (defs) walk(defs);
  const w = Math.ceil(bb.width + pad * 2);
  const h = Math.ceil(bb.height + pad * 2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bb.x - pad} ${bb.y - pad} ${w} ${h}" font-family="Inter, system-ui, sans-serif">
<rect x="${bb.x - pad}" y="${bb.y - pad}" width="${w}" height="${h}" fill="${bg}"/>
${defs ? new XMLSerializer().serializeToString(defs) : ""}
${new XMLSerializer().serializeToString(clone)}
</svg>`;
}

export function exportCanvasSvg(name: string) {
  downloadBlob(name, canvasSvgString(), "image/svg+xml");
}

export async function exportCanvasPng(name: string, scale = 2) {
  const s = canvasSvgString();
  const m = /width="(\d+)" height="(\d+)"/.exec(s)!;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("render failed"));
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  downloadBlob(name, blob);
}
