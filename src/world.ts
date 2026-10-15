import * as C from "./constants";
import type {
  Body,
  Direction,
  Drifter,
  FathomState,
  Predator,
  ReadState,
  Screen,
} from "./types";

export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
export const VECTOR: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % 4];
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export function locate(b: Body): void {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
export const layer = (char: string) =>
  Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
export function put(
  rows: string[],
  tx: number,
  ty: number,
  char: string,
): void {
  rows[ty] = rows[ty].slice(0, tx) + char + rows[ty].slice(tx + 1);
}
export function layout(): string[] {
  const rows = layer("#");
  for (const y of [1, 3, 5, 11, 14, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) put(rows, x, y, ".");
  for (let x = 0; x <= 13; x++) {
    put(rows, x, 8, ".");
    put(rows, C.GRID_COLS - 1 - x, 8, ".");
  }
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export const tile = (s: Pick<ReadState, "tiles">, x: number, y: number) =>
  s.tiles[y]?.[x] ?? "#";
export const wrapRow = (s: Pick<ReadState, "tiles">) =>
  s.tiles.findIndex((r) => r[0] === "." && r[C.GRID_COLS - 1] === ".");
export function neighbor(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  dir: Direction,
): [number, number] {
  const [dx, dy] = VECTOR[dir];
  let nx = x + dx;
  if (y === wrapRow(s)) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return [nx, y + dy];
}
export function open(
  s: Pick<ReadState, "tiles">,
  x: number,
  y: number,
  den = false,
): boolean {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "d" || t === "g"));
}
export function exits(
  s: ReadState,
  b: Pick<Body, "tx" | "ty">,
  den = false,
): Direction[] {
  return DIRECTIONS.filter((d) => open(s, ...neighbor(s, b.tx, b.ty, d), den));
}
export function flood(
  s: Pick<ReadState, "tiles">,
  ox: number,
  oy: number,
  den = false,
): number[] {
  const ds = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(-1);
  if (!open(s, ox, oy, den)) return ds;
  const queue: [number, number][] = [[ox, oy]];
  ds[oy * C.GRID_COLS + ox] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const dir of DIRECTIONS) {
      const [nx, ny] = neighbor(s, x, y, dir),
        k = ny * C.GRID_COLS + nx;
      if (open(s, nx, ny, den) && ds[k] === -1) {
        ds[k] = ds[y * C.GRID_COLS + x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return ds;
}
export function route(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const ds = flood(s, target.tx, target.ty, den);
  let best = Infinity,
    result: Direction | null = null;
  for (const dir of exits(s, b, den)) {
    const [x, y] = neighbor(s, b.tx, b.ty, dir),
      d = ds[y * C.GRID_COLS + x];
    if (d >= 0 && d < best) {
      best = d;
      result = dir;
    }
  }
  return result;
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body): Direction | null {
  const all = exits(s, b),
    forward = all.filter((d) => d !== opposite(b.dir));
  const choices = forward.length ? forward : all;
  return choices.length
    ? choices[Math.floor(random(s) * choices.length)]
    : null;
}
/** Move a private next-state body, splitting at centers so no turn skips a junction. */
export function move(
  s: FathomState,
  b: Body,
  distance: number,
  choose: () => Direction | null,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let moved = false;
  while (distance > 1e-8) {
    const c = center(b.tx, b.ty),
      atCenter = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (atCenter) {
      const d = choose();
      if (d === null || !open(s, ...neighbor(s, b.tx, b.ty, d), den)) break;
      b.dir = d;
    }
    const [dx, dy] = VECTOR[b.dir];
    let toCenter = dx ? (c.x - b.x) * dx : (c.y - b.y) * dy;
    if (toCenter <= 1e-7) toCenter += C.TILE;
    const amount = Math.min(distance, toCenter);
    b.x += dx * amount;
    b.y += dy * amount;
    if (b.ty === wrapRow(s)) {
      const width = C.GRID_COLS * C.TILE;
      if (b.x < C.GRID_ORIGIN_X) b.x += width;
      if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    }
    locate(b);
    moved = true;
    distance -= amount;
  }
  return moved;
}
export function drifter(tx: number, ty: number): Drifter {
  return { ...center(tx, ty), dir: "up", lit: false, mind: true, travel: true };
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...drifter(tx, ty),
    kind,
    state: "wander",
    released: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: kind === "gloamfin" ? null : C.LANTERN_RANGE_BASE,
    hearingRange: kind === "gloamfin" ? C.GLOAMFIN_HEAR : null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    markLeft: 0,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: 0,
    flareFade: 0,
    releaseAt: null,
  };
}
export function roster(depth: number): Predator[] {
  return [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ].map((kind, i) => ({
    ...predator(kind, 16 + (i % 4), 8 + Math.floor(i / 4)),
    state: "den",
    released: false,
    releaseAt: i * C.DEN_RELEASE_GAP,
  }));
}
export function clone(s: ReadState): FathomState {
  return {
    ...s,
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    forager: { ...s.forager },
    start: { ...s.start },
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    drifters: s.drifters.map((d) => ({ ...d })),
    pulses: s.pulses.map((p) => ({ ...p, distances: [...p.distances] })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    pointerDown: { ...s.pointerDown },
    pending: [...s.pending],
    sonarMarks: [...s.sonarMarks],
    assets: Object.fromEntries(
      Object.entries(s.assets).map(([k, v]) => [k, [...v]]),
    ),
  };
}
export function reconcile(s: FathomState): FathomState {
  locate(s.forager);
  for (const d of s.drifters) locate(d);
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.join("").split("*").length - 1;
  for (const p of s.predators) {
    locate(p);
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
    p.speed =
      p.kind === "lanternjaw" && p.state === "wander"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
  }
  return s;
}
export function initial(assets: FathomState["assets"] = {}): FathomState {
  const tiles = layout(),
    start = { tx: 17, ty: 14 };
  return reconcile({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted: false,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) =>
      [...r].map((t) => (t === "." ? "*" : "-")).join(""),
    ),
    visibility: layer("u"),
    forager: {
      ...center(start.tx, start.ty),
      dir: "left",
      desired: "left",
      moving: false,
    },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    liveTime: 0,
    screenLeft: 2,
    rng: 0xfafe12,
    start,
    pointerDown: {},
    pending: [],
    sonarMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
    assets,
  });
}
export function screen(s: FathomState, value: Screen): void {
  const previous = s.screen;
  s.screen = value;
  s.menuIndex =
    value === "title"
      ? s.titleIndex
      : value === "paused" || value === "gameover"
        ? 0
        : null;
  s.screenLeft = 2;
  s.pointerDown = {};
  if (value === "playing" && previous !== "paused") s.liveTime = 0;
}
export function fresh(
  s: FathomState,
  target: Screen,
  nextDepth = 1,
): FathomState {
  const n = initial(s.assets);
  n.muted = s.muted;
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  n.depth = nextDepth;
  n.predators = roster(nextDepth);
  if (nextDepth > 1) {
    n.score = s.score;
    n.lives = s.lives;
  }
  screen(n, target);
  return reconcile(n);
}
