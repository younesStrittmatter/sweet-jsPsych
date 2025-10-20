// sb-symbol — generalized, layered visual primitives & textures for jsPsych
// Restored defaults (works out-of-the-box) + triangle primitive + CSS color for primitives.
// Primitives: circle | triangle | annulus | rect | rectframe | stripe | cross
// Textures : stripes | noise
// Windows  : circular | rect | raisedcos | gaussian  (alias "mask" accepted)
// Units    : px or deg (px_per_deg defaults to 60)
// Notes    : textures fill the canvas by default; if win_radius_* is given, mask is inferred.
//
// Minimal:
// { type:"symbol",
//   items:[{ kind:"texture", mode:"stripes", orientation_deg:135, win_radius_deg:2 }],
//   trial_duration:500 }

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

const PT =
  typeof window !== "undefined" && (window as any).jsPsych
    ? ((window as any).jsPsych.plugins?.parameterType ??
       (window as any).jsPsych.ParameterType ?? {
         STRING: "string", BOOL: "bool", INT: "int", FLOAT: "float", KEYS: "keys", OBJECT: "object", COMPLEX: "complex",
       })
    : { STRING: "string", BOOL: "bool", INT: "int", FLOAT: "float", KEYS: "keys", OBJECT: "object", COMPLEX: "complex" };

type Blend =
  | "source-over" | "lighter" | "multiply" | "screen" | "overlay"
  | "darken" | "lighten" | "difference" | "exclusion" | "hard-light" | "soft-light";

type WindowKind = "none" | "circular" | "rect" | "raisedcos" | "gaussian";

type Common = {
  x_px?: number; y_px?: number; x_deg?: number; y_deg?: number; // position
  z?: number;                  // draw order (higher = later)
  blend?: Blend;               // compositing
  // Appearance: prefer CSS `color`; else `gray` (0..1)
  color?: string;              // "red", "#0f0", "rgb(200,0,0)", etc.
  gray?: number;               // used if color not given (gamma corrected)
  alpha?: number;              // 0..1
  rotation_deg?: number;
  stroke_px?: number;
  label?: string;

  // Window/Mask (alias: mask)
  window?: WindowKind;
  mask?: WindowKind;

  // Window sizing (px or deg)
  win_radius_px?: number; win_radius_deg?: number;
  win_sigma_px?: number;  win_sigma_deg?: number;
  win_rect_w_px?: number; win_rect_w_deg?: number;
  win_rect_h_px?: number; win_rect_h_deg?: number;

  // Texture coverage shorthand
  // If unspecified, textures default to full canvas coverage
  box?: "canvas" | "cover-window";
};

type Circle = Common & {
  kind: "circle";
  radius_px?: number; radius_deg?: number;
  fill?: boolean; // default true
};

type Triangle = Common & {
  kind: "triangle";            // equilateral, centered
  side_px?: number; side_deg?: number;
  fill?: boolean; // default true
};

type Annulus = Common & {
  kind: "annulus";
  inner_px?: number; outer_px?: number;
  inner_deg?: number; outer_deg?: number;
};

type Rect = Common & {
  kind: "rect" | "rectframe";
  width_px?: number; height_px?: number;
  width_deg?: number; height_deg?: number;
  corner_radius_px?: number;
  fill?: boolean; // respected for "rect" only
};

type StripeBar = Common & {
  kind: "stripe";
  stripe_len_px?: number; stripe_len_deg?: number;
  stripe_w_px?: number;   stripe_w_deg?: number;
};

type Cross = Common & {
  kind: "cross";
  arm_len_px?: number; arm_len_deg?: number;
  arm_w_px?: number;   arm_w_deg?: number;
};

type TextureStripes = Common & {
  kind: "texture";
  mode: "stripes";
  box_w_px?: number; box_w_deg?: number;
  box_h_px?: number; box_h_deg?: number;
  orientation_deg?: number;
  bar_w_px?: number; bar_w_deg?: number;   // half-period for square wave
  duty?: number;                            // 0..1 dark fraction
  phase_deg?: number;
  contrast?: number;                        // amplitude around gray
};

type TextureNoise = Common & {
  kind: "texture";
  mode: "noise";
  box_w_px?: number; box_w_deg?: number;
  box_h_px?: number; box_h_deg?: number;
  contrast?: number;
  seed?: number;
};

type TextureItem = TextureStripes | TextureNoise;
type Item = Circle | Triangle | Annulus | Rect | StripeBar | Cross | TextureItem;

type DataOut = {
  rt: number | null;
  onset_ms: number;
  offset_ms: number;
  resp_key: string | null;
  n_items: number;
  items: Array<{ kind: string; z: number; x_px: number; y_px: number; gray?: number; color?: string; alpha: number; label?: string }>;
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const deg2rad = (d: number) => (d * Math.PI) / 180;

function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function styleColor(item: any, gamma: number, bg_gray_fallback: number) {
  if (typeof item.color === "string" && item.color.trim()) return item.color;
  const g = clamp01((item.gray ?? bg_gray_fallback) as number);
  const u8 = Math.round(Math.pow(g, 1 / gamma) * 255);
  return `rgb(${u8},${u8},${u8})`;
}

const info = <const>{
  name: "symbol",
  version: "0.5.1",
  parameters: {
    canvas_width:   { type: PT.INT,   default: 800 },
    canvas_height:  { type: PT.INT,   default: 600 },
    bg_gray:        { type: PT.FLOAT, default: 0.5 },
    px_per_deg:     { type: PT.FLOAT, default: 60 },   // ✅ sensible default
    gamma:          { type: PT.FLOAT, default: 1.0 },

    items:          { type: PT.COMPLEX, default: [] as Item[] }, // layered content

    // Back-compat (legacy single symbol)
    kind:           { type: PT.STRING, default: null as any },
    size_px:        { type: PT.FLOAT,  default: null as number | null },
    size_deg:       { type: PT.FLOAT,  default: null as number | null },

    // Timing / responses
    trial_duration: { type: PT.INT,   default: null as number | null },
    timeout_ms:     { type: PT.INT,   default: null as number | null },
    response_ends_trial:{ type: PT.BOOL,  default: true },
    choices:  { type: PT.KEYS,  default: [] as string[] },
    allow_mouse:    { type: PT.BOOL,  default: false },
  },
  data: {
    rt:        { type: PT.FLOAT },
    onset_ms:  { type: PT.INT },
    offset_ms: { type: PT.INT },
    resp_key:  { type: PT.STRING },
    n_items:   { type: PT.INT },
    items:     { type: PT.COMPLEX },
  },
};
type Info = typeof info;
type Trial = TrialType<Info>;

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
      <div id="sb-symbol" style="display:flex;justify-content:center;align-items:center;background:#0000;">
        <canvas id="sb-symbol-canvas" width="${trial.canvas_width}" height="${trial.canvas_height}"></canvas>
      </div>
    `;
    this.canvas = display_element.querySelector<HTMLCanvasElement>("#sb-symbol-canvas")!;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;

    this.fillBackground(trial.bg_gray, trial.gamma);

    const items = this.normalizeItems(trial);
    items.sort((a, b) => (a.z - b.z));

    for (const it of items) this.drawItem(trial, it);

    this.startTime = performance.now();

    if (trial.choices && (trial.choices as string[]).length > 0) {
      this.keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info: any) => {
          if (trial.response_ends_trial) this.end(display_element, trial, info.key as string, info.rt as number, items);
        },
        valid_responses: trial.choices as string[],
        rt_method: "performance",
        persist: !trial.response_ends_trial,
        allow_held_key: false,
      });
    }
    if (trial.allow_mouse) {
      const handler = () => { if (trial.response_ends_trial) this.end(display_element, trial, null, null, items); };
      this.canvas.addEventListener("mousedown", handler, { once: !!trial.response_ends_trial });
      if (!trial.response_ends_trial) this.canvas.addEventListener("mousedown", handler);
    }

    const td = trial.timeout_ms ?? trial.trial_duration;
    if (td != null) {
      this.endTimeout = window.setTimeout(() => this.end(display_element, trial, null, null, items), Math.max(0, td));
    }
  }

  private fillBackground(bg: number, gamma: number) {
    const g = clamp01(bg);
    const v = Math.round(Math.pow(g, 1 / gamma) * 255);
    this.ctx.fillStyle = `rgb(${v},${v},${v})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private normalizeItems(trial: Trial) {
    const ppd = trial.px_per_deg ?? 60; // fallback enforced by default above
    const src: Item[] = (Array.isArray(trial.items) && trial.items.length > 0) ? (trial.items as Item[]) : this.legacyToItems(trial);

    const CW = this.canvas?.width  ?? (trial.canvas_width as number)  ?? 800;
    const CH = this.canvas?.height ?? (trial.canvas_height as number) ?? 600;

    return (src as any[]).map((raw: any) => {
      const base: any = {
        kind: raw.kind as Item["kind"],
        x_px: raw.x_px ?? (raw.x_deg != null ? raw.x_deg * ppd : 0),
        y_px: raw.y_px ?? (raw.y_deg != null ? raw.y_deg * ppd : 0),
        z: (raw.z ?? 0) as number,
        blend: (raw.blend ?? "source-over") as Blend,
        color: raw.color ?? null,
        gray: clamp01((raw.gray ?? trial.bg_gray) as number),
        alpha: clamp01((raw.alpha ?? 1) as number),
        rotation_deg: (raw.rotation_deg ?? 0) as number,
        stroke_px: (raw.stroke_px ?? 2) as number,
        label: raw.label as string | undefined,
        window: (raw.window ?? raw.mask ?? "none") as WindowKind, // accept alias
        box: raw.box as ("canvas" | "cover-window" | undefined),

        win_radius_px:  raw.win_radius_px ?? (raw.win_radius_deg != null ? raw.win_radius_deg * ppd : null),
        win_sigma_px:   raw.win_sigma_px  ?? (raw.win_sigma_deg  != null ? raw.win_sigma_deg  * ppd : null),
        win_rect_w_px:  raw.win_rect_w_px ?? (raw.win_rect_w_deg != null ? raw.win_rect_w_deg * ppd : null),
        win_rect_h_px:  raw.win_rect_h_px ?? (raw.win_rect_h_deg != null ? raw.win_rect_h_deg * ppd : null),
      };

      // Normalize "circle" → "circular"
      if (base.window === "circle") base.window = "circular";

      // ✅ Infer a mask when any win_* was provided (deg or px), even if px conversion wasn’t done yet
      if ((raw.window == null) && (raw.mask == null)) {
        const hasCircleWin = (raw.win_radius_px != null) || (raw.win_radius_deg != null);
        const hasRectWin   = (raw.win_rect_w_px != null) || (raw.win_rect_h_px != null) ||
                             (raw.win_rect_w_deg != null) || (raw.win_rect_h_deg != null);
        if (hasCircleWin) base.window = "circular";
        else if (hasRectWin) base.window = "rect";
      }

      switch (String(base.kind || "").toLowerCase()) {
        case "circle":
          base.radius_px = raw.radius_px ?? (raw.radius_deg != null ? raw.radius_deg * ppd : 40);
          base.fill = raw.fill ?? true;
          break;

        case "triangle":
          base.side_px = raw.side_px ?? (raw.side_deg != null ? raw.side_deg * ppd : 100);
          base.fill = raw.fill ?? true;
          break;

        case "annulus":
          base.inner_px = raw.inner_px ?? (raw.inner_deg != null ? raw.inner_deg * ppd : 0);
          base.outer_px = raw.outer_px ?? (raw.outer_deg != null ? raw.outer_deg * ppd : 60);
          break;

        case "rect":
        case "rectframe":
          base.width_px  = raw.width_px  ?? (raw.width_deg  != null ? raw.width_deg  * ppd : 120);
          base.height_px = raw.height_px ?? (raw.height_deg != null ? raw.height_deg * ppd : 120);
          base.corner_radius_px = Math.max(0, raw.corner_radius_px ?? 0);
          if (base.kind === "rect") base.fill = raw.fill ?? true;
          break;

        case "stripe":
          base.stripe_len_px = raw.stripe_len_px ?? (raw.stripe_len_deg != null ? raw.stripe_len_deg * ppd : 300);
          base.stripe_w_px   = raw.stripe_w_px   ?? (raw.stripe_w_deg   != null ? raw.stripe_w_deg   * ppd : 20);
          break;

        case "cross":
          base.arm_len_px = raw.arm_len_px ?? (raw.arm_len_deg != null ? raw.arm_len_deg * ppd : 40);
          base.arm_w_px   = raw.arm_w_px   ?? (raw.arm_w_deg   != null ? raw.arm_w_deg   * ppd : 6);
          break;

        case "texture": {
          const wantCanvas = base.box === "canvas";
          const wantCover  = base.box === "cover-window" && base.win_radius_px;

          if (raw.mode === "noise") {
            base.mode = "noise";
            if (wantCanvas)      { base.box_w_px = CW; base.box_h_px = CH; }
            else if (wantCover)  { const side = Math.ceil(2 * base.win_radius_px * Math.SQRT2) + 2; base.box_w_px = side; base.box_h_px = side; }
            else                 { base.box_w_px = raw.box_w_px ?? (raw.box_w_deg != null ? raw.box_w_deg * ppd : CW);
                                   base.box_h_px = raw.box_h_px ?? (raw.box_h_deg != null ? raw.box_h_deg * ppd : CH); }
            base.contrast = clamp01(raw.contrast ?? 0.5);
            base.seed = Number.isFinite(raw.seed) ? raw.seed : Math.floor(Math.random()*1e9);
          } else {
            base.mode = "stripes";
            if (wantCanvas)      { base.box_w_px = CW; base.box_h_px = CH; }
            else if (wantCover)  { const side = Math.ceil(2 * base.win_radius_px * Math.SQRT2) + 2; base.box_w_px = side; base.box_h_px = side; }
            else                 { base.box_w_px = raw.box_w_px ?? (raw.box_w_deg != null ? raw.box_w_deg * ppd : CW);
                                   base.box_h_px = raw.box_h_px ?? (raw.box_h_deg != null ? raw.box_h_deg * ppd : CH); }
            base.orientation_deg = raw.orientation_deg ?? 0;
            base.bar_w_px = raw.bar_w_px ?? (raw.bar_w_deg != null ? raw.bar_w_deg * ppd : 12); // ≈0.2° at 60 ppd
            base.duty = clamp01(raw.duty ?? 0.5);
            base.phase_deg = raw.phase_deg ?? 0;
            base.contrast = clamp01(raw.contrast ?? 0.6);
          }
          break;
        }

        default:
          base.kind = "circle";
          base.radius_px = 40;
          base.fill = true;
      }
      return base;
    });
  }

  private drawItem(trial: Trial, it: any) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(this.canvas.width/2 + it.x_px), Math.round(this.canvas.height/2 + it.y_px));
    if (it.rotation_deg) ctx.rotate(deg2rad(it.rotation_deg));
    ctx.globalAlpha = it.alpha;
    ctx.globalCompositeOperation = it.blend;

    const needsBuffer = (it.kind === "texture") || (it.window && it.window !== "none");
    if (needsBuffer) {
      const bufW = Math.ceil(this.canvas.width);
      const bufH = Math.ceil(this.canvas.height);
      const off = document.createElement("canvas");
      off.width = bufW; off.height = bufH;
      const octx = off.getContext("2d")!;
      octx.clearRect(0,0,bufW,bufH);

      octx.save();
      octx.translate(Math.round(bufW/2), Math.round(bufH/2));
      if (it.rotation_deg) octx.rotate(deg2rad(it.rotation_deg));

      if (it.kind === "texture") this.drawTextureInto(octx, trial, it);
      else this.drawPrimitiveInto(octx, trial, it);

      octx.restore();

      if (it.window && it.window !== "none") this.applyWindowMask(octx, trial, it);

      ctx.drawImage(off, -Math.round(bufW/2), -Math.round(bufH/2));
      ctx.restore();
      return;
    }

    if (it.kind === "texture") this.drawTextureInto(ctx, trial, it, true);
    else this.drawPrimitiveInto(ctx, trial, it);

    ctx.restore();
  }

  private drawPrimitiveInto(ctx: CanvasRenderingContext2D, trial: Trial, it: any) {
    const fillStroke = styleColor(it, trial.gamma, trial.bg_gray);

    if (it.kind === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, it.radius_px, 0, Math.PI*2);
      ctx.closePath();
      if (it.fill !== false) { ctx.fillStyle = fillStroke; ctx.fill(); }
      else { ctx.lineWidth = it.stroke_px; ctx.strokeStyle = fillStroke; ctx.stroke(); }
    } else if (it.kind === "triangle") {
      const s = Math.max(2, Math.round(it.side_px));
      const h = s * Math.sqrt(3) / 2;
      ctx.beginPath();
      ctx.moveTo(-s/2,  h/2);
      ctx.lineTo( s/2,  h/2);
      ctx.lineTo(  0 , -h/2);
      ctx.closePath();
      if (it.fill !== false) { ctx.fillStyle = fillStroke; ctx.fill(); }
      else { ctx.lineWidth = it.stroke_px; ctx.strokeStyle = fillStroke; ctx.stroke(); }
    } else if (it.kind === "annulus") {
      ctx.fillStyle = fillStroke;
      ctx.beginPath(); ctx.arc(0, 0, it.outer_px, 0, Math.PI*2);
      ctx.arc(0, 0, it.inner_px, 0, Math.PI*2, true);
      ctx.closePath(); ctx.fill("evenodd");
    } else if (it.kind === "rect" || it.kind === "rectframe") {
      const w = it.width_px, h = it.height_px, r = Math.max(0, it.corner_radius_px || 0);
      const path = new Path2D();
      if (r > 0) {
        const rr = Math.min(r, w/2, h/2);
        path.moveTo(-w/2+rr, -h/2);
        path.lineTo(w/2-rr, -h/2); path.arcTo(w/2, -h/2, w/2, -h/2+rr, rr);
        path.lineTo(w/2, h/2-rr);  path.arcTo(w/2, h/2,  w/2-rr, h/2, rr);
        path.lineTo(-w/2+rr, h/2); path.arcTo(-w/2, h/2, -w/2, h/2-rr, rr);
        path.lineTo(-w/2, -h/2+rr);path.arcTo(-w/2, -h/2, -w/2+rr, -h/2, rr);
        path.closePath();
      } else {
        path.rect(-w/2, -h/2, w, h);
      }
      if (it.kind === "rect" && it.fill !== false) { ctx.fillStyle = fillStroke; ctx.fill(path); }
      else { ctx.lineWidth = it.stroke_px; ctx.strokeStyle = fillStroke; ctx.stroke(path); }
    } else if (it.kind === "stripe") {
      ctx.fillStyle = fillStroke;
      ctx.fillRect(-it.stripe_len_px/2, -it.stripe_w_px/2, it.stripe_len_px, it.stripe_w_px);
    } else if (it.kind === "cross") {
      ctx.fillStyle = fillStroke;
      ctx.fillRect(-it.arm_w_px/2, -it.arm_len_px/2, it.arm_w_px, it.arm_len_px);
      ctx.fillRect(-it.arm_len_px/2, -it.arm_w_px/2, it.arm_len_px, it.arm_w_px);
    }
  }

  private drawTextureInto(ctx: CanvasRenderingContext2D, trial: Trial, it: any, _local = false) {
    const W = Math.max(2, Math.round(it.box_w_px));
    const H = Math.max(2, Math.round(it.box_h_px));

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(W, H);
    const d = img.data;
    const mod = (n: number, m: number) => ((n % m) + m) % m;

    if (it.mode === "noise") {
      const rand = mulberry32((it.seed || 1) >>> 0);
      const amp = clamp01(it.contrast ?? 0.5);
      const g0  = clamp01(it.gray);
      const gamma = trial.gamma;
      for (let i = 0; i < W*H; i++) {
        const n = (rand() - 0.5) * amp;
        const vlin = clamp01(g0 + n);
        const vg = Math.round(Math.pow(vlin, 1/gamma) * 255);
        const j = i*4;
        d[j] = vg; d[j+1] = vg; d[j+2] = vg; d[j+3] = 255;
      }
      octx.putImageData(img, 0, 0);
    } else {
      const duty = clamp01(it.duty ?? 0.5);
      const barW = Math.max(1, Math.round(it.bar_w_px));
      const phase = (it.phase_deg ?? 0) / 360;
      const gamma = trial.gamma;
      const g0 = clamp01(it.gray);
      const amp = clamp01(it.contrast ?? 0.6);
      const theta = deg2rad(it.orientation_deg ?? 0);
      const ct = Math.cos(theta), st = Math.sin(theta);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const xn =  (x - W/2) * ct + (y - H/2) * st;
          const t = mod(xn / barW + phase * 2, 2); // period = 2*barW
          const isDark = t < (2 * duty);
          const vlin = clamp01(g0 + (isDark ? -amp/2 : +amp/2));
          const vg = Math.round(Math.pow(vlin, 1/gamma) * 255);
          const j = (y*W + x)*4;
          d[j] = vg; d[j+1] = vg; d[j+2] = vg; d[j+3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
    }

    ctx.drawImage(off, -Math.round(W/2), -Math.round(H/2));
  }

  private applyWindowMask(ctx: CanvasRenderingContext2D, trial: Trial, it: any) {
    const { canvas: srcCanvas } = ctx as any;
    const W = srcCanvas.width, H = srcCanvas.height;

    const mask = document.createElement("canvas");
    mask.width = W; mask.height = H;
    const mctx = mask.getContext("2d")!;
    mctx.clearRect(0,0,W,H);

    mctx.save();
    mctx.translate(Math.round(W/2 + it.x_px), Math.round(H/2 + it.y_px));
    if (it.rotation_deg) mctx.rotate(deg2rad(it.rotation_deg));

    if (it.window === "circular" || it.window === "raisedcos" || it.window === "gaussian") {
      const R = Math.max(2, Math.round(it.win_radius_px ?? Math.min(W,H)/4));
      if (it.window === "circular") {
        mctx.fillStyle = "#fff";
        mctx.beginPath(); mctx.arc(0, 0, R, 0, Math.PI*2); mctx.closePath(); mctx.fill();
      } else {
        const off = document.createElement("canvas");
        off.width = R*2+1; off.height = R*2+1;
        const octx = off.getContext("2d")!;
        const img = octx.createImageData(off.width, off.height);
        const d = img.data;
        const sig = Math.max(1, it.win_sigma_px ?? (it.window === "gaussian" ? R/3 : R/2));
        for (let y = -R; y <= R; y++) {
          for (let x = -R; x <= R; x++) {
            const r = Math.sqrt(x*x + y*y);
            let a = 0;
            if (it.window === "gaussian") a = Math.exp(-(r*r)/(2*sig*sig));
            else a = r <= R ? 0.5 * (1 + Math.cos(Math.PI * r / R)) : 0; // raised-cos
            const j = ((y+R) * (R*2+1) + (x+R)) * 4;
            d[j] = 255; d[j+1] = 255; d[j+2] = 255; d[j+3] = Math.round(255 * clamp01(a));
          }
        }
        octx.putImageData(img, 0, 0);
        mctx.drawImage(off, -R, -R);
      }
    } else if (it.window === "rect") {
      const w = Math.max(2, Math.round(it.win_rect_w_px ?? Math.min(W, H)/2));
      const h = Math.max(2, Math.round(it.win_rect_h_px ?? Math.min(W, H)/2));
      mctx.fillStyle = "#fff";
      mctx.fillRect(-w/2, -h/2, w, h);
    }

    mctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }

  private legacyToItems(trial: Trial): Item[] {
    if (!(trial as any).kind) return [];
    const k = String((trial as any).kind).toLowerCase();
    const ppd = trial.px_per_deg ?? 60;
    const size_px = (trial as any).size_px ?? ( (trial as any).size_deg != null ? (trial as any).size_deg * ppd : 80);
    if (k === "annulus")   return [{ kind:"annulus", outer_px:size_px/2, inner_px:size_px/4 }];
    if (k === "rectframe") return [{ kind:"rectframe", width_px:size_px, height_px:size_px, stroke_px:2 }];
    if (k === "stripe")    return [{ kind:"stripe", stripe_len_px:size_px*1.5, stripe_w_px:Math.max(4, size_px*0.1) }];
    if (k === "rect")      return [{ kind:"rect", width_px:size_px, height_px:size_px }];
    if (k === "cross")     return [{ kind:"cross", arm_len_px:size_px/2, arm_w_px:Math.max(4, size_px*0.08) }];
    if (k === "triangle")  return [{ kind:"triangle", side_px: size_px }];
    return [{ kind:"circle", radius_px:size_px/2 }];
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

  private end(display_element: HTMLElement, trial: Trial, key: string | null, rt_override: number | null, items: any[]) {
    this.clearTimersAndListeners();
    const now = performance.now();
    const data: DataOut = {
      rt: rt_override != null ? Math.round(rt_override) : null,
      onset_ms: Math.round(this.startTime),
      offset_ms: Math.round(now),
      resp_key: key,
      n_items: items.length,
      items: items.map((it: any) => ({
        kind: it.kind, z: it.z, x_px: it.x_px, y_px: it.y_px,
        color: it.color ?? undefined, gray: it.gray ?? undefined, alpha: it.alpha, label: it.label
      })),
    };
    display_element.innerHTML = "";
    this.jsPsych.finishTrial(data);
  }
}

export default SymbolPlugin;

// ---- Global exposure + string-type shim ----
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
