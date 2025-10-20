
/*
 * sb-symbol — ultra-simple layered shapes WITH optional textures (jsPsych plugin)
 *
 * Goals: minimal, intuitive. No masks/windows/deg/gamma. Shapes can be filled by color or texture.
 * Shapes: circle | ring | rectangle | triangle | cross
 * Textures: stripes | noise (attached to a shape via `texture` field)
 *
 * Example usage is in example.html below.
 */

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

type Blend =
  | "source-over" | "lighter" | "multiply" | "screen" | "overlay"
  | "darken" | "lighten" | "difference" | "exclusion" | "hard-light" | "soft-light";

type TextureStripes = {
  type: "stripes";
  /** full period in px (stripe A + stripe B). default: 20 */
  bar?: number;
  /** fraction of period for colorA (0..1). default: 0.5 */
  duty?: number;
  /** degrees, extra rotation on top of shape rotation */
  angle?: number;
  /** phase shift in px along stripe normal. default 0 */
  phase?: number;
  /** optional override colors; falls back to derived from shape.color */
  colors?: [string, string]; // [colorA, colorB]
};

type TextureNoise = {
  type: "noise";
  /** size of a noise cell in px (bigger = blockier). default: 4 */
  cell?: number;
  /** optional seed; integer */
  seed?: number;
  /** optional palette for two-color mix; otherwise auto-derives from shape.color */
  colors?: [string, string];
  /** 0..1 blend toward colorB (default 0.5); higher = more colorB on average */
  mix?: number;
};

type Texture = TextureStripes | TextureNoise;

type CommonShape = {
  shape: "circle" | "ring" | "rectangle" | "triangle" | "cross";
  x?: number; // px from center
  y?: number; // px from center
  z?: number; // draw order; higher draws later
  rotation?: number; // deg
  alpha?: number; // 0..1
  blend?: Blend;

  // Fill & stroke
  color?: string; // fill color when no texture
  texture?: Texture | null; // when present, used instead of color for fill
  stroke?: string; // optional stroke color
  strokePx?: number; // stroke width in px
};

type Circle = CommonShape & { shape: "circle"; radius: number };

type Ring = CommonShape & { shape: "ring"; innerRadius: number; outerRadius: number };

type Rectangle = CommonShape & { shape: "rectangle"; width: number; height: number; cornerRadius?: number };

type Triangle = CommonShape & { shape: "triangle"; side: number };

type Cross = CommonShape & { shape: "cross"; armLen: number; armWidth: number };

export type Item = Circle | Ring | Rectangle | Triangle | Cross;

export type DataOut = {
  rt: number | null;
  onset_ms: number;
  offset_ms: number;
  resp_key: string | null;
  n_items: number;
  items: Array<{ shape: Item["shape"]; z: number; x: number; y: number; color?: string; hadTexture: boolean; alpha: number }>;
};

const info = <const>{
  name: "symbol",
  version: "1.0.0",
  parameters: {
    canvasWidth:      { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int",   default: 800 },
    canvasHeight:     { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int",   default: 600 },
    background:       { type: (window as any)?.jsPsych?.ParameterType?.STRING ?? "string", default: "transparent" },
    items:            { type: (window as any)?.jsPsych?.ParameterType?.COMPLEX ?? "complex", default: [] as Item[] },

    // Timing / responses (minimal)
    trialDuration:    { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int",   default: null as number | null },
    responseEndsTrial:{ type: (window as any)?.jsPsych?.ParameterType?.BOOL ?? "bool", default: true },
    choices:          { type: (window as any)?.jsPsych?.ParameterType?.KEYS ?? "keys", default: [] as string[] },
    allowMouse:       { type: (window as any)?.jsPsych?.ParameterType?.BOOL ?? "bool", default: false },
  },
  data: {
    rt:        { type: (window as any)?.jsPsych?.ParameterType?.FLOAT ?? "float" },
    onset_ms:  { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int" },
    offset_ms: { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int" },
    resp_key:  { type: (window as any)?.jsPsych?.ParameterType?.STRING ?? "string" },
    n_items:   { type: (window as any)?.jsPsych?.ParameterType?.INT ?? "int" },
    items:     { type: (window as any)?.jsPsych?.ParameterType?.COMPLEX ?? "complex" },
  },
};

type Info = typeof info;

type Trial = TrialType<Info> & {
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  items: Item[];
  trialDuration?: number | null;
  responseEndsTrial?: boolean;
  choices?: string[];
  allowMouse?: boolean;
};

class SymbolPlugin implements JsPsychPlugin<Info> {
  static info = info;
  private jsPsych: JsPsych;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private keyboardListener: any | null = null;
  private endTimeout: number | null = null;
  private startTime = 0;

  constructor(jsPsych: JsPsych) { this.jsPsych = jsPsych; }

  trial(display_element: HTMLElement, trial: Trial) {
    display_element.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;background:${escapeHtml(trial.background)};">
        <canvas id="sb-symbol-canvas" width="${trial.canvasWidth}" height="${trial.canvasHeight}"></canvas>
      </div>
    `;
    this.canvas = display_element.querySelector<HTMLCanvasElement>("#sb-symbol-canvas")!;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;

    const items = [...(trial.items ?? [])].map(normalizeItem).sort((a,b)=> (a.z - b.z));

    // Clear; background handled by wrapper div
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const it of items) this.drawItem(it);

    this.startTime = performance.now();

    if (trial.choices && (trial.choices as string[]).length > 0) {
      this.keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info: any) => {
          if (trial.responseEndsTrial) this.end(display_element, trial, info.key as string, info.rt as number, items);
        },
        valid_responses: trial.choices as string[],
        rt_method: "performance",
        persist: !trial.responseEndsTrial,
        allow_held_key: false,
      });
    }
    if (trial.allowMouse) {
      const handler = () => { if (trial.responseEndsTrial) this.end(display_element, trial, null, null, items); };
      this.canvas.addEventListener("mousedown", handler, { once: !!trial.responseEndsTrial });
      if (!trial.responseEndsTrial) this.canvas.addEventListener("mousedown", handler);
    }

    if (trial.trialDuration != null) {
      this.endTimeout = window.setTimeout(() => this.end(display_element, trial, null, null, items), Math.max(0, trial.trialDuration!));
    }
  }

  private drawItem(it: Required<Item & CommonShape>) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(this.canvas.width/2 + it.x), Math.round(this.canvas.height/2 + it.y));
    const totalRot = (it.rotation || 0);
    if (totalRot) ctx.rotate(deg2rad(totalRot));
    ctx.globalAlpha = it.alpha;
    ctx.globalCompositeOperation = it.blend as GlobalCompositeOperation;

    // Fill
    if (it.texture) {
      // Render pattern into offscreen and clip with shape
      const off = document.createElement("canvas");
      off.width = this.canvas.width; off.height = this.canvas.height;
      const octx = off.getContext("2d")!;
      octx.save();
      octx.translate(Math.round(off.width/2 + it.x), Math.round(off.height/2 + it.y));
      // Extra texture angle on top of shape rotation
      const texAngle = (it.texture.type === "stripes" ? (it.texture.angle ?? 0) : 0);
      if (totalRot + texAngle) octx.rotate(deg2rad(totalRot + texAngle));

      // Draw texture centered around (0,0)
      drawTexture(octx, it);

      // Clip to shape using destination-in
      octx.globalCompositeOperation = "destination-in";
      pathShape(octx, it);
      octx.fillStyle = "#fff";
      octx.fill();
      octx.restore();

      // Draw back to main
      ctx.drawImage(off, -Math.round(off.width/2), -Math.round(off.height/2));
    } else {
      // Plain color fill
      pathShape(ctx, it);
      ctx.fillStyle = parseColorSafe(it.color || "#000");
      ctx.fill();
    }

    // Stroke (always on top)
    if (it.stroke && (it.strokePx ?? 0) > 0) {
      pathShape(ctx, it);
      ctx.lineWidth = it.strokePx!;
      ctx.strokeStyle = parseColorSafe(it.stroke);
      ctx.stroke();
    }

    ctx.restore();
  }

  private end(display_element: HTMLElement, trial: Trial, key: string | null, rt_override: number | null, items: Required<Item & CommonShape>[]) {
    this.clearTimersAndListeners();
    const now = performance.now();
    const data: DataOut = {
      rt: rt_override != null ? Math.round(rt_override) : null,
      onset_ms: Math.round(this.startTime),
      offset_ms: Math.round(now),
      resp_key: key,
      n_items: items.length,
      items: items.map((it) => ({
        shape: it.shape, z: it.z, x: it.x, y: it.y,
        color: it.color, hadTexture: !!it.texture, alpha: it.alpha,
      })),
    };
    display_element.innerHTML = "";
    this.jsPsych.finishTrial(data);
  }

  private clearTimersAndListeners() {
    if (this.keyboardListener) {
      this.jsPsych.pluginAPI.cancelKeyboardResponse(this.keyboardListener);
      this.keyboardListener = null;
    }
    if (this.endTimeout != null) {
      window.clearTimeout(this.endTimeout);
      this.endTimeout = null;
    }
  }
}

// ---------------------- helpers ----------------------

function normalizeItem(raw: Item): Required<Item & CommonShape> {
  const base: any = {
    shape: raw.shape,
    x: raw.x ?? 0,
    y: raw.y ?? 0,
    z: raw.z ?? 0,
    rotation: raw.rotation ?? 0,
    alpha: clamp01(raw.alpha ?? 1),
    blend: raw.blend ?? "source-over",
    color: raw.color ?? "#000",
    texture: raw.texture ?? null,
    stroke: raw.stroke ?? undefined,
    strokePx: raw.strokePx ?? 0,
  };
  // shape-specific defaults
  if (raw.shape === "circle") base.radius = (raw as Circle).radius ?? 40;
  else if (raw.shape === "ring") {
    const r = raw as Ring; base.innerRadius = r.innerRadius ?? 30; base.outerRadius = r.outerRadius ?? 60;
  } else if (raw.shape === "rectangle") {
    const r = raw as Rectangle; base.width = r.width ?? 120; base.height = r.height ?? 120; base.cornerRadius = Math.max(0, r.cornerRadius ?? 0);
  } else if (raw.shape === "triangle") {
    base.side = (raw as Triangle).side ?? 100;
  } else if (raw.shape === "cross") {
    const r = raw as Cross; base.armLen = r.armLen ?? 40; base.armWidth = r.armWidth ?? 8;
  }
  return base as Required<Item & CommonShape>;
}

function pathShape(ctx: CanvasRenderingContext2D, it: Required<Item & CommonShape>) {
  ctx.beginPath();
  if (it.shape === "circle") {
    ctx.arc(0, 0, (it as any).radius, 0, Math.PI*2);
  } else if (it.shape === "ring") {
    const R = (it as any).outerRadius, r = (it as any).innerRadius;
    ctx.arc(0, 0, R, 0, Math.PI*2);
    ctx.arc(0, 0, r, 0, Math.PI*2, true); // punch out inner
  } else if (it.shape === "rectangle") {
    const w = (it as any).width, h = (it as any).height, cr = Math.max(0, (it as any).cornerRadius || 0);
    if (cr <= 0) ctx.rect(-w/2, -h/2, w, h);
    else roundedRectPath(ctx, -w/2, -h/2, w, h, cr);
  } else if (it.shape === "triangle") {
    const s = Math.max(2, Math.round((it as any).side));
    const h = s * Math.sqrt(3) / 2;
    ctx.moveTo(-s/2,  h/2);
    ctx.lineTo( s/2,  h/2);
    ctx.lineTo(  0 , -h/2);
    ctx.closePath();
  } else if (it.shape === "cross") {
    const L = (it as any).armLen, W = (it as any).armWidth;
    // draw as two rects merged via path
    ctx.rect(-W/2, -L/2, W, L);
    ctx.rect(-L/2, -W/2, L, W);
  }
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w/2, h/2);
  ctx.moveTo(x+rr, y);
  ctx.lineTo(x+w-rr, y); ctx.arcTo(x+w, y, x+w, y+rr, rr);
  ctx.lineTo(x+w, y+h-rr); ctx.arcTo(x+w, y+h, x+w-rr, y+h, rr);
  ctx.lineTo(x+rr, y+h); ctx.arcTo(x, y+h, x, y+h-rr, rr);
  ctx.lineTo(x, y+rr); ctx.arcTo(x, y, x+rr, y, rr);
  ctx.closePath();
}

function drawTexture(ctx: CanvasRenderingContext2D, it: Required<Item & CommonShape>) {
  const tex = it.texture!;
  if (tex.type === "stripes") drawStripes(ctx, it, tex);
  else drawNoise(ctx, it, tex);
}

function drawStripes(ctx: CanvasRenderingContext2D, it: Required<Item & CommonShape>, tex: TextureStripes) {
  const period = Math.max(2, Math.round(tex.bar ?? 20));
  const duty = clamp01(tex.duty ?? 0.5);
  const phase = Math.round(tex.phase ?? 0);
  const [cA, cB] = tex.colors ?? deriveAB(it.color ?? "#000");

  // Big working area
  const W = ctx.canvas.width * 1.5;
  const H = ctx.canvas.height * 1.5;

  const half = Math.ceil((W/2) / period) + 2;
  let x = -half * period + (phase % period);
  const wA = period * duty, wB = period - wA;
  ctx.save();
  while (x < W/2 + period) {
    ctx.fillStyle = parseColorSafe(cA);
    ctx.fillRect(x, -H/2, wA, H);
    x += wA;
    ctx.fillStyle = parseColorSafe(cB);
    ctx.fillRect(x, -H/2, wB, H);
    x += wB;
  }
  ctx.restore();
}

function drawNoise(ctx: CanvasRenderingContext2D, it: Required<Item & CommonShape>, tex: TextureNoise) {
  const cell = Math.max(1, Math.round(tex.cell ?? 4));
  const [cA, cB] = tex.colors ?? deriveAB(it.color ?? "#000");
  const mix = clamp01(tex.mix ?? 0.5);
  const rng = mulberry32(((tex.seed ?? 1) >>> 0) || 1);

  const W = ctx.canvas.width * 1.2;
  const H = ctx.canvas.height * 1.2;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);

  for (let r = -Math.ceil(rows/2); r <= Math.ceil(rows/2); r++) {
    for (let c = -Math.ceil(cols/2); c <= Math.ceil(cols/2); c++) {
      const t = clamp01(rng() * (rng() < mix ? 1.0 : 0.7));
      const col = lerpColor(cA, cB, t);
      ctx.fillStyle = col;
      ctx.fillRect(c*cell, r*cell, cell, cell);
    }
  }
}

// ---------------------- color & math ----------------------

function clamp01(x: number) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function deg2rad(d: number) { return d * Math.PI / 180; }

function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>\"]/g, (c)=> ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]!));
}

// Convert CSS color to canonical rgba string using canvas, with fallback
function parseColorSafe(c: string): string {
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d")!;
    cx.clearRect(0,0,1,1);
    cx.fillStyle = c; // browser parses here
    return cx.fillStyle as string; // canonical rgba(...)
  } catch {
    return c || "#000";
  }
}

function hexToRgb(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  const m3 = s.match(/^#([0-9a-f]{3})$/i);
  if (m3) {
    const n = m3[1];
    const r = parseInt(n[0] + n[0], 16);
    const g = parseInt(n[1] + n[1], 16);
    const b = parseInt(n[2] + n[2], 16);
    return [r,g,b];
  }
  const m6 = s.match(/^#([0-9a-f]{6})$/i);
  if (m6) {
    const n = m6[1];
    return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
  }
  return null;
}

function rgbStringToRgb(s: string): [number, number, number] | null {
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(",").map(p=>p.trim());
  if (parts.length < 3) return null;
  const r = Math.max(0, Math.min(255, Math.round(parseFloat(parts[0]))));
  const g = Math.max(0, Math.min(255, Math.round(parseFloat(parts[1]))));
  const b = Math.max(0, Math.min(255, Math.round(parseFloat(parts[2]))));
  return [r,g,b];
}

function colorToRgbTuple(c: string): [number, number, number] {
  const h = hexToRgb(c);
  if (h) return h;
  const parsed = parseColorSafe(c);
  const rgb = hexToRgb(parsed) || rgbStringToRgb(parsed);
  return rgb ?? [0,0,0];
}

function mixRgb(a: [number,number,number], b: [number,number,number], t: number): [number,number,number] {
  return [
    Math.round(a[0] + (b[0]-a[0]) * t),
    Math.round(a[1] + (b[1]-a[1]) * t),
    Math.round(a[2] + (b[2]-a[2]) * t),
  ];
}

function rgbToCss([r,g,b]: [number,number,number]): string { return `rgb(${r},${g},${b})`; }

function lighten(c: string, t: number): string {
  const a = colorToRgbTuple(c); const w: [number,number,number] = [255,255,255];
  return rgbToCss(mixRgb(a, w, clamp01(t)));
}

function darken(c: string, t: number): string {
  const a = colorToRgbTuple(c); const k: [number,number,number] = [0,0,0];
  return rgbToCss(mixRgb(a, k, clamp01(t)));
}

function deriveAB(base: string): [string, string] {
  // two-tone derived from base color: slightly lighter/darker
  return [lighten(base, 0.25), darken(base, 0.25)];
}

function lerpColor(a: string, b: string, t: number): string {
  const A = colorToRgbTuple(a), B = colorToRgbTuple(b);
  return rgbToCss(mixRgb(A,B, clamp01(t)));
}

// ---------------------- global exposure ----------------------

export default SymbolPlugin;

declare const window: any;
if (typeof window !== "undefined") {
  window.jsPsychSymbol = SymbolPlugin;
  if (typeof window.initJsPsych === "function") {
    const __init = window.initJsPsych;
    window.initJsPsych = function (...args: any[]) {
      const jsP = __init.apply(this, args);
      const __run = jsP.run.bind(jsP);
      function replaceTypes(node: any): any {
        if (!node || typeof node !== "object") return node;
        if (typeof node.type === "string" && node.type.toLowerCase() === "symbol") node.type = SymbolPlugin;
        if (Array.isArray(node.timeline)) node.timeline = node.timeline.map(replaceTypes);
        if (Array.isArray(node.timeline_variables)) node.timeline_variables = node.timeline_variables.map(replaceTypes);
        return node;
      }
      jsP.run = function (timeline: any) {
        if (Array.isArray(timeline)) timeline = timeline.map(replaceTypes);
        else timeline = replaceTypes(timeline);
        return __run(timeline);
      };
      return jsP;
    };
  }
}
