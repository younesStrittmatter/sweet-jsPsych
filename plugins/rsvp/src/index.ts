// plugins/rsvp/src/index.ts
// Minimal RSVP plugin for jsPsych v7 — fixed-size tokens, true circles, bilateral positioning
// - No fixation/prompt/stylesheets; you style around it in SweetBean.
// - LEFT–RIGHT layout by default (row). If exactly two streams in row ("bilateral"),
//   tokens are placed at 1/3 and 2/3 of the screen width (vertically centered).
// - Fixed-size token boxes to prevent movement when borders toggle.
// - True circles (width == height, border-box).
// - New sizing params: token_box_size (default 18vmin), token_font_size (default 10vmin).
// - Target decoration is OFF by default; only applied if specified.
// - Works with BOTH `type: jsPsychRsvp` and legacy `type: "rsvp"` via a shim.

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

type StreamSpec = {
  id: string;
  items: string[];
  offset_ms?: number;
  attrs?: Record<string, string>;
};

type TargetSpec = {
  stream_id: string;
  index: number;
  label?: string;
  response_window?: number | null;        // null = no time limit (default)
  correct_keys?: string[] | "ALL" | null; // falls back to trial.correct_keys
  // per-target decoration (optional)
  shape?: "circle" | "square" | "underline" | "none";
  color?: string;   // defaults to trial.color
  stroke?: string;  // defaults to trial.target_stroke
  padding?: string; // defaults to trial.token_padding
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
  version: "0.8.0",
  parameters: {
    // Core presentation
    streams: { type: PT.COMPLEX, default: [{ id: "left", items: [] }, { id: "right", items: [] }] as StreamSpec[] },
    stimulus_duration: { type: PT.INT, default: 100 },
    isi: { type: PT.INT, default: 0 },                // SOA = stimulus_duration + isi
    mask_html: { type: PT.STRING, default: null },

    // Layout & appearance
    stream_order: { type: PT.STRING, default: null }, // comma-separated ids; else order of `streams`
    direction: { type: PT.STRING, default: "row" },   // "row" (left–right) | "column" (top–bottom)
    gap: { type: PT.STRING, default: "6rem" },        // larger default gap (fallback when not bilateral)
    background: { type: PT.STRING, default: "#000000" },
    color: { type: PT.STRING, default: "#ffffff" },   // text color (and default border color)

    // Token sizing (prevents movement)
    token_box_size: { type: PT.STRING, default: "18vmin" }, // square box
    token_font_size: { type: PT.STRING, default: "10vmin" }, // slightly smaller than before
    token_padding: { type: PT.STRING, default: "0.25em 0.45em" }, // inner padding (applies inside the decoration)

    // Back-compat hint (only maps to direction if you used it)
    layout_mode: { type: PT.STRING, default: null },

    // Responses
    choices: { type: PT.KEYS, default: "ALL" },
    response_ends_trial: { type: PT.BOOL, default: false },
    response_window: { type: PT.INT, default: null }, // default = no time limit
    correct_keys: { type: PT.STRING, default: null }, // e.g., "f,j"

    // Targets (timing + decoration)
    targets: { type: PT.COMPLEX, default: [] as TargetSpec[] },
    decorate_targets: { type: PT.BOOL, default: true }, // OFF by default
    target_shape: { type: PT.STRING, default: "none" },  // no decoration unless specified
    target_stroke: { type: PT.STRING, default: "3px" },

    // Lifetime
    trial_duration: { type: PT.INT, default: null },

    // Data options
    record_timestamps: { type: PT.BOOL, default: true },
  },
  data: {
    key_press: { type: PT.STRING },
    rt: { type: PT.INT },
    responses: { type: PT.COMPLEX },
    targets: { type: PT.COMPLEX },
    schedule: { type: PT.COMPLEX },
  },
};
type Info = typeof info;

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
    root.style.background = trial.background ?? "#000";
    root.style.color = trial.color ?? "#fff";
    display_element.appendChild(root);

    // Determine order & layout mode
    const parsedOrder =
      trial.stream_order?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

    const streamsById: Record<string, StreamSpec> = {};
    for (const s of trial.streams) streamsById[s.id] = s;

    const visualOrder: string[] =
      parsedOrder?.filter((id) => id in streamsById) ?? trial.streams.map((s) => s.id);

    const dir =
      trial.direction ??
      ((trial as any).layout_mode === "bilateral" ? "row" : (trial as any).layout_mode === "center" ? "row" : "row");

    const isBilateral = dir === "row" && visualOrder.length === 2;

    // ----- Build stream boxes -----
    const boxSize = trial.token_box_size ?? "18vmin";
    const fontSize = trial.token_font_size ?? "10vmin";

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
        if (trial.mask_html != null) box.innerHTML = tokenHTML(String(trial.mask_html), null, trial);
        streamBoxes[id] = box;
        root.appendChild(box);
      }
    } else {
      // Generic flex layout
      root.style.display = "flex";
      root.style.flexDirection = dir === "column" ? "column" : "row";
      root.style.justifyContent = "center";
      root.style.alignItems = "center";
      root.style.gap = trial.gap ?? "6rem";

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
        if (trial.mask_html != null) box.innerHTML = tokenHTML(String(trial.mask_html), null, trial);
        streamBoxes[id] = box;
        root.appendChild(box);
      }
    }

    // ----- Schedule -----
    const soa = trial.stimulus_duration + trial.isi;
    const t0 = performance.now();

    type SchedItem = {
      stream_id: string;
      index: number;
      onset: number;   // abs
      offset: number;  // abs
      content: string;
    };

    const schedule: SchedItem[] = [];
    for (const s of trial.streams) {
      const base = t0 + (s.offset_ms ?? 0);
      for (let i = 0; i < s.items.length; i++) {
        const onset = base + i * soa;
        const offset = onset + trial.stimulus_duration;
        schedule.push({ stream_id: s.id, index: i, onset, offset, content: s.items[i] });
      }
    }

    // ----- Targets (timing + decoration) -----
    const defaultWindow = trial.response_window ?? null; // null => no time limit
    const parsedCorrectKeys =
      typeof trial.correct_keys === "string" && trial.correct_keys
        ? trial.correct_keys.split(",").map((k) => k.trim().toLowerCase())
        : null;

    type TargetRuntime = {
      stream_id: string;
      index: number;
      label?: string;
      onset: number;
      window: number | null;
      correct_keys: string[] | "ALL" | null;
      shape: "circle" | "square" | "underline" | "none";
      color: string;   // border color (defaults to trial.color)
      stroke: string;
      padding: string;
      hit: boolean;
      key?: string;
      rt?: number;
    };

    const targetsRuntime: TargetRuntime[] = trial.targets.map((t) => {
      const onset =
        schedule.find((s) => s.stream_id === t.stream_id && s.index === t.index)?.onset
        ?? Number.NaN;
      return {
        stream_id: t.stream_id,
        index: t.index,
        label: t.label,
        onset,
        window: t.response_window === undefined ? defaultWindow : (t.response_window as number | null),
        correct_keys: t.correct_keys === undefined ? parsedCorrectKeys : t.correct_keys,
        shape: (t.shape ?? trial.target_shape ?? "none") as TargetRuntime["shape"],
        color: t.color ?? trial.color ?? "#fff", // default border color = text color
        stroke: t.stroke ?? trial.target_stroke ?? "3px",
        padding: t.padding ?? trial.token_padding ?? "0.25em 0.45em",
        hit: false,
      };
    });

    const targetMap = new Map<string, TargetRuntime>();
    for (const trg of targetsRuntime) targetMap.set(`${trg.stream_id}#${trg.index}`, trg);

    // ----- Present -----
    for (const item of schedule) {
      // onset
      this.timeouts.push(
        this.jsPsych.pluginAPI.setTimeout(() => {
          const box = streamBoxes[item.stream_id];
          if (!box) return;
          const trg = trial.decorate_targets ? (targetMap.get(`${item.stream_id}#${item.index}`) ?? null) : null;
          box.innerHTML = tokenHTML(item.content, trg, trial);
        }, Math.max(0, item.onset - t0))
      );
      // offset → mask/blank
      this.timeouts.push(
        this.jsPsych.pluginAPI.setTimeout(() => {
          const box = streamBoxes[item.stream_id];
          if (!box) return;
          if (trial.mask_html != null) box.innerHTML = tokenHTML(String(trial.mask_html), null, trial);
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

    if (trial.choices !== "NO_KEYS") {
      this.keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info) => {
          const key = info.key.toLowerCase();
          const rt = info.rt;
          if (firstKey == null) { firstKey = key; firstRt = rt; }
          responses.push({ key, rt });
          evaluateHit(key, rt);
          if (trial.response_ends_trial) end_trial();
        },
        valid_responses: trial.choices === "ALL" ? undefined : trial.choices,
        rt_method: "performance",
        persist: !trial.response_ends_trial,
        allow_held_key: false,
      });
    }

    // ----- End-of-trial -----
    const lastOffset = schedule.reduce((m, s) => Math.max(m, s.offset), t0);
    const hardStop =
      trial.trial_duration != null ? t0 + trial.trial_duration : lastOffset + (trial.isi ?? 0);

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
          onset: t.onset - t0_local,
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
        })),
        schedule: trial.record_timestamps
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
export type { StreamSpec, TargetSpec };

// -------- Helpers --------
function tokenHTML(
  text: string,
  trg: null | {
    shape: "circle" | "square" | "underline" | "none";
    color: string;
    stroke: string;
    padding: string;
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

  if (!trg || trg.shape === "none") {
    return `<span style="${base}">${escapeHTML(text)}</span>`;
  }

  if (trg.shape === "underline") {
    const style = `${base};border-bottom:${trg.stroke} solid ${trg.color};padding:${trg.padding};border-radius:0`;
    return `<span style="${style}">${escapeHTML(text)}</span>`;
  }

  // circle/square
  const radius = trg.shape === "circle" ? "50%" : "8%";
  const style = `${base};border:${trg.stroke} solid ${trg.color};border-radius:${radius};padding:${trg.padding}`;
  return `<span style="${style}">${escapeHTML(text)}</span>`;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any
  )[c]);
}

// -----------------------------
// Globals & legacy-type shim
// -----------------------------
declare const window: any;

// v7 way (recommended): use `type: jsPsychRsvp`
if (typeof window !== "undefined") {
  window.jsPsychRsvp = RsvpPlugin;
}

// Legacy convenience: allow `type: "rsvp"` without changing caller code.
if (typeof window !== "undefined" && typeof window.initJsPsych === "function") {
  const __init = window.initJsPsych;
  window.initJsPsych = function (...args: any[]) {
    const jsP = __init.apply(this, args);
    const __run = jsP.run.bind(jsP);

    function replaceTypes(node: any): any {
      if (!node || typeof node !== "object") return node;
      if (typeof node.type === "string" && node.type.toLowerCase() === "rsvp") {
        node.type = RsvpPlugin;
        if (node.layout_mode === "bilateral") node.direction = node.direction ?? "row";
        if (node.layout_mode === "vertical") node.direction = node.direction ?? "column";
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
