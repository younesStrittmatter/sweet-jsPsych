// sb-gabor-array — N-patch Gabor renderer for jsPsych (browser/IIFE friendly)
//
// Features
// - Any number of patches positioned anywhere (and overlapping)
// - Units: use px (x_px, y_px, sigma_px, sf_cpp) OR degrees via px_per_deg (sigma_deg, sf_cpd)
// - Per-patch alpha; trial-level blend_mode: "add" (default) or "max"
// - Keyboard mapping to specific patches or ArrowLeft/ArrowRight extremes
// - Mouse selection chooses nearest patch center
// - Optional end_on_response + trial_duration/timeout_ms
//
// Usage (global):
//   <script src="https://unpkg.com/jspsych@7.3.4"></script>
//   <script src="../dist/index.browser.min.js"></script>
//   const jsPsych = initJsPsych({});
//   jsPsych.run([{ type: jsPsychGaborArray, patches:[...] }]);
// or string form (shim):
//   jsPsych.run([{ type: "gabor-array", patches:[...] }]);
//
// Build note: This file only imports jsPsych TYPEs, so it's safe for IIFE builds.

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

// ---- ParameterType compatibility (avoid undefined PT.COMPLEX in IIFE) ----
const PT =
  typeof window !== "undefined" && (window as any).jsPsych
    ? ((window as any).jsPsych.plugins?.parameterType ??
       (window as any).jsPsych.ParameterType ?? {
         STRING: "string",
         BOOL: "bool",
         INT: "int",
         FLOAT: "float",
         KEYS: "keys",
         OBJECT: "object",
         COMPLEX: "complex",
       })
    : { STRING: "string", BOOL: "bool", INT: "int", FLOAT: "float", KEYS: "keys", OBJECT: "object", COMPLEX: "complex" };

// ---------------- Types ----------------
type Patch = {
  // Position (relative to canvas center), in px
  x_px?: number;              // default 0
  y_px?: number;              // default 0

  // Size/shape: Gaussian sigma in deg (needs px_per_deg) or px
  sigma_deg?: number;
  sigma_px?: number;

  // Grating
  orientation_deg?: number;   // [0..180), default 0
  contrast?: number;          // [0..1], default 0.5 (Michelson)
  sf_cpd?: number;            // cycles/deg (needs px_per_deg)
  sf_cpp?: number;            // cycles/pixel
  phase_deg?: number;         // [0..360), default 0
  size_px?: number;           // explicit square draw size; default ~6*sigma
  alpha?: number;             // [0..1], default 1
  label?: string;             // optional tag in data
};

type PatchDraw = {
  x_px: number;
  y_px: number;
  sigma_px: number;
  orientation_deg: number;
  contrast: number;
  sf_cpp: number;
  phase_deg: number;
  size_px: number;
  alpha: number;
  label?: string;
};

type DataOut = {
  rt: number | null;
  resp_key: string | null;
  resp_side: "left" | "right" | "center" | "patch" | null;
  chosen_patch_index: number | null;
  n_patches: number;
  patches: PatchDraw[];
  onset_ms: number;
  offset_ms: number;
};

// --------------- Helpers ---------------
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const deg2rad = (d: number) => (d * Math.PI) / 180;
const wrap180 = (d: number) => ((d % 180) + 180) % 180;

// ---------------- Plugin.info ----------------
const info = <const>{
  name: "gabor-array",
  version: "0.2.0",
  parameters: {
    patches:               { type: PT.COMPLEX, default: [] as Patch[] },

    // Display / gamma
    canvas_width:          { type: PT.INT,     default: 800 },
    canvas_height:         { type: PT.INT,     default: 600 },
    bg_gray:               { type: PT.FLOAT,   default: 0.5 },
    px_per_deg:            { type: PT.FLOAT,   default: null as number | null },
    gamma:                 { type: PT.FLOAT,   default: 1.0 },
    blend_mode:            { type: PT.STRING,  default: "add" as "add" | "max" },

    // Timing
    trial_duration:        { type: PT.INT,     default: null as number | null },
    timeout_ms:            { type: PT.INT,     default: null as number | null },
    end_on_response:       { type: PT.BOOL,    default: true },

    // Responses
    response_keys:         { type: PT.KEYS,    default: ["ArrowLeft","ArrowRight"] as string[] },
    allow_mouse:           { type: PT.BOOL,    default: true },
    keymap_to_patch_index: { type: PT.OBJECT,  default: null as Record<string, number> | null },
  },
  data: {
    rt:                   { type: PT.FLOAT },
    resp_key:             { type: PT.STRING },
    resp_side:            { type: PT.STRING },
    chosen_patch_index:   { type: PT.INT },
    n_patches:            { type: PT.INT },
    patches:              { type: PT.COMPLEX },
    onset_ms:             { type: PT.INT },
    offset_ms:            { type: PT.INT },
  },
};
type Info = typeof info;
type Trial = TrialType<Info>;

// ---------------- Plugin ----------------
class GaborArrayPlugin implements JsPsychPlugin<Info> {
  static info = info;
  private jsPsych: JsPsych;
  private keyboardListener: any | null = null;
  private endTimeout: number | null = null;
  private startTime = 0;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private dataPatches: PatchDraw[] = [];

  constructor(jsPsych: JsPsych) {
    this.jsPsych = jsPsych;
  }

  trial(display_element: HTMLElement, trial: Trial) {
    // DOM
    display_element.innerHTML = `
      <div id="sb-gabor-array" style="display:flex;justify-content:center;align-items:center;background:#0000;">
        <canvas id="sb-gabor-canvas" width="${trial.canvas_width}" height="${trial.canvas_height}"></canvas>
      </div>
    `;
    this.canvas = display_element.querySelector<HTMLCanvasElement>("#sb-gabor-canvas")!;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;

    // Background
    this.fillBackground(trial.bg_gray, trial.gamma);

    // Prepare patches (normalize units)
    const patches = this.preparePatches(trial);

    // Draw
    this.drawPatches(patches, trial.bg_gray, trial.gamma, trial.blend_mode);

    // Responses
    this.startTime = performance.now();
    this.installResponses(display_element, trial, patches);

    // Timing
    const td = trial.timeout_ms ?? trial.trial_duration;
    if (td != null) {
      this.endTimeout = window.setTimeout(() => {
        this.end(display_element, trial, null, null, patches);
      }, Math.max(0, td));
    }
  }

  private fillBackground(bg: number, gamma: number) {
    const g = clamp01(bg);
    const v = Math.round(Math.pow(g, 1 / gamma) * 255);
    this.ctx.fillStyle = `rgb(${v},${v},${v})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private preparePatches(trial: Trial): PatchDraw[] {
    const ppd = trial.px_per_deg ?? null;
    const defaults = {
      x_px: 0,
      y_px: 0,
      sigma_px: 40,
      orientation_deg: 0,
      contrast: 0.5,
      sf_cpp: 2 / 100, // 0.02 cycles/pixel = 2 cycles / 100 px
      phase_deg: 0,
      alpha: 1,
    };

    const out: PatchDraw[] = [];
    for (const p of (trial.patches ?? []) as Patch[]) {
      let sigma_px = p.sigma_px ?? defaults.sigma_px;
      if (ppd && p.sigma_deg != null) sigma_px = p.sigma_deg * ppd;

      let sf_cpp = p.sf_cpp ?? defaults.sf_cpp;
      if (ppd && p.sf_cpd != null) sf_cpp = p.sf_cpd / ppd;

      const size_px = p.size_px ?? Math.max(8, Math.round((p.sigma_px ?? sigma_px) * 6));
      const alpha = typeof p.alpha === "number" ? clamp01(p.alpha) : defaults.alpha;

      out.push({
        x_px: p.x_px ?? defaults.x_px,
        y_px: p.y_px ?? defaults.y_px,
        sigma_px,
        orientation_deg: wrap180(p.orientation_deg ?? defaults.orientation_deg),
        contrast: clamp01(p.contrast ?? defaults.contrast),
        sf_cpp,
        phase_deg: p.phase_deg ?? defaults.phase_deg,
        size_px,
        alpha,
        label: p.label,
      });
    }
    this.dataPatches = out;
    return out;
  }

  private drawPatches(patches: PatchDraw[], bg_gray: number, gamma: number, blend_mode: "add" | "max") {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const floatBuf = new Float32Array(W * H).fill(clamp01(bg_gray));

    for (const p of patches) {
      const half = Math.floor(p.size_px / 2);
      const theta = deg2rad(p.orientation_deg);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const phi = deg2rad(p.phase_deg);
      const twoPiF = 2 * Math.PI * p.sf_cpp;
      const sig2 = 2 * p.sigma_px * p.sigma_px;
      const alpha = p.alpha ?? 1;

      const cx = Math.round(W / 2 + p.x_px);
      const cy = Math.round(H / 2 + p.y_px);

      for (let dy = -half; dy <= half; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= H) continue;
        for (let dx = -half; dx <= half; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= W) continue;

          const xr = dx * c + dy * s;
          const r2 = dx * dx + dy * dy;
          const env = Math.exp(-r2 / sig2);
          const cosTerm = Math.cos(twoPiF * xr + phi);

          const idx = y * W + x;
          const contrib = bg_gray * p.contrast * cosTerm * env * alpha;

          if (blend_mode === "max") {
            const cand = clamp01(bg_gray + contrib);
            floatBuf[idx] = Math.max(floatBuf[idx], cand);
          } else {
            floatBuf[idx] += contrib; // "add"
          }
        }
      }
    }

    // Write to canvas with gamma correction
    const img = this.ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < floatBuf.length; i++) {
      const v = clamp01(floatBuf[i]);
      const g = Math.pow(v, 1 / gamma);
      const u8 = Math.round(g * 255);
      const j = i * 4;
      d[j] = u8; d[j + 1] = u8; d[j + 2] = u8; d[j + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
  }

  private installResponses(display_element: HTMLElement, trial: Trial, patches: PatchDraw[]) {
    // Keyboard
    if (trial.response_keys && (trial.response_keys as string[]).length > 0) {
      this.keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info: any) => {
          const key = info.key as string;
          const rt = info.rt as number;
          const mapped = this.mapKeyToChoice(key, trial, patches);
          if (trial.end_on_response) {
            this.end(display_element, trial, key, mapped, patches, rt);
          }
        },
        valid_responses: trial.response_keys as string[],
        rt_method: "performance",
        persist: !trial.end_on_response,
        allow_held_key: false,
      });
    }

    // Mouse
    if (trial.allow_mouse) {
      const handler = (ev: MouseEvent) => {
        const rect = this.canvas.getBoundingClientRect();
        const px = (ev.clientX - rect.left) * (this.canvas.width / rect.width);
        const py = (ev.clientY - rect.top) * (this.canvas.height / rect.height);
        const { index, side } = this.nearestPatchSide(px, py, patches);
        if (trial.end_on_response) {
          this.end(display_element, trial, null, { chosen_patch_index: index, resp_side: side }, patches);
        }
      };
      this.canvas.addEventListener("mousedown", handler, { once: !!trial.end_on_response });
      if (!trial.end_on_response) {
        this.canvas.addEventListener("mousedown", handler);
      }
    }
  }

  private mapKeyToChoice(
    key: string,
    trial: Trial,
    patches: PatchDraw[]
  ): { chosen_patch_index: number | null; resp_side: DataOut["resp_side"] } {
    const km = trial.keymap_to_patch_index as Record<string, number> | null;
    if (km && Object.prototype.hasOwnProperty.call(km, key)) {
      const idx = Number(km[key]);
      return { chosen_patch_index: Number.isFinite(idx) ? idx : null, resp_side: "patch" };
    }
    const leftIdx = this.indexOfExtreme(patches, "left");
    const rightIdx = this.indexOfExtreme(patches, "right");
    if (key === "ArrowLeft")  return { chosen_patch_index: leftIdx,  resp_side: "left"  };
    if (key === "ArrowRight") return { chosen_patch_index: rightIdx, resp_side: "right" };
    return { chosen_patch_index: null, resp_side: null };
  }

  private indexOfExtreme(patches: PatchDraw[], which: "left" | "right") {
    if (patches.length === 0) return null;
    let idx = 0;
    for (let i = 1; i < patches.length; i++) {
      if (which === "left"  && patches[i].x_px < patches[idx].x_px) idx = i;
      if (which === "right" && patches[i].x_px > patches[idx].x_px) idx = i;
    }
    return idx;
  }

  private nearestPatchSide(px: number, py: number, patches: PatchDraw[]) {
    if (patches.length === 0) return { index: null as number | null, side: null as DataOut["resp_side"] };
    let idx = 0;
    let best = Infinity;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    for (let i = 0; i < patches.length; i++) {
      const dx = px - (cx + patches[i].x_px);
      const dy = py - (cy + patches[i].y_px);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; idx = i; }
    }
    const x = patches[idx].x_px;
    const side: DataOut["resp_side"] = x < -1 ? "left" : x > 1 ? "right" : "center";
    return { index: idx, side };
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

  private end(
    display_element: HTMLElement,
    trial: Trial,
    key: string | null,
    mapped: { chosen_patch_index: number | null; resp_side: DataOut["resp_side"] } | null,
    patches: PatchDraw[],
    rt_override?: number
  ) {
    this.clearTimersAndListeners();
    const now = performance.now();
    const rt = rt_override != null ? rt_override : (key || mapped) ? now - this.startTime : null;
    const onset_ms = Math.round(this.startTime);
    const offset_ms = Math.round(now);

    const data: DataOut = {
      rt: rt == null ? null : Math.round(rt),
      resp_key: key,
      resp_side: mapped ? mapped.resp_side : null,
      chosen_patch_index: mapped ? mapped.chosen_patch_index : null,
      n_patches: patches.length,
      patches,
      onset_ms,
      offset_ms,
    };

    display_element.innerHTML = "";
    this.jsPsych.finishTrial(data);
  }
}

export default GaborArrayPlugin;

// ---- Global exposure + string-type shim ----
declare const window: any;
if (typeof window !== "undefined") {
  window.jsPsychGaborArray = GaborArrayPlugin;
  if (typeof window.initJsPsych === "function") {
    const __init = window.initJsPsych;
    window.initJsPsych = function (...args: any[]) {
      const jsP = __init.apply(this, args);
      const __run = jsP.run.bind(jsP);

      function replaceTypes(node: any): any {
        if (!node || typeof node !== "object") return node;
        if (typeof node.type === "string" && node.type.toLowerCase() === "gabor-array") {
          node.type = GaborArrayPlugin;
        }
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
