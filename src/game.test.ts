import { createCanvas } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
  type Engine,
} from "@clockwyrks/simple-2d";
import { afterEach, describe, expect, it } from "vitest";
import {
  game,
  BACKGROUND,
  type FathomDebugApi,
  type FathomState,
  type Screen,
} from "./game";
import * as C from "./constants";
import { center, exits, flood, layer, put } from "./world";

type Harness = Awaited<ReturnType<typeof setup>>;
const engines: Engine<FathomState, FathomDebugApi>[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
});
async function setup(render = false) {
  const target = new EventTarget();
  const engine = createEngine({
    canvas: createCanvas(C.STAGE_W, C.STAGE_H) as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    layout: C.LAYOUT,
    game: {
      ...game,
      initialize: (api) =>
        game.initialize({
          ...api,
          assets: {
            ...api.assets,
            loadImage: async () =>
              createCanvas(32, 32) as unknown as ImageBitmap,
          },
        }),
      render: render ? game.render : () => {},
    },
    clock: new ConstantClock(1000 / 60),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(engine);
  await engine.initialize();
  const key = (type: "keydown" | "keyup", code: string) =>
    target.dispatchEvent(
      Object.assign(new Event(type), { code, repeat: false }),
    );
  const press = async (code: string) => {
    key("keydown", code);
    await engine.advance(1);
    key("keyup", code);
  };
  const pointer = (
    type: string,
    x: number,
    y: number,
    id = 1,
    device = "mouse",
  ) =>
    target.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: id,
        pointerType: device,
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  return {
    engine,
    d: engine.debug,
    apply: engine.apply.bind(engine),
    key,
    press,
    pointer,
    snapshot: () => engine.debug.snapshot(engine.state),
  };
}
function fixture(h: Harness, rows?: string[]) {
  const maze = rows ?? layer(".");
  h.apply((s) => h.d.setMaze(s, maze));
  h.apply((s) => h.d.clearPlankton(s));
  h.apply((s) => h.d.clearPredators(s));
  h.apply((s) => h.d.setForagerTile(s, 5, 8));
  h.apply((s) => h.d.setScreen(s, "playing"));
}
const predatorAt = (h: Harness, kind: C.PredatorKind, x: number, y: number) => {
  h.apply((s) => h.d.addPredator(s, kind, x, y));
  h.apply((s) =>
    h.d.setPredatorTravel(s, h.engine.state.predators.length - 1, false),
  );
};

describe("the maze and value contract", () => {
  it("lays out a connected, symmetric, one-wide maze with the required proportions and den", async () => {
    const { engine, snapshot } = await setup(),
      s = engine.state,
      snap = snapshot();
    const corridors: { tx: number; ty: number }[] = [];
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = s.tiles[y][x];
        if (
          !"dg".includes(t) &&
          !"dg".includes(s.tiles[y][C.GRID_COLS - 1 - x])
        )
          expect(t).toBe(s.tiles[y][C.GRID_COLS - 1 - x]);
        if (t === ".") {
          corridors.push({ tx: x, ty: y });
          expect(exits(s, { tx: x, ty: y }).length).toBeGreaterThanOrEqual(2);
          expect(
            s.tiles[y + 1]?.[x] === "." &&
              s.tiles[y]?.[x + 1] === "." &&
              s.tiles[y + 1]?.[x + 1] === ".",
          ).toBe(false);
        }
      }
    const ds = flood(s, s.forager.tx, s.forager.ty);
    expect(corridors.every((p) => ds[p.ty * C.GRID_COLS + p.tx] >= 0)).toBe(
      true,
    );
    const openness =
      corridors.reduce((n, p) => n + exits(s, p).length, 0) / corridors.length;
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(
      corridors.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    const twos = new Set(
      corridors
        .filter((p) => exits(s, p).length === 2)
        .map((p) => p.ty * C.GRID_COLS + p.tx),
    );
    const lengths: number[] = [];
    while (twos.size) {
      const queue = [twos.values().next().value!];
      twos.delete(queue[0]);
      for (let i = 0; i < queue.length; i++) {
        const k = queue[i],
          x = k % C.GRID_COLS,
          y = Math.floor(k / C.GRID_COLS);
        for (const n of [
          k - C.GRID_COLS,
          k + C.GRID_COLS,
          y * C.GRID_COLS + ((x + 1) % C.GRID_COLS),
          y * C.GRID_COLS + ((x + C.GRID_COLS - 1) % C.GRID_COLS),
        ])
          if (twos.delete(n)) queue.push(n);
      }
      lengths.push(queue.length);
    }
    const mean = lengths.reduce((a, b) => a + b) / lengths.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(s.tiles.join("").split("d").length - 1).toBe(12);
    expect(s.tiles.join("").split("g").length - 1).toBe(1);
    expect(snap.planktonRemaining).toBe(corridors.length);
    expect(snap.visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
  it("poses immutably and reconcile is pure, idempotent, and does not reveal fog", async () => {
    const h = await setup(),
      old = h.engine.state,
      before = h.snapshot();
    const n = h.d.setBrightness(old, 0.75);
    expect(h.snapshot()).toEqual(before);
    expect(n.visionRadius).toBe(C.VISION_MIN + C.VISION_GAIN * 0.75);
    const r = h.d.reconcile(n);
    expect(h.d.reconcile(r)).toEqual(r);
    expect(r.visibility).toEqual(old.visibility);
    expect(r.simTime).toBe(0);
    expect(r.predators.every((p) => !p.released)).toBe(true);
  });
  it("validates fixture and pose domains and permits unrestricted roster and cooldown figures", async () => {
    const h = await setup();
    expect(() => h.d.setMaze(h.engine.state, ["."])).toThrow();
    expect(() => h.d.setBrightness(h.engine.state, 2)).toThrow();
    expect(() => h.d.setPredatorMind(h.engine.state, 99, false)).toThrow();
    expect(() => h.d.setForagerTile(h.engine.state, 0, 0)).toThrow();
    fixture(h);
    for (let i = 0; i < 9; i++)
      h.apply((s) => h.d.addPredator(s, "lanternjaw", 20, 1));
    h.apply((s) => h.d.setSonarCooldown(s, 900));
    expect(h.snapshot().sonar.cooldown).toBe(900);
    expect(h.snapshot().predators).toHaveLength(9);
    h.apply((s) => h.d.reset(s));
    expect(h.snapshot().screen).toBe("title");
    expect(h.snapshot().simTime).toBe(0);
  });
});

describe("fixed-time travel and screens", () => {
  it("travels at the same speed under uneven frame deltas and stops on release", async () => {
    const a = await setup(),
      b = await setup();
    fixture(a);
    fixture(b);
    b.engine.setClock(new SequenceClock([5, 20, 25]));
    for (const h of [a, b]) {
      h.key("keydown", "ArrowRight");
      await h.engine.advance(60);
    }
    expect(a.snapshot().forager.x).toBeCloseTo(
      center(5, 8).x + C.FORAGER_SPEED,
      7,
    );
    expect(a.snapshot()).toEqual(b.snapshot());
    a.key("keyup", "ArrowRight");
    await a.engine.advance(3);
    expect(a.snapshot().forager.moving).toBe(false);
  });
  it("buffers perpendicular turns, reverses immediately, and cannot enter rock", async () => {
    const h = await setup(),
      rows = layer("#");
    for (let x = 2; x <= 10; x++) put(rows, x, 8, ".");
    for (let y = 3; y <= 8; y++) put(rows, 7, y, ".");
    fixture(h, rows);
    h.key("keydown", "ArrowRight");
    await h.engine.advance(20);
    h.key("keyup", "ArrowRight");
    h.key("keydown", "ArrowUp");
    await h.engine.advance(25);
    expect(h.snapshot().forager.dir).toBe("up");
    expect(h.snapshot().forager.x).toBeCloseTo(center(7, 8).x);
    h.key("keyup", "ArrowUp");
    h.key("keydown", "ArrowDown");
    await h.engine.advance(1);
    expect(h.snapshot().forager.dir).toBe("down");
    await h.engine.advance(120);
    expect(h.snapshot().forager.ty).toBe(8);
    expect(h.snapshot().forager.moving).toBe(false);
  });
  it("carries wrap travel across the edge with no pause or snap", async () => {
    const h = await setup();
    fixture(h);
    h.apply((s) => h.d.setForagerTile(s, 0, 0));
    h.key("keydown", "ArrowLeft");
    await h.engine.advance(15);
    expect(h.snapshot().forager.x).toBeCloseTo(center(35, 0).x, 7);
  });
  it("remembers menu choice, handles escape once, freezes pause, and restarts", async () => {
    const h = await setup();
    await h.press("ArrowDown");
    await h.press("Enter");
    expect(h.snapshot().screen).toBe("howto");
    await h.press("Escape");
    expect(h.snapshot().menuIndex).toBe(1);
    await h.press("ArrowUp");
    await h.press("Enter");
    expect(h.snapshot().screen).toBe("countdown");
    await h.engine.advance(120);
    expect(h.snapshot().screen).toBe("playing");
    await h.press("Escape");
    expect(h.snapshot().screen).toBe("paused");
    const p = h.snapshot();
    await h.engine.advance(60);
    expect(h.snapshot().predators).toEqual(p.predators);
    expect(h.snapshot().sonar).toEqual(p.sonar);
    await h.press("Escape");
    expect(h.snapshot().screen).toBe("playing");
    await h.press("KeyP");
    await h.press("ArrowDown");
    await h.press("Enter");
    expect(h.snapshot().screen).toBe("countdown");
    expect(h.snapshot().score).toBe(0);
  });
  it("requires both pointer edges in one item and supports a touch return", async () => {
    const h = await setup(),
      r0 = h.d.menuItemRect(h.engine.state, 0)!,
      r1 = h.d.menuItemRect(h.engine.state, 1)!;
    h.pointer("pointerdown", r0.x + 5, r0.y + 5);
    h.pointer("pointerup", r1.x + 5, r1.y + 5);
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("title");
    h.pointer("pointerdown", r1.x + 10, r1.y + 10, 2, "touch");
    h.pointer("pointerup", r1.x + 10, r1.y + 10, 2, "touch");
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("howto");
    h.pointer("pointerdown", 10, 10);
    h.pointer("pointerup", 10, 10);
    await h.engine.advance(1);
    expect(h.snapshot().menuIndex).toBe(1);
  });
});

describe("food, fog, sonar, ink and progression", () => {
  it("adds exact food scores and brightness then holds and halves the light", async () => {
    const h = await setup();
    fixture(h);
    h.apply((s) => h.d.setPlankton(s, 5, 8, true));
    h.apply((s) => h.d.setPlankton(s, 30, 8, true));
    await h.engine.advance(1);
    expect(h.snapshot().score).toBe(C.SCORE_PLANKTON);
    expect(h.snapshot().brightness).toBe(C.BRIGHT_PER_EAT);
    await h.engine.advance(60);
    expect(h.snapshot().brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await h.engine.advance(54);
    expect(h.snapshot().brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2, 2);
  });
  it("keeps explored memory beyond the rendering window and blocks passive light with rock", async () => {
    const h = await setup(),
      rows = layer(".");
    for (let y = 0; y < C.GRID_ROWS; y++) put(rows, 7, y, "#");
    fixture(h, rows);
    await h.engine.advance(1);
    expect(h.snapshot().visibility[8][7]).toBe("l");
    expect(h.snapshot().visibility[8][8]).toBe("u");
    h.apply((s) => h.d.setForagerTile(s, 25, 8));
    await h.engine.advance(1);
    expect(h.snapshot().visibility[8][5]).toBe("r");
    h.apply((s) => h.d.clearFog(s));
    h.apply((s) => h.d.reconcile(s));
    expect(h.snapshot().visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
  it("floods sonar around corners on arrival, marks two kinds, and never resolves amber lights", async () => {
    const h = await setup();
    fixture(h);
    h.apply((s) => h.d.setForagerTile(s, 5, 8));
    predatorAt(h, "gloamfin", 10, 8);
    predatorAt(h, "lanternjaw", 10, 9);
    h.apply((s) => h.d.setPredatorMind(s, 1, false));
    await h.press("Space");
    expect(h.snapshot().predators[0].state).toBe("wander");
    await h.engine.advance(23);
    expect(h.snapshot().predators[0].state).toBe("chase");
    expect(h.snapshot().predators[0].lit).toBe(true);
    expect(h.snapshot().predators[1].lit).toBe(false);
    expect(h.snapshot().sonar.ready).toBe(false);
    await h.engine.advance(90);
    expect(h.snapshot().sonar.ready).toBe(true);
  });
  it("ink drops visual fixes immediately but close hearing ignores it", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "lanternjaw", 8, 8);
    predatorAt(h, "flarefish", 8, 9);
    predatorAt(h, "gloamfin", 6, 8);
    await h.engine.advance(1);
    expect(h.snapshot().predators.every((p) => p.state === "chase")).toBe(true);
    await h.press("ShiftLeft");
    const ps = h.snapshot().predators;
    expect(ps[0].state).toBe("wander");
    expect(ps[1].state).toBe("wander");
    expect(ps[2].hearingLock).toBe(true);
    expect(h.snapshot().inkClouds).toHaveLength(1);
    expect(h.snapshot().ink.ready).toBe(false);
    await h.engine.advance(180);
    expect(h.snapshot().inkClouds).toHaveLength(0);
  });
  it("eats drifters for a bonus and admits them only while plankton remain", async () => {
    const h = await setup();
    h.apply((s) => h.d.clearPredators(s));
    h.apply((s) => h.d.setScreen(s, "playing"));
    h.apply((s) => h.d.spawnDrifter(s, s.forager.tx, s.forager.ty));
    h.apply((s) => h.d.setDrifterMind(s, 0, false));
    await h.engine.advance(1);
    expect(h.snapshot().score).toBe(C.SCORE_DRIFTER + C.SCORE_PLANKTON);
    h.apply((s) => h.d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.snapshot().drifters).toHaveLength(1);
    h.apply((s) => h.d.clearDrifters(s));
    h.apply((s) => h.d.clearPlankton(s));
    h.apply((s) => h.d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.snapshot().drifters).toHaveLength(0);
    expect(h.snapshot().screen).toBe("playing");
  });
  it("clears only by eating, awards the bonus, and descends with score and lives intact", async () => {
    const h = await setup();
    fixture(h);
    h.apply((s) => h.d.setPlankton(s, 5, 8, true));
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("cleared");
    expect(h.snapshot().score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await h.engine.advance(120);
    expect(h.snapshot().screen).toBe("countdown");
    expect(h.snapshot().depth).toBe(2);
    expect(h.snapshot().predators).toHaveLength(4);
    expect(h.snapshot().lives).toBe(C.START_LIVES);
  });
  it("loses exactly one reserve life, retains food and fog, then ends when reserves are empty", async () => {
    const h = await setup();
    fixture(h);
    h.apply((s) => h.d.setPlankton(s, 30, 8, true));
    predatorAt(h, "lanternjaw", 5, 8);
    await h.engine.advance(1);
    expect(h.snapshot().lives).toBe(2);
    expect(h.snapshot().screen).toBe("countdown");
    expect(h.snapshot().planktonRemaining).toBe(1);
    h.apply((s) => h.d.setScreen(s, "playing"));
    h.apply((s) => h.d.setLives(s, 0));
    h.apply((s) => h.d.clearPredators(s));
    predatorAt(
      h,
      "gloamfin",
      h.engine.state.forager.tx,
      h.engine.state.forager.ty,
    );
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("gameover");
    await h.press("Escape");
    expect(h.snapshot().score).toBe(0);
    expect(h.snapshot().screen).toBe("title");
  });
});

describe("the hunters", () => {
  it("stagger-releases by live time rather than countdown or escape from the chamber", async () => {
    const h = await setup();
    h.apply((s) => h.d.setScreen(s, "countdown"));
    for (let i = 0; i < 3; i++)
      h.apply((s) => h.d.setPredatorTravel(s, i, false));
    await h.engine.advance(120);
    expect(h.snapshot().predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await h.engine.advance(301);
    expect(h.snapshot().predators.map((p) => p.released)).toEqual([
      true,
      true,
      false,
    ]);
    h.apply((s) => h.d.setDepth(s, 20));
    expect(h.snapshot().predators.map((p) => p.kind)).toEqual([
      ...C.DEN_ORDER,
      ...C.ROSTER_ADD_ORDER,
    ]);
    expect(h.snapshot().sonar.range).toBe(C.SONAR_RANGE_MIN);
  });
  it("lets mind and travel be independently disabled and holds isolated bodies", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "flarefish", 8, 8);
    await h.engine.advance(1);
    expect(h.snapshot().predators[0].state).toBe("chase");
    expect(h.snapshot().predators[0].tx).toBe(8);
    h.apply((s) => h.d.setPredatorMind(s, 0, false));
    h.apply((s) => h.d.setForagerTile(s, 30, 8));
    await h.engine.advance(180);
    expect(h.snapshot().predators[0].state).toBe("chase");
    const rows = layer("#");
    put(rows, 5, 8, ".");
    put(rows, 30, 8, ".");
    h.apply((s) => h.d.setMaze(s, rows));
    h.apply((s) => h.d.setPredatorTile(s, 0, 5, 8));
    h.apply((s) => h.d.setPredatorMind(s, 0, true));
    h.apply((s) => h.d.setPredatorTravel(s, 0, true));
    await h.engine.advance(180);
    expect(h.snapshot().predators[0].tx).toBe(5);
    expect(h.snapshot().predators[0].ty).toBe(8);
  });
  it("chases a shortest path around a wall and drops a visual fix after linger", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "lanternjaw", 9, 8);
    h.apply((s) => h.d.setPredatorState(s, 0, "chase"));
    h.apply((s) => h.d.setPredatorTravel(s, 0, true));
    const rows = layer(".");
    for (let y = 5; y < 12; y++) put(rows, 7, y, "#");
    h.apply((s) => h.d.setMaze(s, rows));
    await h.engine.advance(20);
    expect(h.snapshot().predators[0].y).not.toBe(center(9, 8).y);
    h.apply((s) => h.d.setPredatorTravel(s, 0, false));
    await h.engine.advance(110);
    expect(h.snapshot().predators[0].state).toBe("wander");
  });
  it("keeps wandering Gloamfin speed steady and casts harmless violet pings", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "gloamfin", 25, 8);
    await h.engine.advance(241);
    expect(h.snapshot().predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(h.snapshot().pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(h.snapshot().visibility[8][25]).toBe("u");
    expect(h.snapshot().predators[0].lit).toBe(false);
  });
  it("searches an abandoned fix and emits its one orange lost-you ping", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "gloamfin", 10, 8);
    h.apply((s) => h.d.setPredatorState(s, 0, "chase"));
    h.apply((s) => h.d.setForagerTile(s, 30, 8));
    h.apply((s) => h.d.setPredatorTravel(s, 0, true));
    let orange = false,
      search = false;
    for (let i = 0; i < 180; i++) {
      await h.engine.advance(1);
      const snap = h.snapshot();
      orange ||= snap.pulses.some((p) => p.tint === "orange");
      search ||= snap.predators[0].state === "search";
    }
    expect(search).toBe(true);
    expect(orange).toBe(true);
  });
  it("charges and blooms a rock-piercing flare, then fades and rearms", async () => {
    const h = await setup();
    fixture(h);
    predatorAt(h, "flarefish", 25, 8);
    await h.engine.advance(420);
    expect(h.snapshot().predators[0].flareCharging).toBe(true);
    await h.engine.advance(30);
    expect(h.snapshot().predators[0].flaring).toBe(true);
    expect(h.snapshot().visibility[8][25]).toBe("l");
    await h.engine.advance(60);
    expect(h.snapshot().predators[0].flaring).toBe(false);
    expect(h.snapshot().visibility[8][25]).toBe("r");
  });
  it("plays exact cue names, once per tick, while muting keeps simulation live", async () => {
    const h = await setup();
    fixture(h);
    const cues: string[] = [];
    h.engine.events.on("cue:played", (e) => cues.push(e.cue));
    await h.press("KeyM");
    expect(h.snapshot().muted).toBe(true);
    h.apply((s) => h.d.setPlankton(s, 5, 8, true));
    h.apply((s) => h.d.setPlankton(s, 30, 8, true));
    await h.press("Space");
    await h.press("ShiftLeft");
    expect(cues).toEqual([C.CUES.sonar, C.CUES.eat, C.CUES.ink]);
    expect(h.snapshot().score).toBe(C.SCORE_PLANKTON);
  });
  it("a flare acquires through rock throughout its bloom and ends its own light on locking", async () => {
    const h = await setup(),
      rows = layer(".");
    for (let y = 0; y < C.GRID_ROWS; y++) put(rows, 22, y, "#");
    fixture(h, rows);
    predatorAt(h, "flarefish", 25, 8);
    await h.engine.advance(455);
    expect(h.snapshot().predators[0].flaring).toBe(true);
    h.apply((s) => h.d.setForagerTile(s, 20, 8));
    await h.engine.advance(1);
    const p = h.snapshot().predators[0];
    expect(p.state).toBe("chase");
    expect(p.alert).toBe(true);
    expect(p.flaring).toBe(false);
    expect(p.flareRadius).toBe(0);
  });
  it("a Gloamfin loses speed on corners and ramps back without changing wander speed", async () => {
    const h = await setup(),
      rows = layer("#");
    for (let x = 5; x <= 10; x++) put(rows, x, 8, ".");
    for (let y = 3; y <= 8; y++) put(rows, 5, y, ".");
    fixture(h, rows);
    h.apply((s) => h.d.setForagerTile(s, 5, 3));
    predatorAt(h, "gloamfin", 10, 8);
    h.apply((s) => h.d.setPredatorState(s, 0, "chase"));
    h.apply((s) => h.d.setPredatorDir(s, 0, "left"));
    h.apply((s) => h.d.setPredatorTravel(s, 0, true));
    let cornerSpeed = C.GLOAMFIN_CHASE_SPEED;
    for (let i = 0; i < 90; i++) {
      await h.engine.advance(1);
      const p = h.snapshot().predators[0];
      if (p.dir === "up") {
        cornerSpeed = p.speed;
        break;
      }
    }
    expect(cornerSpeed).toBeLessThan(C.FORAGER_SPEED);
    expect(cornerSpeed).toBeGreaterThanOrEqual(C.GLOAMFIN_CORNER_SPEED);
    h.apply((s) => h.d.setPredatorTravel(s, 0, false));
    await h.engine.advance(120);
    expect(h.snapshot().predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("renders every screen through the engine and exposes live diagnostics", async () => {
    const h = await setup(true);
    for (const value of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as Screen[]) {
      h.apply((s) => h.d.setScreen(s, value));
      await h.engine.advance(1);
    }
    expect(h.engine.diagnostics().every((d) => d.error === undefined)).toBe(
      true,
    );
    expect(h.engine.diagnostics()[0].value).toContain("gameover");
  });
});
