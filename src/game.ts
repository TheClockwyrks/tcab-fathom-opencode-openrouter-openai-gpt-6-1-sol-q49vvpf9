import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  ReadState,
} from "./types";
import { debug, menuItemRect, menuItems } from "./debug";
import { clone, DIRECTIONS, fresh, initial, screen } from "./world";
import { tick } from "./simulation";
import { render } from "./render";
export { BACKGROUND } from "./render";
export type * from "./types";

function confirm(s: FathomState): FathomState {
  const index = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = index ?? 0;
    if (index === 0) return fresh(s, "countdown");
    screen(s, "howto");
  } else if (s.screen === "paused") {
    if (index === 0) screen(s, "playing");
    else if (index === 1) return fresh(s, "countdown");
    else return fresh(s, "title");
  } else if (s.screen === "gameover")
    return fresh(s, index === 0 ? "countdown" : "title");
  return s;
}
function controls(s: FathomState, api: UpdateApi): FathomState {
  if (s.screen === "playing") {
    for (const d of DIRECTIONS) if (api.input.pressed(d)) s.forager.desired = d;
    if (api.input.pressed("pause")) screen(s, "paused");
    return s;
  }
  if (s.screen === "paused") {
    const pause = api.input.pressed("pause"),
      back = api.input.pressed("back");
    if (pause || back) {
      screen(s, "playing");
      return s;
    }
  }
  if (s.screen === "howto") {
    let click = false;
    for (const sample of api.input.pointerSamples()) {
      if (sample.type === "down") s.pointerDown[sample.id] = -1;
      if (sample.type === "up" && sample.id in s.pointerDown) {
        click = true;
        delete s.pointerDown[sample.id];
      }
    }
    if (api.input.pressed("confirm") || api.input.pressed("back") || click)
      return fresh(s, "title");
    return s;
  }
  const count = menuItems(s).length;
  if (!count) return s;
  if (api.input.pressed("back") && s.screen === "gameover")
    return fresh(s, "title");
  if (api.input.pressed("up"))
    s.menuIndex = ((s.menuIndex ?? 0) + count - 1) % count;
  if (api.input.pressed("down")) s.menuIndex = ((s.menuIndex ?? 0) + 1) % count;
  let clicked = false;
  for (const sample of api.input.pointerSamples()) {
    const index = menuItems(s).findIndex((_, i) => {
      const r = menuItemRect(s, i)!;
      return (
        sample.x >= r.x &&
        sample.x <= r.x + r.w &&
        sample.y >= r.y &&
        sample.y <= r.y + r.h
      );
    });
    if (index >= 0 && (sample.type === "move" || sample.type === "down"))
      s.menuIndex = index;
    if (sample.type === "down") s.pointerDown[sample.id] = index;
    if (sample.type === "up") {
      if (index >= 0 && s.pointerDown[sample.id] === index) {
        s.menuIndex = index;
        clicked = true;
      }
      delete s.pointerDown[sample.id];
    }
  }
  return api.input.pressed("confirm") || clicked ? confirm(s) : s;
}
export function update(
  state: ReadState,
  api: UpdateApi,
  dt: number,
): FathomState {
  let s = clone(state);
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const before = s.screen;
  s = controls(s, api);
  const held: Direction[] = DIRECTIONS.filter((d) => api.input.value(d) > 0);
  if (before === "playing" && s.screen === "playing") {
    if (api.input.pressed("a")) s.pending.push("sonar");
    if (api.input.pressed("b")) s.pending.push("ink");
  }
  s.accumulator += dt;
  while (s.accumulator + 1e-10 >= C.TICK_DT) {
    s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
    const cues = new Set<string>();
    s = tick(
      s,
      {
        held,
        sonar: s.pending.includes("sonar"),
        ink: s.pending.includes("ink"),
      },
      cues,
    );
    s.pending = [];
    for (const cue of cues) api.audio.play(cue);
  }
  return s;
}
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    const sounds = [
      { freq: 780, freqTo: 1100, durationMs: 65, gain: 0.08 },
      { freq: 920, freqTo: 170, durationMs: 420, gain: 0.13 },
      {
        freq: 80,
        freqTo: 35,
        durationMs: 400,
        gain: 0.22,
        wave: "triangle" as const,
      },
      { freq: 330, freqTo: 590, durationMs: 300, gain: 0.14 },
      {
        freq: 110,
        freqTo: 1400,
        durationMs: 500,
        gain: 0.12,
        wave: "triangle" as const,
      },
      {
        freq: 210,
        freqTo: 35,
        durationMs: 650,
        gain: 0.24,
        wave: "sawtooth" as const,
      },
      { freq: 260, freqTo: 1040, durationMs: 800, gain: 0.15 },
    ];
    Object.values(C.CUES).forEach((name, i) =>
      api.audio.define(name, sounds[i]),
    );
    api.diagnostics.register("Dive", (s) => `${s.screen} / depth ${s.depth}`);
    api.diagnostics.register(
      "Run",
      (s) =>
        `${s.score} points / ${s.lives} lives / ${s.planktonRemaining} motes`,
    );
    api.diagnostics.register(
      "Light",
      (s) =>
        `G ${s.brightness.toFixed(3)} V ${s.visionRadius.toFixed(1)} R ${s.windowRadius.toFixed(1)}`,
    );
    api.diagnostics.register(
      "Cooldowns",
      (s) =>
        `sonar ${s.sonar.cooldown.toFixed(2)} ink ${s.ink.cooldown.toFixed(2)}`,
    );
    api.diagnostics.register(
      "Forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`Hunter ${i + 1}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} v${p.speed.toFixed(1)} alert:${p.alert}`
          : "—";
      });
    const sheets: [string, number][] = [
      ["glimmerfin", 8],
      ["lanternjaw", 16],
      ["gloamfin", 8],
      ["flarefish", 8],
      ["drifter", 8],
      ["flare-bloom", 8],
      ["trench-walls", 19],
    ];
    const assets = Object.fromEntries(
      await Promise.all(
        sheets.map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          ),
        ]),
      ),
    );
    return [initial(assets), debug];
  },
  update,
  render,
};
