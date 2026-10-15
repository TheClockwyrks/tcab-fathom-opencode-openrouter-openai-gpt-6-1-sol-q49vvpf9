import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  Predator,
  ReadState,
  Rect,
} from "./types";
import {
  center,
  clone,
  DIRECTIONS,
  drifter,
  flood,
  initial,
  layer,
  open,
  predator,
  put,
  reconcile,
  roster,
  screen,
  tile,
} from "./world";

export function menuItems(s: Pick<ReadState, "screen">): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return s.screen === "title"
    ? { x: 128, y: 424 + index * 66, w: 340, h: 54 }
    : { x: 460, y: 360 + index * 64, w: 360, h: 52 };
}
function requireValue(ok: boolean, label: string): asserts ok {
  if (!ok) throw new RangeError(`Fathom: invalid ${label}`);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  requireValue(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
    "number",
  );
}
function boolean(b: boolean): void {
  requireValue(typeof b === "boolean", "boolean");
}
function direction(d: Direction): void {
  requireValue(DIRECTIONS.includes(d), "direction");
}
function position(s: ReadState, x: number, y: number, den = false): void {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  requireValue(open(s, x, y, den), "tile");
}
function pose(s: ReadState, apply: (next: FathomState) => void): FathomState {
  const n = clone(s);
  apply(n);
  return reconcile(n);
}
function hunter(
  s: ReadState,
  index: number,
  apply: (p: Predator, next: FathomState) => void,
): FathomState {
  number(index, 0, s.predators.length - 1, true);
  return pose(s, (n) => apply(n.predators[index], n));
}
function drifterFlag(
  s: ReadState,
  index: number,
  flag: "mind" | "travel",
  enabled: boolean,
): FathomState {
  number(index, 0, s.drifters.length - 1, true);
  boolean(enabled);
  return pose(s, (n) => {
    n.drifters[index][flag] = enabled;
  });
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset(s) {
    return { ...initial(clone(s).assets), muted: s.muted };
  },
  snapshot(s) {
    const n = reconcile(clone(s));
    return {
      version: C.FATHOM_DEBUG_VERSION,
      screen: n.screen,
      menuIndex: n.menuIndex,
      titleIndex: n.titleIndex,
      depth: n.depth,
      score: n.score,
      lives: n.lives,
      muted: n.muted,
      planktonRemaining: n.planktonRemaining,
      drifterIn: n.drifterIn,
      brightness: n.brightness,
      brightHold: n.brightHold,
      visionRadius: n.visionRadius,
      windowRadius: n.windowRadius,
      sonar: n.sonar,
      ink: n.ink,
      grid: n.grid,
      tiles: n.tiles,
      plankton: n.plankton,
      visibility: n.visibility,
      forager: {
        x: n.forager.x,
        y: n.forager.y,
        tx: n.forager.tx,
        ty: n.forager.ty,
        dir: n.forager.dir,
        moving: n.forager.moving,
      },
      drifters: n.drifters.map((d) => ({
        x: d.x,
        y: d.y,
        tx: d.tx,
        ty: d.ty,
        lit: d.lit,
        mind: d.mind,
        travel: d.travel,
      })),
      predators: n.predators.map((p) => ({
        kind: p.kind,
        x: p.x,
        y: p.y,
        tx: p.tx,
        ty: p.ty,
        dir: p.dir,
        state: p.state,
        released: p.released,
        mind: p.mind,
        travel: p.travel,
        speed: p.speed,
        alert: p.alert,
        lit: p.lit,
        detectRange: p.detectRange,
        hearingRange: p.hearingRange,
        hearingLock: p.hearingLock,
        flareCharging: p.flareCharging,
        flaring: p.flaring,
        flareRadius: p.flareRadius,
      })),
      pulses: n.pulses.map((p) => ({
        source: p.source,
        tint: p.tint,
        ox: p.ox,
        oy: p.oy,
        front: p.front,
        range: p.range,
      })),
      inkClouds: n.inkClouds,
      simTime: n.simTime,
    };
  },
  reconcile: (s) => reconcile(clone(s)),
  setScreen(s, value) {
    requireValue(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(value),
      "screen",
    );
    return pose(s, (n) => screen(n, value));
  },
  setMenuIndex(s, index) {
    number(index, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = index;
    });
  },
  setTitleIndex(s, index) {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = index;
    });
  },
  menuItemRect,
  setScore(s, points) {
    number(points, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = points;
    });
  },
  setLives(s, value) {
    number(value, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = value;
    });
  },
  setDepth(s, value) {
    number(value, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = value;
      n.predators = roster(value);
    });
  },
  setMaze(s, rows) {
    requireValue(
      Array.isArray(rows) &&
        rows.length === C.GRID_ROWS &&
        rows.every(
          (r) =>
            typeof r === "string" &&
            r.length === C.GRID_COLS &&
            /^[#.gd]+$/.test(r),
        ),
      "maze",
    );
    const gates = rows.join("").split("g").length - 1;
    requireValue(!/[gd]/.test(rows.join("")) || gates === 1, "den gate");
    return pose(s, (n) => {
      n.tiles = [...rows];
      n.pulses = n.pulses.map((p) => ({
        ...p,
        distances: flood(n, p.ox, p.oy),
      }));
    });
  },
  setPlankton(s, x, y, present) {
    position(s, x, y);
    boolean(present);
    return pose(s, (n) => put(n.plankton, x, y, present ? "*" : "-"));
  },
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.sonarMarks.fill(0);
    }),
  setForagerTile(s, x, y) {
    position(s, x, y);
    return pose(s, (n) => {
      Object.assign(n.forager, center(x, y), {
        moving: false,
        desired: n.forager.dir,
      });
    });
  },
  setForagerDir(s, d) {
    direction(d);
    return pose(s, (n) => {
      n.forager.dir = d;
      n.forager.desired = d;
      n.forager.moving = false;
    });
  },
  setBrightness(s, g) {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold(s, seconds) {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = seconds;
    });
  },
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator(s, kind, x, y) {
    requireValue(C.DEN_ORDER.includes(kind), "predator kind");
    position(s, x, y);
    return pose(s, (n) => {
      n.predators.push(predator(kind, x, y));
    });
  },
  setPredatorTile(s, index, x, y) {
    position(s, x, y, true);
    return hunter(s, index, (p) => Object.assign(p, center(x, y)));
  },
  setPredatorDir(s, index, d) {
    direction(d);
    return hunter(s, index, (p) => {
      p.dir = d;
    });
  },
  setPredatorState(s, index, value) {
    requireValue(["den", "wander", "chase"].includes(value), "predator state");
    return hunter(s, index, (p, n) => {
      const t = tile(n, p.tx, p.ty);
      requireValue(
        value === "den" ? t === "d" || t === "g" : t === ".",
        "predator state tile",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      if (p.kind === "flarefish") {
        p.flareIn = C.FLARE_INTERVAL;
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
        p.flarePhase = 0;
      }
    });
  },
  setPredatorReleased(s, i, enabled) {
    boolean(enabled);
    return hunter(s, i, (p) => {
      p.released = enabled;
    });
  },
  setPredatorMind(s, i, enabled) {
    boolean(enabled);
    return hunter(s, i, (p) => {
      p.mind = enabled;
    });
  },
  setPredatorTravel(s, i, enabled) {
    boolean(enabled);
    return hunter(s, i, (p) => {
      p.travel = enabled;
    });
  },
  spawnDrifter(s, x, y) {
    position(s, x, y);
    return pose(s, (n) => {
      n.drifters.push(drifter(x, y));
    });
  },
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, enabled) => drifterFlag(s, i, "mind", enabled),
  setDrifterTravel: (s, i, enabled) => drifterFlag(s, i, "travel", enabled),
  setDrifterIn(s, seconds) {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = seconds;
    });
  },
  setSonarCooldown(s, seconds) {
    number(seconds);
    return pose(s, (n) => {
      n.sonar.cooldown = seconds;
    });
  },
  setInkCooldown(s, seconds) {
    number(seconds);
    return pose(s, (n) => {
      n.ink.cooldown = seconds;
    });
  },
};
