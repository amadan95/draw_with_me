export function svgMarkupToDataUrl(markup: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export async function rasterizeSvgMarkup(options: {
  markup: string;
  width: number;
  height: number;
  mimeType?: string;
  quality?: number;
}) {
  const image = new Image();
  const src = svgMarkupToDataUrl(options.markup);

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to rasterize SVG snapshot."));
    image.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(options.width));
  canvas.height = Math.max(1, Math.round(options.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas export is not available.");
  }

  ctx.fillStyle = "#faf9f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL(options.mimeType ?? "image/jpeg", options.quality ?? 0.82);
}
