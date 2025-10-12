// @sweet-jspsych/plugin-foraging — Arrays API with random non-overlapping default layout
//
// New spacing controls:
//   - arena_size_vmin (default 92)  : centered square arena side
//   - placement_inset_vmin (6)      : uniform inset inside arena for random placement
//   - min_gap_vmin (2.5)            : extra pairwise spacing beyond size radii
//
// Defaults remain:
//   - position_mode: "random" (non-overlapping, absolute, inside centered arena)
//   - trial_duration: null, end_when_found: true
//   - background: #000 (black), text color: #fff
//   - overlay_pool & rotation_pool provide default color/rotation per item
//   - show_star_feedback: false (OFF)

import type { JsPsych, JsPsychPlugin, TrialType } from "jspsych";

type PositionMode = "random" | "grid" | "circle";
type GridPos   = { mode: "grid";  row: number; col: number };
type AbsPos    = { mode: "abs";   left_vmin: number; top_vmin: number };
type CirclePos = { mode: "circle"; angle_deg: number; radius_vmin?: number };
type PosSpec   = GridPos | AbsPos | CirclePos;

type ItemSpec = {
  html?: string;
  text?: string;
  shape?: "circle" | "square" | "triangle";
  src?: string;

  color?: string;
  rotationDeg?: number;
  pos?: PosSpec;
  size?: string;
  fontSize?: string;
  id?: string;
  attrs?: Record<string,string>;
};

type TriggerSpec = {
  on_all_targets_collected?: "end_trial";
};

const PT =
  typeof window !== "undefined" && (window as any).jsPsych
    ? ((window as any).jsPsych.plugins?.parameterType ??
       (window as any).jsPsych.ParameterType ?? {
         STRING: "string",
         BOOL: "bool",
         INT: "int",
         FLOAT: "float",
         COMPLEX: "complex",
       })
    : { STRING: "string", BOOL: "bool", INT: "int", FLOAT: "float", COMPLEX: "complex" };

const DEFAULT_COLOR_POOL = ["#2e9afe","#e74c3c","#27ae60","#f39c12","#9b59b6","#16a085","#d35400","#8e44ad"];
const DEFAULT_ROT_POOL   = [-30,-20,-10,0,10,20,30];

const info = <const>{
  name: "foraging",
  version: "0.7.0",
  parameters: {
    // Arrays-only API
    targets:              { type: PT.COMPLEX, default: [] as ItemSpec[] },
    distractors:          { type: PT.COMPLEX, default: [] as ItemSpec[] },

    // Layout & appearance
    position_mode:        { type: PT.STRING,  default: "random" as PositionMode },
    grid_cols:            { type: PT.INT,     default: null as number | null },
    grid_rows:            { type: PT.INT,     default: null as number | null },
    ring_radius_vmin:     { type: PT.FLOAT,   default: 30 },
    randomize_positions:  { type: PT.BOOL,    default: true }, // grid/circle only

    // Arena & spacing (NEW)
    arena_size_vmin:      { type: PT.FLOAT,   default: 92 },   // centered square side
    placement_inset_vmin: { type: PT.FLOAT,   default: 6 },    // inner margin from arena edges
    min_gap_vmin:         { type: PT.FLOAT,   default: 2.5 },  // extra inter-item gap

    // Token visuals
    token_box_size:       { type: PT.STRING,  default: "10vmin" },
    token_font_size:      { type: PT.STRING,  default: "8vmin" },
    background:           { type: PT.STRING,  default: "#000000" },
    color:                { type: PT.STRING,  default: "#ffffff" },

    // Pools for defaults
    overlay_pool:         { type: PT.COMPLEX, default: DEFAULT_COLOR_POOL as string[] },
    rotation_pool:        { type: PT.COMPLEX, default: DEFAULT_ROT_POOL as number[] },

    // Timing & completion
    trial_duration:       { type: PT.INT,     default: null as number | null },
    end_when_found:       { type: PT.BOOL,    default: true },
    response_ends_trial:  { type: PT.BOOL,    default: false },

    // Determinism
    seed:                 { type: PT.INT,     default: null as number | null },

    // Feedback
    show_star_feedback:   { type: PT.BOOL,    default: false }, // OFF by default
    star_color:           { type: PT.STRING,  default: "#f6b500" },

    // Hooks
    triggers:             { type: PT.COMPLEX, default: { on_all_targets_collected: "end_trial" } as TriggerSpec },
  },
  data: {
    clicks:        { type: PT.COMPLEX },
    n_targets:     { type: PT.INT },
    n_collected:   { type: PT.INT },
    t_items_on:    { type: PT.INT },
    t_end:         { type: PT.INT },
    tps:           { type: PT.FLOAT },
    layout:        { type: PT.COMPLEX }, // [{i,kind,index,id,left_vmin,top_vmin,box}]
  },
};
type Info = typeof info;

class ForagingPlugin implements JsPsychPlugin<Info> {
  static info = info;
  private timeouts: number[] = [];
  private ended = false;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const now = () => performance.now();
    const rng  = (trial.seed != null) ? makeRng(trial.seed as number) : null;
    const pick = <T,>(arr: T[]) => arr[(rng ? Math.floor(rng()*arr.length) : Math.floor(Math.random()*arr.length)) % arr.length];

    // Root
    const root = document.createElement("div");
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.background = trial.background ?? "#000";
    root.style.color = trial.color ?? "#fff";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.userSelect = "none";
    display_element.appendChild(root);

    // Arena: centered square (arena_size_vmin) so vmin coords remain on-screen
    const arena = document.createElement("div");
    arena.style.position = "relative";
    const S = Number(trial.arena_size_vmin ?? 92);
    arena.style.width = `${S}vmin`;
    arena.style.height = `${S}vmin`;
    root.appendChild(arena);

    // Items
    type Built = { kind:"target"|"distractor"; idx:number; spec: ItemSpec; box:string; font:string; color:string; rot:number };
    const targets = (trial.targets ?? []) as ItemSpec[];
    const distractors = (trial.distractors ?? []) as ItemSpec[];
    const colorPool = (trial.overlay_pool ?? DEFAULT_COLOR_POOL) as string[];
    const rotPool   = (trial.rotation_pool ?? DEFAULT_ROT_POOL)   as number[];

    const mkBuilt = (spec: ItemSpec, kind: "target"|"distractor", idx: number): Built => ({
      kind, idx, spec,
      box: spec.size ?? trial.token_box_size ?? "12vmin",
      font: spec.fontSize ?? trial.token_font_size ?? "10vmin",
      color: spec.color ?? pick(colorPool),
      rot: typeof spec.rotationDeg === "number" ? spec.rotationDeg : pick(rotPool),
    });

    const built: Built[] = [
      ...targets.map((s,i)=>mkBuilt(s,"target",i)),
      ...distractors.map((s,i)=>mkBuilt(s,"distractor",i)),
    ];
    const nTargets = targets.length;
    const total = built.length;

    if (total === 0) {
      this.jsPsych.finishTrial({ clicks: [], n_targets: 0, n_collected: 0, t_items_on: now(), t_end: now(), tps: 0, layout: [] });
      return;
    }

    // Styles (jiggle)
    const styleTag = document.createElement("style");
    styleTag.textContent = `
      @keyframes jiggle { 0% { transform: translate(0,0) rotate(0deg); }
        25% { transform: translate(-2px, 1px) rotate(-2deg); }
        75% { transform: translate(2px,-1px) rotate(2deg); }
        100% { transform: translate(0,0) rotate(0deg); } }`;
    root.appendChild(styleTag);

    // Create nodes
    const clickLog: { kind:"target"|"distractor"; index:number; id?:string; t:number }[] = [];
    let collected = 0;

    const items: { kind:"target"|"distractor"; idx:number; id?:string; node:HTMLElement; sizeVmin:number; boxStr:string }[] = [];

    const makeTokenNode = (b: Built) => {
      const color = b.color;
      const box = document.createElement("div");
      box.style.width = b.box;
      box.style.height = b.box;
      box.style.boxSizing = "border-box";
      box.style.display = "flex";
      box.style.alignItems = "center";
      box.style.justifyContent = "center";
      box.style.fontSize = b.font;
      box.style.lineHeight = "1";
      box.style.color = color;
      box.style.border = `2px solid ${color}`;
      box.style.borderRadius = "12px";
      box.style.background = "transparent";
      box.style.transform = `rotate(${b.rot}deg)`;
      if (b.spec.attrs) {
        for (const [k,v] of Object.entries(b.spec.attrs)) { try { box.setAttribute(k,String(v)); } catch {} }
      }

      // Content
      if (b.spec.src) {
        const img = document.createElement("img");
        img.src = b.spec.src;
        img.alt = "";
        img.draggable = false;
        img.style.maxWidth = "100%";
        img.style.maxHeight = "100%";
        img.style.objectFit = "contain";
        box.appendChild(img);
      } else if (b.spec.html) {
        const span = document.createElement("span");
        span.innerHTML = b.spec.html;
        span.style.display = "inline-flex";
        span.style.alignItems = "center";
        span.style.justifyContent = "center";
        span.style.width = "100%";
        span.style.height = "100%";
        span.style.color = color;
        box.appendChild(span);
      } else if (b.spec.text) {
        const span = document.createElement("span");
        span.textContent = b.spec.text;
        span.style.display = "inline-flex";
        span.style.alignItems = "center";
        span.style.justifyContent = "center";
        span.style.width = "100%";
        span.style.height = "100%";
        span.style.color = color;
        box.appendChild(span);
      } else if (b.spec.shape) {
        const shape = b.spec.shape;
        if (shape === "circle" || shape === "square") {
          const sh = document.createElement("div");
          sh.style.width = "70%";
          sh.style.height = "70%";
          sh.style.background = color;
          sh.style.borderRadius = shape === "circle" ? "50%" : "8%";
          box.appendChild(sh);
        } else { // triangle
          const tri = document.createElement("div");
          tri.style.width = "0";
          tri.style.height = "0";
          tri.style.borderLeft = "14% solid transparent";
          tri.style.borderRight = "14% solid transparent";
          tri.style.borderBottom = `28% solid ${color}`;
          box.appendChild(tri);
        }
      } else {
        const span = document.createElement("span");
        span.textContent = "";
        box.appendChild(span);
      }

      // dataset
      box.dataset.kind = b.kind;
      box.dataset.index = String(b.idx);
      if (b.spec.id) box.dataset.id = b.spec.id;

      // click behavior
      box.addEventListener("click", () => {
        if (this.ended) return;
        const t = now();
        if (b.kind === "target") {
          clickLog.push({ kind: b.kind, index: b.idx, id: b.spec.id, t });
          collected += 1;
          box.remove();
          if (trial.show_star_feedback) drawStars(collected, nTargets, trial.star_color ?? "#f6b500", root);
          if (trial.end_when_found && collected >= nTargets && trial.triggers?.on_all_targets_collected === "end_trial") {
            end_trial();
          } else if (trial.response_ends_trial) {
            end_trial();
          }
        } else {
          clickLog.push({ kind: b.kind, index: b.idx, id: b.spec.id, t });
          box.style.animation = "jiggle 120ms ease-in-out 0s 1";
          box.addEventListener("animationend", () => { box.style.animation = ""; }, { once: true });
        }
      });

      return box;
    };

    built.forEach((b) => {
      const node = makeTokenNode(b);
      arena.appendChild(node);
      const sizeVmin = vminToNumber(b.box);
      items.push({ kind: b.kind, idx: b.idx, id: b.spec.id, node, sizeVmin, boxStr: b.box });
    });

    // Placement
    const anyExplicit = built.some(b => !!b.spec.pos);
    if (anyExplicit) {
      items.forEach((it, k) => {
        const p = built[k].spec.pos!;
        placeItem(it.node, p, trial, built[k].boxStr);
      });
    } else if (trial.position_mode === "grid") {
      const [cols, rows] = ensureGrid(trial.grid_cols, trial.grid_rows, total);
      arena.style.display = "grid";
      (arena.style as any).setProperty("--box", String(trial.token_box_size ?? "12vmin"));
      arena.style.gridTemplateColumns = `repeat(${cols}, var(--box))`;
      arena.style.gridTemplateRows = `repeat(${rows}, var(--box))`;
      arena.style.gap = "2.5vmin";
      if (trial.randomize_positions && rng) {
        for (const c of shuffleChildren(arena, rng)) arena.appendChild(c);
      }
    } else if (trial.position_mode === "circle") {
      const ordered = Array.from(items);
      const arr = (trial.randomize_positions && rng) ? shuffle(ordered, rng) : ordered;
      const R = Number(trial.ring_radius_vmin ?? 30);
      const cx = S/2, cy = S/2;
      const step = (2*Math.PI)/arr.length;
      arr.forEach((it, k) => {
        const theta = k * step;
        const left = cx + R * Math.cos(theta);
        const top  = cy + R * Math.sin(theta);
        const el = it.node;
        el.style.position = "absolute";
        el.style.left = `calc(${left}vmin - (${it.boxStr})/2)`;
        el.style.top  = `calc(${top}vmin - (${it.boxStr})/2)`;
      });
    } else {
      // position_mode === "random": non-overlapping placement inside centered SxS arena with insets
      const inset = Math.max(0, Number(trial.placement_inset_vmin ?? 6));
      const placed: { cx:number; cy:number; r:number }[] = [];
      const MAX_TRIES = 1500;
      const extraGap = Math.max(0, Number(trial.min_gap_vmin ?? 2.5));

      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const r = it.sizeVmin / 2;            // approx radius
        const minX = inset + r;
        const maxX = S - inset - r;
        const minY = inset + r;
        const maxY = S - inset - r;

        let tries = 0, cx = 0, cy = 0, ok = false;
        while (tries++ < MAX_TRIES) {
          cx = randInRange(minX, maxX, rng);
          cy = randInRange(minY, maxY, rng);
          ok = placed.every(p => dist(cx,cy,p.cx,p.cy) >= (r + p.r + extraGap));
          if (ok) break;
        }
        placed.push({ cx, cy, r });
        const el = it.node;
        el.style.position = "absolute";
        el.style.left = `calc(${cx}vmin - (${it.boxStr})/2)`;
        el.style.top  = `calc(${cy}vmin - (${it.boxStr})/2)`;
      }
    }

    const t_items_on = now();

    // Trial timers
    if (trial.trial_duration != null) {
      this.timeouts.push(this.jsPsych.pluginAPI.setTimeout(() => end_trial(), Math.max(0, trial.trial_duration)));
    }
    if (trial.end_when_found && nTargets === 0) {
      this.timeouts.push(this.jsPsych.pluginAPI.setTimeout(() => end_trial(), 0));
    }

    const end_trial = () => {
      if (this.ended) return;
      this.ended = true;
      for (const to of this.timeouts) clearTimeout(to);
      this.timeouts = [];

      const t_end = now();
      const seconds = Math.max((t_end - t_items_on) / 1000, 1e-9);
      const tps = (collected ?? 0) / seconds;

      const layout = Array.from(arena.children).map((n: any, i) => {
        const style = (n as HTMLElement).style;
        const left = style.left?.match(/([\d.]+)vmin/);
        const top  = style.top ?.match(/([\d.]+)vmin/);
        return {
          i,
          kind: n.dataset?.kind ?? null,
          index: n.dataset?.index ? Number(n.dataset.index) : null,
          id: n.dataset?.id ?? null,
          left_vmin: left ? parseFloat(left[1]) : null,
          top_vmin:  top  ? parseFloat(top[1])  : null,
          box: (n as HTMLElement).style.width || null
        };
      });

      display_element.innerHTML = "";
      this.jsPsych.finishTrial({
        clicks: clickLog,
        n_targets: nTargets,
        n_collected: collected,
        t_items_on,
        t_end,
        tps,
        layout
      });
    };
  }
}

export default ForagingPlugin;

// ---------- Helpers ----------
function ensureGrid(cols: number | null, rows: number | null, total: number): [number, number] {
  if (cols && rows) return [cols, rows];
  if (cols && !rows) return [cols, Math.ceil(total / cols)];
  if (!cols && rows) return [Math.ceil(total / rows), rows];
  const c = Math.ceil(Math.sqrt(total));
  const r = Math.ceil(total / c);
  return [c, r];
}
function shuffleChildren(container: HTMLElement, rng: (()=>number)): Element[] {
  const arr = Array.from(container.children);
  return shuffle(arr, rng);
}
function shuffle<T>(arr: T[], rng: (()=>number)): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function makeRng(seed: number) {
  let x = (seed | 0) || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}
function vminToNumber(s: string): number {
  const m = String(s).match(/([\d.]+)\s*vmin/);
  return m ? parseFloat(m[1]) : 12;
}
function randInRange(a: number, b: number, rng: (()=>number) | null): number {
  const u = rng ? rng() : Math.random();
  return a + u*(b-a);
}
function dist(x1:number,y1:number,x2:number,y2:number){ const dx=x1-x2, dy=y1-y2; return Math.hypot(dx,dy); }

function placeItem(node: HTMLElement, pos: PosSpec, trial: any, box: string) {
  if (pos.mode === "grid") {
    node.style.gridRowStart = String(pos.row + 1);
    node.style.gridColumnStart = String(pos.col + 1);
  } else if (pos.mode === "abs") {
    node.style.position = "absolute";
    node.style.left = `calc(${pos.left_vmin}vmin - (${box})/2)`;
    node.style.top  = `calc(${pos.top_vmin}vmin - (${box})/2)`;
  } else { // circle (per-item)
    const R = pos.radius_vmin ?? (trial.ring_radius_vmin ?? 30);
    const theta = (pos.angle_deg * Math.PI) / 180;
    const cx = (trial.arena_size_vmin ?? 92)/2;
    const cy = (trial.arena_size_vmin ?? 92)/2;
    const left = cx + R * Math.cos(theta);
    const top  = cy + R * Math.sin(theta);
    node.style.position = "absolute";
    node.style.left = `calc(${left}vmin - (${box})/2)`;
    node.style.top  = `calc(${top}vmin - (${box})/2)`;
  }
}

function drawStars(count: number, total: number, color: string, root: HTMLElement) {
  // top-center overlay above arena; arena is smaller than screen so no occlusion
  const role = "foraging-stars";
  const prev = root.querySelector(`[data-role="${role}"]`);
  if (prev) prev.remove();
  const row = document.createElement("div");
  row.dataset.role = role;
  row.style.position = "absolute";
  row.style.top = "2vmin";
  row.style.left = "50%";
  row.style.transform = "translateX(-50%)";
  row.style.display = "flex";
  row.style.gap = "0.4rem";
  row.style.fontSize = "min(3.6vmin, 18px)";
  for (let i = 0; i < total; i++) {
    const s = document.createElement("span");
    s.textContent = i < count ? "★" : "☆";
    s.style.color = i < count ? color : "#777";
    row.appendChild(s);
  }
  root.appendChild(row);
}

// Expose global & legacy type
declare const window: any;
if (typeof window !== "undefined") {
  window.jsPsychForaging = ForagingPlugin;
  if (typeof window.initJsPsych === "function") {
    const __init = window.initJsPsych;
    window.initJsPsych = function (...args: any[]) {
      const jsP = __init.apply(this, args);
      const __run = jsP.run.bind(jsP);
      function replaceTypes(node: any): any {
        if (!node || typeof node !== "object") return node;
        if (typeof node.type === "string" && node.type.toLowerCase() === "foraging") {
          node.type = ForagingPlugin;
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
