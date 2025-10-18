// plugins/rsvp/src/index.ts
// Minimal RSVP plugin for jsPsych v7 — fixed-size tokens, bilateral positioning
// Updates per request:
//  • Streams are PURE CONTENT (letters/digits). No symbol/color tokens in streams.
//  • Shapes ("square", "circle", "underline", "none") and colors are specified ONLY via targets/distractors.
//  • target_* and distractor_* accept SINGLE values or LISTS with broadcasting:
//      - target_index: number | number[]
//      - target_side: string | string[]           (must match stream ids: e.g., "left" / "right")
//      - target_shape: "square"|"circle"|"underline"|"none" | that[]
//      - target_color: string | string[]          (CSS color; when shape="none", colors the text)
//      - target_html:  string  | string[]         (template wrapper; supports {{content}} / {CONTENT})
//    Same for distractor_* fields.
//  • Explicit arrays `targets: TargetSpec[]` / `distractors: DistractorSpec[]` still supported and merged.
//
// Precedence when rendering a token:
//   1) deco.html (template wrapper; supports {{content}} / {CONTENT})
//   2) plain text with optional decoration (underline/circle/square) or color-only (shape:"none")
//   (No special symbol tokens from stream content; streams remain raw glyphs.)
//
// Bilateral wrapper also updated: accepts scalar OR arrays for target_* / distractor_*.

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

// ----------------------------- Types -----------------------------

type TokenInput = string;

type StreamSpec = {
  id: string;
  items: TokenInput[];
  offset_ms?: number;
  attrs?: Record<string, string>;
};

type ShapeKind = "circle" | "square" | "underline" | "none";

type TargetSpec = {
  stream_id: string;
  index: number;
  label?: string;
  response_window?: number | null;        // null = no time limit (default)
  correct_keys?: string[] | "ALL" | null; // falls back to trial.correct_keys
  shape?: ShapeKind;
  color?: string;   // if shape:"none", this is font color; else border color
  stroke?: string;  // border/underline thickness (e.g., "3px")
  padding?: string; // inner padding for outlined/underlined shapes

  // Optional HTML/template override for this specific cell
  html?: string;        // wrapper or full override (see render precedence)
  style?: string;       // applied to outer wrapper we insert
  className?: string;   // applied to outer wrapper we insert
};

type DistractorSpec = {
  stream_id: string;
  index: number;
  label?: string;
  shape?: ShapeKind;
  color?: string;
  stroke?: string;
  padding?: string;

  html?: string;
  style?: string;
  className?: string;
};

// Runtime-safe parameter type shim (CDN or bundlers)
const PT =
  typeof window !== "undefined" && (window as any).jsPsych
    ? ((window as any).jsPsych.plugins?.parameterType ??
       (window as any).jsPsych.ParameterType ?? {
         STRING: "string",
         BOOL: "bool",
         INT: "int",
         COMPLEX: "complex",
         KEYS: "keys",
       })
    : { STRING: "string", BOOL: "bool", INT: "int", COMPLEX: "complex", KEYS: "keys" };

const info = <const>{
  name: "rsvp",
  version: "1.0.0",
  parameters: {
    // Core presentation
    streams: { type: PT.COMPLEX, default: [{ id: "left", items: [] }, { id: "right", items: [] }] as StreamSpec[] },
    stimulus_duration: { type: PT.INT, default: 100 },
    isi: { type: PT.INT, default: 0 },                // SOA = stimulus_duration + isi
    mask_html: { type: PT.STRING, default: null as any },

    // Layout & appearance
    stream_order: { type: PT.STRING, default: null as any }, // comma-separated ids; else order of `streams`
    direction: { type: PT.STRING, default: "row" },          // "row" (left–right) | "column" (top–bottom)
    gap: { type: PT.STRING, default: "6rem" },               // fallback spacing when not bilateral
    background: { type: PT.STRING, default: "#000000" },
    color: { type: PT.STRING, default: "#ffffff" },          // default text/border color

    // Token sizing (prevents movement)
    token_box_size: { type: PT.STRING, default: "18vmin" },  // square box
    token_font_size: { type: PT.STRING, default: "10vmin" }, // token glyph size
    token_padding: { type: PT.STRING, default: "0.25em 0.45em" },

    // Back-compat hint (maps to direction if you used it)
    layout_mode: { type: PT.STRING, default: null as any },

    // Responses
    choices: { type: PT.KEYS, default: "ALL" },
    response_ends_trial: { type: PT.BOOL, default: false },
    response_window: { type: PT.INT, default: null as any }, // default = no time limit
    correct_keys: { type: PT.STRING, default: null as any }, // e.g., "f,j"

    // Targets (explicit list)
    targets: { type: PT.COMPLEX, default: [] as TargetSpec[] },
    decorate_targets: { type: PT.BOOL, default: true },
    target_stroke: { type: PT.STRING, default: "3px" },      // default thickness for outlined/underline

    // Distractors (explicit list)
    distractors: { type: PT.COMPLEX, default: [] as DistractorSpec[] },
    decorate_distractors: { type: PT.BOOL, default: false },
    distractor_color: { type: PT.STRING, default: "#888888" },
    distractor_stroke: { type: PT.STRING, default: "2px" },

    // Convenience FIELDS (scalars OR arrays) — will be merged into targets/distractors:
    // Targets
    target_index:  { type: PT.COMPLEX, default: null as any }, // number | number[]
    target_side:   { type: PT.COMPLEX, default: null as any }, // string | string[]  (stream ids)
    target_shape:  { type: PT.COMPLEX, default: "none" as any }, // ShapeKind | ShapeKind[]
    target_color:  { type: PT.COMPLEX, default: null as any }, // string | string[]
    target_html:   { type: PT.COMPLEX, default: null as any }, // string | string[]
    // Distractors
    distractor_index: { type: PT.COMPLEX, default: null as any }, // number | number[]
    distractor_side:  { type: PT.COMPLEX, default: null as any }, // string | string[]
    distractor_shape: { type: PT.COMPLEX, default: "none" as any }, // ShapeKind | ShapeKind[]
    distractor_color2:{ type: PT.COMPLEX, default: null as any }, // optional override; falls back to distractor_color
    distractor_html:  { type: PT.COMPLEX, default: null as any }, // string | string[]

    // Lifetime
    trial_duration: { type: PT.INT, default: null as any },

    // Data options
    record_timestamps: { type: PT.BOOL, default: true },
  },
  data: {
    key_press: { type: PT.STRING },
    rt: { type: PT.INT },
    responses: { type: PT.COMPLEX },
    targets: { type: PT.COMPLEX },
    distractors: { type: PT.COMPLEX },
    schedule: { type: PT.COMPLEX },
  },
};
type Info = typeof info;

/**
 * Accept both forms of `streams`:
 *   - Object form: [{ id, items, ... }, ...]
 *   - Short form:  [ ["A","B",...], ["X","Y",...] ]
 * Returns a normalized StreamSpec[] with stable default ids.
 * - 1 stream  -> "center"
 * - 2 streams -> "left", "right"
 * - 3+        -> "s1", "s2", ...
 */
function normalizeStreams(raw: any): StreamSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Short form: string[][]
  if (Array.isArray(raw[0])) {
    const arr = raw as string[][];
    return arr.map((items, i) => ({
      id: arr.length === 1 ? "center" : (arr.length === 2 ? (i === 0 ? "left" : "right") : `s${i + 1}`),
      items: items.map(String),
    }));
  }

  // Object form (tolerate missing id/items)
  const objs = (raw as any[]).map((s, i) => {
    const id =
      s?.id ??
      (raw.length === 1 ? "center" : (raw.length === 2 ? (i === 0 ? "left" : "right") : `s${i + 1}`));
    const items = Array.isArray(s?.items) ? s.items.map(String) : [];
    const offset_ms = s?.offset_ms ?? undefined;
    const attrs = s?.attrs ?? undefined;
    return { id, items, offset_ms, attrs } as StreamSpec;
  });

  return objs;
}

// --------------- helpers: arrays, broadcasting, composition -----------------

function asArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Broadcast multiple arrays to the max length. Any empty array is treated as [undefined]. */
function broadcast<T extends any[]>(...arrays: T): { length: number; get: (i: number) => any[] } {
  const safe = arrays.map(a => (a.length === 0 ? [undefined] : a));
  const L = Math.max(...safe.map(a => a.length));
  return {
    length: L,
    get: (i: number) => safe.map(a => a[i % a.length]),
  };
}

function composeTargetsFromConvenience(trial: any, defaults: {
  stroke: string, padding: string, color: string
}): TargetSpec[] {
  const idxs   = asArray<number>(trial.target_index);
  const sides  = asArray<string>(trial.target_side);
  const shapes = asArray<ShapeKind>(trial.target_shape);
  const colors = asArray<string>(trial.target_color);
  const htmls  = asArray<string>(trial.target_html);

  if (idxs.length === 0 && sides.length === 0 && shapes.length === 0 && colors.length === 0 && htmls.length === 0) {
    return [];
  }

  const B = broadcast(idxs, sides, shapes, colors, htmls);
  const out: TargetSpec[] = [];
  for (let i = 0; i < B.length; i++) {
    const [index, side, shape, color, html] = B.get(i);
    if (typeof index !== "number" || typeof side !== "string") continue; // need both
    out.push({
      stream_id: side,
      index,
      shape: (shape ?? "none") as ShapeKind,
      color: color ?? defaults.color,
      stroke: defaults.stroke,
      padding: defaults.padding,
      ...(html ? { html } : {}),
    });
  }
  return out;
}

function composeDistractorsFromConvenience(trial: any, defaults: {
  stroke: string, padding: string, color: string
}): DistractorSpec[] {
  const idxs   = asArray<number>(trial.distractor_index);
  const sides  = asArray<string>(trial.distractor_side);
  const shapes = asArray<ShapeKind>(trial.distractor_shape);
  const colors = asArray<string>(trial.distractor_color2 ?? trial.distractor_color); // allow per-item override
  const htmls  = asArray<string>(trial.distractor_html);

  if (idxs.length === 0 && sides.length === 0 && shapes.length === 0 && colors.length === 0 && htmls.length === 0) {
    return [];
  }

  const B = broadcast(idxs, sides, shapes, colors, htmls);
  const out: DistractorSpec[] = [];
  for (let i = 0; i < B.length; i++) {
    const [index, side, shape, color, html] = B.get(i);
    if (typeof index !== "number" || typeof side !== "string") continue; // need both
    out.push({
      stream_id: side,
      index,
      shape: (shape ?? "none") as ShapeKind,
      color: color ?? defaults.color,
      stroke: defaults.stroke,
      padding: defaults.padding,
      ...(html ? { html } : {}),
    });
  }
  return out;
}

// ----------------------------- Plugin -----------------------------

class RsvpPlugin implements JsPsychPlugin<Info> {
  static info = info;
  private timeouts: number[] = [];
  private keyboardListener: any = null;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    // ----- Root -----
    const root = document.createElement("div");
    root.className = "rsvp";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.background = (trial as any).background ?? "#000";
    root.style.color = (trial as any).color ?? "#fff";
    display_element.appendChild(root);

    // Normalize streams (accept object form or short form)
    const streams = normalizeStreams((trial as any).streams ?? []);

    // Determine order & layout mode
    const parsedOrder =
      (trial as any).stream_order?.split(",").map((s: string) => s.trim()).filter(Boolean) ?? null;

    const streamsById: Record<string, StreamSpec> = {};
    for (const s of streams) streamsById[s.id] = s;

    const visualOrder: string[] =
      parsedOrder?.filter((id: string) => id in streamsById) ?? streams.map((s) => s.id);

    const dir =
      (trial as any).direction ??
      ((trial as any).layout_mode === "bilateral" ? "row" : (trial as any).layout_mode === "center" ? "row" : "row");

    const isBilateral = dir === "row" && visualOrder.length === 2;

    // ----- Build stream boxes -----
    const boxSize = (trial as any).token_box_size ?? "18vmin";
    const fontSize = (trial as any).token_font_size ?? "10vmin";

    const streamBoxes: Record<string, HTMLElement> = {};

    if (isBilateral) {
      // Precisely place at 1/3 and 2/3 width, centered vertically
      root.style.display = "block";
      for (let i = 0; i < visualOrder.length; i++) {
        const id = visualOrder[i];
        const spec = streamsById[id];
        const box = document.createElement("div");
        box.className = "rsvp-stream";
        box.setAttribute("data-stream-id", id);
        box.style.position = "absolute";
        box.style.top = "50%";
        const leftPct = i === 0 ? "33.3333%" : "66.6667%";
        box.style.left = leftPct;
        box.style.transform = "translate(-50%, -50%)";
        box.style.width = boxSize;
        box.style.height = boxSize;
        box.style.boxSizing = "border-box";
        box.style.display = "flex";
        box.style.alignItems = "center";
        box.style.justifyContent = "center";
        box.style.fontSize = fontSize;
        box.style.lineHeight = "1";
        box.style.color = root.style.color;
        if (spec?.attrs) {
          for (const [k, v] of Object.entries(spec.attrs)) {
            try { box.setAttribute(k, String(v)); } catch {}
          }
        }
        if ((trial as any).mask_html != null) box.innerHTML = tokenHTML(String((trial as any).mask_html), null, trial);
        streamBoxes[id] = box;
        root.appendChild(box);
      }
    } else {
      // Generic flex layout
      root.style.display = "flex";
      root.style.flexDirection = dir === "column" ? "column" : "row";
      root.style.justifyContent = "center";
      root.style.alignItems = "center";
      root.style.gap = (trial as any).gap ?? "6rem";

      for (const id of visualOrder) {
        const spec = streamsById[id];
        const box = document.createElement("div");
        box.className = "rsvp-stream";
        box.setAttribute("data-stream-id", id);
        box.style.display = "flex";
        box.style.alignItems = "center";
        box.style.justifyContent = "center";
        box.style.width = boxSize;
        box.style.height = boxSize;
        box.style.boxSizing = "border-box";
        box.style.fontSize = fontSize;
        box.style.lineHeight = "1";
        box.style.color = root.style.color;
        if (spec?.attrs) {
          for (const [k, v] of Object.entries(spec.attrs)) {
            try { box.setAttribute(k, String(v)); } catch {}
          }
        }
        if ((trial as any).mask_html != null) box.innerHTML = tokenHTML(String((trial as any).mask_html), null, trial);
        streamBoxes[id] = box;
        root.appendChild(box);
      }
    }

    // ----- Schedule -----
    const soa = (trial as any).stimulus_duration + (trial as any).isi;
    const t0 = performance.now();

    type SchedItem = {
      stream_id: string;
      index: number;
      onset: number;   // abs
      offset: number;  // abs
      content: string;
    };

    const schedule: SchedItem[] = [];
    for (const s of streams) {
      const base = t0 + (s.offset_ms ?? 0);
      for (let i = 0; i < s.items.length; i++) {
        const onset = base + i * soa;
        const offset = onset + (trial as any).stimulus_duration;
        schedule.push({ stream_id: s.id, index: i, onset, offset, content: s.items[i] });
      }
    }

    // ----- Targets & Distractors (from explicit + convenience) -----
    const defaults = {
      stroke: (trial as any).target_stroke ?? "3px",
      padding: (trial as any).token_padding ?? "0.25em 0.45em",
      color: (trial as any).color ?? "#fff",
    };
    const dDefaults = {
      stroke: (trial as any).distractor_stroke ?? "2px",
      padding: (trial as any).token_padding ?? "0.25em 0.45em",
      color: (trial as any).distractor_color ?? (trial as any).color ?? "#fff",
    };

    // Merge: explicit arrays + convenience-generated arrays
    const explicitTargets = Array.isArray((trial as any).targets) ? (trial as any).targets : [];
    const explicitDistrs  = Array.isArray((trial as any).distractors) ? (trial as any).distractors : [];
    const convTargets = composeTargetsFromConvenience(trial, defaults);
    const convDistrs  = composeDistractorsFromConvenience(trial, dDefaults);

    const mergedTargets: TargetSpec[] = [...explicitTargets, ...convTargets];
    const mergedDistrs:  DistractorSpec[] = [...explicitDistrs, ...convDistrs];

    // ----- Response parsing defaults -----
    const defaultWindow = (trial as any).response_window ?? null; // null => no time limit
    const parsedCorrectKeys =
      typeof (trial as any).correct_keys === "string" && (trial as any).correct_keys
        ? (trial as any).correct_keys.split(",").map((k: string) => k.trim().toLowerCase())
        : null;

    type DecoSpec = {
      shape: ShapeKind;
      color: string;
      stroke: string;
      padding: string;

      html?: string | null;      // wrapper/full override
      style?: string | null;
      className?: string | null;
    };

    type TargetRuntime = TargetSpec & DecoSpec & {
      onset: number;
      window: number | null;
      correct_keys: string[] | "ALL" | null;
      hit: boolean;
      key?: string;
      rt?: number;
    };

    const targetsRuntime: TargetRuntime[] = (mergedTargets ?? []).map((t) => {
      const onset =
        schedule.find((s) => s.stream_id === t.stream_id && s.index === t.index)?.onset
        ?? Number.NaN;
      return {
        ...t,
        onset,
        window: t.response_window === undefined ? defaultWindow : (t.response_window as number | null),
        correct_keys: t.correct_keys === undefined ? parsedCorrectKeys : t.correct_keys,
        shape: (t.shape ?? "none") as ShapeKind,
        color: t.color ?? (trial as any).color ?? "#fff",
        stroke: t.stroke ?? (trial as any).target_stroke ?? "3px",
        padding: t.padding ?? (trial as any).token_padding ?? "0.25em 0.45em",
        html: t.html ?? null,
        style: t.style ?? null,
        className: t.className ?? null,
        hit: false,
      };
    });

    const targetMap = new Map<string, TargetRuntime>();
    for (const trg of targetsRuntime) targetMap.set(`${trg.stream_id}#${trg.index}`, trg);

    type DistrRuntime = DistractorSpec & DecoSpec;
    const distractorsRuntime: DistrRuntime[] = (mergedDistrs ?? []).map((d) => ({
      ...d,
      shape: (d.shape ?? "none") as ShapeKind,
      color: d.color ?? (trial as any).distractor_color ?? (trial as any).color ?? "#fff",
      stroke: d.stroke ?? (trial as any).distractor_stroke ?? "2px",
      padding: d.padding ?? (trial as any).token_padding ?? "0.25em 0.45em",
      html: d.html ?? null,
      style: d.style ?? null,
      className: d.className ?? null,
    }));

    const distractorMap = new Map<string, DistrRuntime>();
    for (const d of distractorsRuntime) distractorMap.set(`${d.stream_id}#${d.index}`, d);

    // ----- Present -----
    for (const item of schedule) {
      this.timeouts.push(
        this.jsPsych.pluginAPI.setTimeout(() => {
          const box = streamBoxes[item.stream_id];
          if (!box) return;
          // target has priority over distractor if both match
          const key = `${item.stream_id}#${item.index}`;
          const deco =
            ((trial as any).decorate_targets && targetMap.get(key)) ||
            ((trial as any).decorate_distractors && distractorMap.get(key)) ||
            null;
          box.innerHTML = renderToken(item.content, deco, trial);
        }, Math.max(0, item.onset - t0))
      );
      this.timeouts.push(
        this.jsPsych.pluginAPI.setTimeout(() => {
          const box = streamBoxes[item.stream_id];
          if (!box) return;
          if ((trial as any).mask_html != null) box.innerHTML = tokenHTML(String((trial as any).mask_html), null, trial);
          else box.innerHTML = "";
        }, Math.max(0, item.offset - t0))
      );
    }

    // ----- Responses -----
    const responses: { key: string; rt: number }[] = [];
    let firstKey: string | null = null;
    let firstRt: number | null = null;

    const evaluateHit = (keyLower: string, rt: number) => {
      for (const trg of targetsRuntime) {
        if (trg.hit || Number.isNaN(trg.onset)) continue;
        const within =
          trg.window == null
            ? true
            : rt >= trg.onset - t0 && rt <= trg.onset - t0 + trg.window;
        if (!within) continue;

        const ck = trg.correct_keys;
        const keyOk =
          ck === "ALL" || ck == null
            ? true
            : ck.map((k) => k.toLowerCase()).includes(keyLower);

        if (keyOk) {
          trg.hit = true;
          trg.key = keyLower;
          trg.rt = rt;
          break;
        }
      }
    };

    if ((trial as any).choices !== "NO_KEYS") {
      this.keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info) => {
          const key = info.key.toLowerCase();
          const rt = info.rt;
          if (firstKey == null) { firstKey = key; firstRt = rt; }
          responses.push({ key, rt });
          evaluateHit(key, rt);
          if ((trial as any).response_ends_trial) end_trial();
        },
        valid_responses: (trial as any).choices === "ALL" ? undefined : (trial as any).choices,
        rt_method: "performance",
        persist: !((trial as any).response_ends_trial),
        allow_held_key: false,
      });
    }

    // ----- End-of-trial -----
    const lastOffset = schedule.reduce((m, s) => Math.max(m, s.offset), t0);
    const hardStop =
      (trial as any).trial_duration != null ? t0 + (trial as any).trial_duration : lastOffset + ((trial as any).isi ?? 0);

    this.timeouts.push(
      this.jsPsych.pluginAPI.setTimeout(() => end_trial(), Math.max(0, hardStop - t0))
    );

    const end_trial = () => {
      // cancel timers
      for (const to of this.timeouts) clearTimeout(to);
      this.timeouts = [];
      // cancel keyboard
      if (this.keyboardListener) this.jsPsych.pluginAPI.cancelKeyboardResponse(this.keyboardListener);

      // data
      const t0_local = t0;
      const trial_data: any = {
        key_press: firstKey,
        rt: firstRt,
        responses,
        targets: targetsRuntime.map((t) => ({
          stream_id: t.stream_id,
          index: t.index,
          label: t.label,
          onset: Number.isNaN(t.onset) ? null : (t.onset - t0_local),
          window: t.window,
          correct_keys:
            t.correct_keys === "ALL"
              ? "ALL"
              : Array.isArray(t.correct_keys)
              ? t.correct_keys
              : null,
          hit: t.hit,
          key: t.key ?? null,
          rt: t.rt ?? null,
          shape: t.shape,
          color: t.color,
          stroke: t.stroke,
          padding: t.padding,
          html: t.html ?? null,
          style: t.style ?? null,
          className: t.className ?? null,
        })),
        distractors: distractorsRuntime.map((d) => ({
          stream_id: d.stream_id,
          index: d.index,
          label: d.label ?? null,
          shape: d.shape,
          color: d.color,
          stroke: d.stroke,
          padding: d.padding,
          html: d.html ?? null,
          style: d.style ?? null,
          className: d.className ?? null,
        })),
        schedule: (trial as any).record_timestamps
          ? schedule.map((s) => ({
              stream_id: s.stream_id,
              index: s.index,
              onset: s.onset - t0_local,
              offset: s.offset - t0_local,
              content: s.content,
            }))
          : undefined,
      };

      display_element.innerHTML = "";
      this.jsPsych.finishTrial(trial_data);
    };
  }
}

export default RsvpPlugin;
export type { StreamSpec, TargetSpec, DistractorSpec, ShapeKind };

// -------- Helpers --------

function tokenHTML(
  text: string,
  deco: null | {
    shape: ShapeKind;
    color: string;
    stroke: string;
    padding: string;
    // html/style/className handled earlier
  },
  trial: any
): string {
  // inner fixed-size box to avoid movement (fills the stream box)
  const base = [
    `display:flex`,
    `align-items:center`,
    `justify-content:center`,
    `width:100%`,
    `height:100%`,
    `box-sizing:border-box`,
    `font: inherit`,
    `color: inherit`,
    `line-height:1`,
    `text-align:center`,
    `user-select:none`,
  ].join(";");

  // If no decoration or explicit "none", render plain text — but honor deco.color for font
  if (!deco || deco.shape === "none") {
    const colorStyle = deco?.color ? `;color:${deco.color}` : "";
    return `<span style="${base}${colorStyle}">${escapeHTML(text)}</span>`;
  }

  if (deco.shape === "underline") {
    const style = `${base};border-bottom:${deco.stroke} solid ${deco.color};padding:${deco.padding};border-radius:0`;
    return `<span style="${style}">${escapeHTML(text)}</span>`;
  }

  // circle/square outline
  const radius = deco.shape === "circle" ? "50%" : "8%";
  const style = `${base};border:${deco.stroke} solid ${deco.color};border-radius:${radius};padding:${deco.padding}`;
  return `<span style="${style}">${escapeHTML(text)}</span>`;
}

function renderToken(
  token: string,
  deco: (null | {
    shape: ShapeKind;
    color: string;
    stroke: string;
    padding: string;
    html?: string | null;
    style?: string | null;
    className?: string | null;
  }),
  trial: any
): string {
  // 1) deco.html wrapper / full override
  if (deco?.html) {
    const tpl = String(deco.html);
    const hasPlaceholder = tpl.includes('{{content}}') || tpl.includes('{CONTENT}');
    const inner = hasPlaceholder
      ? tpl.replaceAll('{{content}}', escapeHTML(token)).replaceAll('{CONTENT}', escapeHTML(token))
      : tpl;

    const style = deco.style ? ` style="${deco.style}"` : "";
    const cls   = deco.className ? ` class="${deco.className}"` : "";
    return `<div${cls}${style}>${inner}</div>`;
  }

  // 2) text + optional decoration (no special stream tokens)
  return tokenHTML(token, deco ?? null, trial);
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any
  )[c]);
}

// -----------------------------
// Bilateral wrapper (arrays/scalars supported)
// -----------------------------
const bilateralInfo = <const>{
  name: "rsvp-bilateral",
  version: "0.4.0",
  parameters: {
    left:  { type: PT.COMPLEX, default: [] as string[] },
    right: { type: PT.COMPLEX, default: [] as string[] },

    // Convenience (scalars or arrays)
    target_index:  { type: PT.COMPLEX, default: null as any },
    target_side:   { type: PT.COMPLEX, default: null as any },   // "left"/"right"
    target_shape:  { type: PT.COMPLEX, default: "circle" as any },
    target_color:  { type: PT.COMPLEX, default: null as any },
    target_html:   { type: PT.COMPLEX, default: null as any },

    distractor_index: { type: PT.COMPLEX, default: null as any },
    distractor_side:  { type: PT.COMPLEX, default: null as any }, // if omitted, we’ll put opposite to target when possible
    distractor_shape: { type: PT.COMPLEX, default: "none" as any },
    distractor_color: { type: PT.COMPLEX, default: null as any },
    distractor_html:  { type: PT.COMPLEX, default: null as any },

    // pass-through common options
    stimulus_duration: { type: PT.INT, default: 100 },
    isi: { type: PT.INT, default: 0 },
    choices: { type: PT.KEYS, default: "ALL" },
    mask_html: { type: PT.STRING, default: null as any },
    color: { type: PT.STRING, default: "#ffffff" },
    background: { type: PT.STRING, default: "#000000" },
    token_box_size: { type: PT.STRING, default: "18vmin" },
    token_font_size: { type: PT.STRING, default: "10vmin" },
    token_padding: { type: PT.STRING, default: "0.25em 0.45em" },
    trial_duration: { type: PT.INT, default: null as any },
  },
};
type BilateralInfo = typeof bilateralInfo;

class BilateralRsvpPlugin implements JsPsychPlugin<BilateralInfo> {
  static info = bilateralInfo;
  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<BilateralInfo>) {
    const leftItems  = asArray<string>((trial as any).left).map(String);
    const rightItems = asArray<string>((trial as any).right).map(String);

    const base: any = {
      type: (RsvpPlugin as any),
      direction: "row",
      streams: [
        { id: "left", items: leftItems },
        { id: "right", items: rightItems },
      ],
      stimulus_duration: (trial as any).stimulus_duration,
      isi: (trial as any).isi,
      mask_html: (trial as any).mask_html,
      choices: (trial as any).choices,
      color: (trial as any).color,
      background: (trial as any).background,
      token_box_size: (trial as any).token_box_size,
      token_font_size: (trial as any).token_font_size,
      token_padding: (trial as any).token_padding,
      trial_duration: (trial as any).trial_duration,

      // Decorations are enabled since we’re defining via targets/distractors
      decorate_targets: true,
      decorate_distractors: true,
    };

    // Compose targets from convenience
    const tDefaults = { stroke: "3px", padding: (trial as any).token_padding ?? "0.25em 0.45em", color: (trial as any).color ?? "#fff" };
    const dDefaults = { stroke: "2px", padding: (trial as any).token_padding ?? "0.25em 0.45em", color: (trial as any).color ?? "#fff" };

    // If distractor_side is not provided but target_side is, we’ll put distractors on the opposite side
    const tIdxs   = asArray<number>((trial as any).target_index);
    const tSides  = asArray<string>((trial as any).target_side);
    const tShapes = asArray<ShapeKind>((trial as any).target_shape);
    const tColors = asArray<string>((trial as any).target_color);
    const tHtmls  = asArray<string>((trial as any).target_html);

    const dIdxs   = asArray<number>((trial as any).distractor_index);
    let dSides    = asArray<string>((trial as any).distractor_side);
    const dShapes = asArray<ShapeKind>((trial as any).distractor_shape);
    const dColors = asArray<string>((trial as any).distractor_color);
    const dHtmls  = asArray<string>((trial as any).distractor_html);

    if (dSides.length === 0 && tSides.length > 0) {
      // infer opposite sides
      dSides = tSides.map(s => s === "left" ? "right" : (s === "right" ? "left" : s));
    }

    const T = broadcast(tIdxs, tSides, tShapes, tColors, tHtmls);
    const D = broadcast(dIdxs, dSides, dShapes, dColors, dHtmls);

    const targets: TargetSpec[] = [];
    for (let i = 0; i < T.length; i++) {
      const [index, side, shape, color, html] = T.get(i);
      if (typeof index !== "number" || typeof side !== "string") continue;
      targets.push({
        stream_id: side,
        index,
        shape: (shape ?? "circle") as ShapeKind,
        color: color ?? base.color ?? "#fff",
        stroke: tDefaults.stroke,
        padding: tDefaults.padding,
        ...(html ? { html } : {}),
      });
    }

    const distractors: DistractorSpec[] = [];
    for (let i = 0; i < D.length; i++) {
      const [index, side, shape, color, html] = D.get(i);
      if (typeof index !== "number" || typeof side !== "string") continue;
      distractors.push({
        stream_id: side,
        index,
        shape: (shape ?? "none") as ShapeKind,
        color: color ?? base.color ?? "#fff",
        stroke: dDefaults.stroke,
        padding: dDefaults.padding,
        ...(html ? { html } : {}),
      });
    }

    base.targets = targets;
    base.distractors = distractors;

    const impl = new (RsvpPlugin as any)(this.jsPsych);
    impl.trial(display_element, base);
  }
}

// -----------------------------
// Globals & legacy-type shim
// -----------------------------
declare const window: any;

// v7 way (recommended): use `type: jsPsychRsvp` or `type: jsPsychBilateralRsvp`
if (typeof window !== "undefined") {
  window.jsPsychRsvp = RsvpPlugin;
  window.jsPsychBilateralRsvp = BilateralRsvpPlugin;
}

// Legacy convenience: allow `type: "rsvp"` and `type: "rsvp-bilateral"` without changing caller code.
if (typeof window !== "undefined" && typeof window.initJsPsych === "function") {
  const __init = window.initJsPsych;
  window.initJsPsych = function (...args: any[]) {
    const jsP = __init.apply(this, args);
    const __run = jsP.run.bind(jsP);

    function replaceTypes(node: any): any {
      if (!node || typeof node !== "object") return node;

      if (typeof node.type === "string") {
        const t = node.type.toLowerCase();
        if (t === "rsvp") {
          node.type = RsvpPlugin;
          if (node.layout_mode === "bilateral") node.direction = node.direction ?? "row";
          if (node.layout_mode === "vertical")  node.direction = node.direction ?? "column";
        } else if (t === "rsvp-bilateral") {
          node.type = BilateralRsvpPlugin;
        }
      }

      if (Array.isArray(node.timeline)) node.timeline = node.timeline.map(replaceTypes);
      if (Array.isArray(node.timeline_variables)) {
        node.timeline_variables = node.timeline_variables.map(replaceTypes);
      }
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
