// Page geometry. Overlays live in "page space": points (1/72 inch) from the
// top-left corner of the unrotated page, y pointing down. The screen shows the
// page turned clockwise by its rotation ("display space").

export type Rotation = 0 | 90 | 180 | 270;

export function normRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** Size of the page as displayed. */
export function displaySize(w: number, h: number, r: Rotation): [number, number] {
  return r % 180 === 0 ? [w, h] : [h, w];
}

export function pageToDisplay(x: number, y: number, r: Rotation, w: number, h: number): [number, number] {
  switch (r) {
    case 90:
      return [h - y, x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [y, w - x];
    default:
      return [x, y];
  }
}

export function displayToPage(x: number, y: number, r: Rotation, w: number, h: number): [number, number] {
  switch (r) {
    case 90:
      return [y, h - x];
    case 180:
      return [w - x, h - y];
    case 270:
      return [w - y, x];
    default:
      return [x, y];
  }
}

/** CSS transform that turns an unrotated page-space layer (origin top-left) into display space. */
export function layerTransform(r: Rotation, w: number, h: number, scale: number): string {
  switch (r) {
    case 90:
      return `translate(${h * scale}px, 0) rotate(90deg)`;
    case 180:
      return `translate(${w * scale}px, ${h * scale}px) rotate(180deg)`;
    case 270:
      return `translate(0, ${w * scale}px) rotate(270deg)`;
    default:
      return "none";
  }
}

/** Rotates the offset (dx, dy) by `deg` counter-clockwise as seen on screen (y down). */
export function rotateOffset(dx: number, dy: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c + dy * s, -dx * s + dy * c];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The page-space rectangle covered by a display-space rectangle. */
export function displayRectToPage(r: Rect, rot: Rotation, w: number, h: number): Rect {
  const [ax, ay] = displayToPage(r.x, r.y, rot, w, h);
  const [bx, by] = displayToPage(r.x + r.w, r.y + r.h, rot, w, h);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
