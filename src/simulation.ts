import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  Pulse,
  ReadState,
} from "./types";
import {
  center,
  DIRECTIONS,
  drifter,
  exits,
  flood,
  fresh,
  locate,
  move,
  neighbor,
  open,
  opposite,
  put,
  random,
  reconcile,
  roster,
  route,
  screen,
  tile,
  wander,
} from "./world";

export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) =>
  a.tx === b.tx && a.ty === b.ty;
const down = (t: number) => (t <= C.TICK_DT + 1e-10 ? 0 : t - C.TICK_DT);

/** Grid traversal of a segment; the destination rock may receive passive light. */
export function lineOfSight(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  landOnRock = false,
): boolean {
  const ax = (a.x - C.GRID_ORIGIN_X) / C.TILE,
    ay = (a.y - C.GRID_ORIGIN_Y) / C.TILE;
  const bx = (b.x - C.GRID_ORIGIN_X) / C.TILE,
    by = (b.y - C.GRID_ORIGIN_Y) / C.TILE;
  let x = Math.floor(ax),
    y = Math.floor(ay);
  const ex = Math.floor(bx),
    ey = Math.floor(by),
    dx = bx - ax,
    dy = by - ay;
  const sx = Math.sign(dx),
    sy = Math.sign(dy),
    stepX = dx === 0 ? Infinity : Math.abs(1 / dx),
    stepY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextX = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) * stepX;
  let nextY = dy === 0 ? Infinity : (sy > 0 ? y + 1 - ay : ay - y) * stepY;
  for (let i = 0; i < C.GRID_COLS + C.GRID_ROWS + 2; i++) {
    if (tile(s, x, y) === "#" && !(landOnRock && x === ex && y === ey))
      return false;
    if (x === ex && y === ey) return true;
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (tile(s, x + sx, y) === "#" || tile(s, x, y + sy) === "#")
        return false;
      x += sx;
      y += sy;
      nextX += stepX;
      nextY += stepY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += stepX;
    } else {
      y += sy;
      nextY += stepY;
    }
  }
  return false;
}
export function blinded(s: ReadState, p: Body): boolean {
  const f = s.forager,
    dx = f.x - p.x,
    dy = f.y - p.y,
    length = dx * dx + dy * dy;
  return s.inkClouds.some((c) => {
    const t = length
      ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / length))
      : 0;
    return Math.hypot(c.x - p.x - t * dx, c.y - p.y - t * dy) <= c.radius;
  });
}
export function lighting(s: FathomState): void {
  const blooms = s.predators.filter((p) => p.state !== "den" && p.flaring);
  const passive = (x: number, y: number) => {
    const c = center(x, y);
    return (
      distance(s.forager, c) <= s.visionRadius &&
      lineOfSight(s, s.forager, c, true)
    );
  };
  s.visibility = s.visibility.map((row, y) =>
    [...row]
      .map((v, x) => {
        const lit =
          passive(x, y) ||
          s.sonarMarks[y * C.GRID_COLS + x] > s.simTime ||
          blooms.some((p) => distance(p, center(x, y)) <= C.FLARE_RADIUS);
        return lit ? "l" : v === "u" ? "u" : "r";
      })
      .join(""),
  );
  const bodyLit = (b: Body) =>
    passive(b.tx, b.ty) || blooms.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (bodyLit(p) || (p.kind !== "lanternjaw" && p.markLeft > 0) || p.alert);
  for (const d of s.drifters) d.lit = bodyLit(d);
}
function acquire(s: FathomState, p: Predator): void {
  if (p.state !== "chase") {
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flaring) p.flareFade = 0.4;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
    p.flarePhase = 0;
  }
}
function lose(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flarePhase = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
export function cast(
  s: FathomState,
  source: Pulse["source"],
  ox: number,
  oy: number,
  range: number,
  owner: number | null = null,
  tint: Pulse["tint"] = "cyan",
): void {
  s.pulses.push({
    source,
    tint,
    ox,
    oy,
    range,
    owner,
    front: -1e-9,
    caught: false,
    distances: flood(s, ox, oy),
  });
}
function ping(
  s: FathomState,
  p: Predator,
  index: number,
  orange: boolean,
  cues: Set<string>,
): void {
  cast(
    s,
    "gloamfin",
    p.tx,
    p.ty,
    C.GLOAMFIN_PING_RANGE,
    index,
    orange ? "orange" : "violet",
  );
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  if (orange) p.searchPing = true;
  cues.add(C.CUES.predatorPing);
}
function waves(s: FathomState): void {
  for (const pulse of s.pulses) {
    const old = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const reached = (x: number, y: number) => {
      const d = pulse.distances[y * C.GRID_COLS + x];
      return d >= 0 && d <= pulse.range && d > old && d <= pulse.front;
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (reached(x, y)) {
            s.sonarMarks[y * C.GRID_COLS + x] = s.simTime + C.SONAR_MARK_TIME;
            put(s.visibility, x, y, "l");
            for (const d of DIRECTIONS) {
              const [nx, ny] = neighbor(s, x, y, d);
              if (
                nx >= 0 &&
                nx < C.GRID_COLS &&
                ny >= 0 &&
                ny < C.GRID_ROWS &&
                tile(s, nx, ny) === "#"
              ) {
                s.sonarMarks[ny * C.GRID_COLS + nx] =
                  s.simTime + C.SONAR_MARK_TIME;
                put(s.visibility, nx, ny, "l");
              }
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && reached(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.markLeft = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      pulse.caught = true;
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") acquire(s, p);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function mind(
  s: FathomState,
  p: Predator,
  index: number,
  cues: Set<string>,
): void {
  p.alertLeft = down(p.alertLeft);
  p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
  p.markLeft = down(p.markLeft);
  p.flareFade = down(p.flareFade);
  if (p.state === "den") return;
  if (p.kind === "gloamfin") {
    const wasLocked = p.hearingLock;
    p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    if (p.hearingLock) acquire(s, p);
    p.pingIn = down(p.pingIn);
    p.sincePing += C.TICK_DT;
    if (wasLocked && !p.hearingLock) p.pingIn = 0;
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
    if (p.state === "chase" && p.fix && same(p, p.fix) && !same(p, s.forager)) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) lose(p);
    }
    const orange =
      p.state === "search" &&
      p.searchTime >= C.GLOAMFIN_SEARCH_DELAY &&
      !p.searchPing;
    if (
      !p.hearingLock &&
      p.sincePing + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP &&
      (orange || p.pingIn === 0)
    )
      ping(s, p, index, orange, cues);
  } else {
    const ink = blinded(s, p);
    const sense =
      !ink &&
      distance(p, s.forager) <= (p.detectRange ?? 0) &&
      lineOfSight(s, p, s.forager);
    const flareSense =
      !ink && p.flaring && distance(p, s.forager) <= C.FLARE_RADIUS;
    if (ink) {
      if (p.state === "chase" || p.flaring || p.flareCharging) lose(p);
    } else if (sense || flareSense) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) lose(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flareCharging || p.flaring) {
        p.flarePhase += C.TICK_DT;
        if (p.flareCharging && p.flarePhase + 1e-8 >= C.FLARE_CHARGE) {
          p.flareCharging = false;
          p.flaring = true;
          p.flareRadius = C.FLARE_RADIUS;
          p.flarePhase = 0;
          cues.add(C.CUES.flare);
        } else if (p.flaring && p.flarePhase + 1e-8 >= C.FLARE_BLOOM) {
          p.flaring = false;
          p.flareRadius = 0;
          p.flareFade = 0.4;
          p.flarePhase = 0;
          p.flareIn = C.FLARE_INTERVAL;
        }
      } else {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) {
          p.flareCharging = true;
          p.flarePhase = 0;
        }
      }
    }
  }
}
function predatorMove(s: FathomState, p: Predator): void {
  if (!p.mind || !p.travel || (p.state === "den" && !p.released)) return;
  if (p.state === "den") {
    const gy = s.tiles.findIndex((r) => r.includes("g")),
      gx = gy < 0 ? -1 : s.tiles[gy].indexOf("g");
    if (gx < 0 || !s.tiles.some((r) => r.includes("d"))) return;
    const target = { tx: gx, ty: gy - 1 };
    move(s, p, p.speed * C.TICK_DT, () => route(s, p, target, true), true);
    if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  const choose = () => {
    let dir: Direction | null;
    if (p.state === "chase" && p.fix)
      dir = same(p, p.fix) ? null : route(s, p, p.fix);
    else if (p.state === "search" && p.fix) {
      const options = exits(s, p).filter((d) => {
        const [x, y] = neighbor(s, p.tx, p.ty, d);
        return (
          Math.hypot(x - p.fix!.tx, y - p.fix!.ty) <= C.GLOAMFIN_SEARCH_ROAM
        );
      });
      const forward = options.filter((d) => d !== opposite(p.dir));
      const choices = forward.length ? forward : options;
      dir = choices.length
        ? choices[Math.floor(random(s) * choices.length)]
        : route(s, p, p.fix);
    } else dir = wander(s, p);
    if (
      dir &&
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      dir !== p.dir &&
      dir !== opposite(p.dir)
    )
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
    return dir;
  };
  if (p.state === "chase" && p.fix && !same(p, p.fix)) {
    const desired = route(s, p, p.fix);
    if (desired === opposite(p.dir)) p.dir = desired;
  }
  move(s, p, p.speed * C.TICK_DT, choose);
}
function attempt(s: FathomState): void {
  s.forager = {
    ...s.forager,
    ...center(s.start.tx, s.start.ty),
    moving: false,
    desired: s.forager.dir,
  };
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.sonarMarks.fill(0);
  s.visibility = s.visibility.map((r) => r.replace(/l/g, "r"));
  screen(s, "countdown");
}
export interface TickInput {
  held: Direction[];
  sonar: boolean;
  ink: boolean;
}
export function tick(
  s: FathomState,
  input: TickInput,
  cues: Set<string>,
): FathomState {
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown") {
    s.screenLeft = down(s.screenLeft);
    lighting(s);
    if (s.screenLeft === 0) {
      screen(s, "playing");
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared") {
    s.screenLeft = down(s.screenLeft);
    return s.screenLeft === 0 ? fresh(s, "countdown", s.depth + 1) : s;
  }
  if (s.screen !== "playing") return s;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  const decay = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= 0.5 ** (decay / C.BRIGHT_HALFLIFE);
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  if (input.sonar && s.sonar.cooldown === 0) {
    cast(s, "forager", s.forager.tx, s.forager.ty, s.sonar.range);
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (input.ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  const f = s.forager;
  if (input.held.length) {
    if (!input.held.includes(f.desired))
      f.desired = input.held[input.held.length - 1];
    if (f.desired === opposite(f.dir)) f.dir = f.desired;
    f.moving = move(s, f, C.FORAGER_SPEED * C.TICK_DT, () =>
      open(s, ...neighbor(s, f.tx, f.ty, f.desired)) ? f.desired : f.dir,
    );
  } else f.moving = false;
  locate(f);
  let ateLast = false;
  if (tile(s, f.tx, f.ty) === "." && s.plankton[f.ty]?.[f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    ateLast = s.planktonRemaining === 0;
  }
  reconcile(s);
  waves(s);
  for (const [i, p] of s.predators.entries()) {
    if (p.releaseAt !== null && s.liveTime + 1e-8 >= p.releaseAt)
      p.released = true;
    if (p.mind) mind(s, p, i, cues);
    else p.markLeft = down(p.markLeft);
    reconcilePredatorSpeed(p);
    predatorMove(s, p);
  }
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED * C.TICK_DT, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (same(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (s.planktonRemaining > 0) {
    s.drifterIn = down(s.drifterIn);
    if (s.drifterIn === 0 && s.drifters.length < C.DRIFTER_MAX) {
      const y = s.tiles.findIndex((r) => r.includes("g")),
        x = y < 0 ? -1 : s.tiles[y].indexOf("g");
      if (x >= 0) {
        const gate = { tx: x, ty: y },
          dir = exits(s, gate)[0];
        if (dir) {
          s.drifters.push(drifter(...neighbor(s, x, y, dir)));
          s.drifterIn = C.DRIFTER_INTERVAL;
        }
      }
    }
  }
  s.liveTime += C.TICK_DT;
  const contact = s.predators.some((p) => p.state !== "den" && same(p, f));
  if (contact) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) screen(s, "gameover");
    else {
      s.lives--;
      attempt(s);
    }
  } else if (ateLast) {
    s.score += C.SCORE_CLEAR;
    cues.add(C.CUES.descend);
    screen(s, "cleared");
  }
  reconcile(s);
  if (
    s.screen === "playing" ||
    s.screen === "countdown" ||
    s.screen === "cleared"
  )
    lighting(s);
  return s;
}
function reconcilePredatorSpeed(p: Predator): void {
  p.speed =
    p.kind === "lanternjaw" && p.state === "wander"
      ? C.DRIFTER_SPEED
      : p.kind === "gloamfin" && p.state === "chase"
        ? p.chaseSpeed
        : C.PREDATOR_SPEED;
}
