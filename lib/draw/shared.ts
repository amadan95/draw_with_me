export const paletteSets = [
  ["#262523", "#0069d3", "#d66b54", "#f4a261", "#2a9d8f"],
  ["#262523", "#3a86ff", "#ff006e", "#fb5607", "#ffbe0b"],
  ["#262523", "#1d3557", "#457b9d", "#e63946", "#f1faee"],
  ["#262523", "#7f5539", "#b08968", "#ddb892", "#ede0d4"],
  ["#262523", "#5f0f40", "#9a031e", "#fb8b24", "#e36414"]
] as const;

export const PAPER_COLOR = "#faf9f7";

export type Palette = (typeof paletteSets)[number];

export function getPalette(index: number): Palette {
  return paletteSets[index % paletteSets.length];
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
