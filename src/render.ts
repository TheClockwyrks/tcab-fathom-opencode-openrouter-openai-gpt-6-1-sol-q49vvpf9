import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, ReadState } from "./types";
import { menuItemRect, menuItems } from "./debug";
import { center, DIRECTIONS, neighbor, open, tile } from "./world";
import { distance, lineOfSight } from "./simulation";

export const BACKGROUND = "#03060c";
const P = {
  cyan: "#80f5df",
  white: "#e0eee7",
  dim: "#6a9293",
  line: "#193738",
  amber: "#ff9874",
  violet: "#b999ff",
};
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Context = RenderApi["ctx"];
function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 14,
  color = P.dim,
  align: CanvasTextAlign = "left",
  weight = 400,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size: number,
  tracking: number,
  color: string,
): void {
  ctx.font = `500 ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  for (const char of value) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + tracking;
  }
}
function line(
  ctx: Context,
  x: number,
  y: number,
  ex: number,
  ey: number,
  color = P.line,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
}
function circle(
  ctx: Context,
  x: number,
  y: number,
  r: number,
  color: string,
  width = 1,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function glow(
  ctx: Context,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function sprite(
  ctx: Context,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const img = s.assets[sheet]?.[frame];
  if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}
const facing: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
function amber(ctx: Context, x: number, y: number): void {
  glow(ctx, x, y, 21, "#f87d413c");
  ctx.shadowColor = "#ff7953";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#ffae80";
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.shadowBlur = 0;
}
function surround(ctx: Context, s: ReadState): void {
  line(ctx, 64, 78, 1216, 78);
  line(ctx, 64, 658, 1216, 658);
  for (let y = 96; y < 656; y += 32) {
    line(ctx, 48, y, y % 96 === 0 ? 58 : 53, y);
    line(ctx, 1227, y, 1232, y);
  }
  text(ctx, String(s.depth).padStart(2, "0"), 25, 369, 10);
}
function terrain(ctx: Context, s: ReadState): void {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const v = s.visibility[y][x];
      if (v === "u") continue;
      const t = tile(s, x, y),
        p = center(x, y);
      let frame = 16;
      if (t === "#")
        frame =
          (tile(s, x, y - 1) === "#" ? 1 : 0) +
          (tile(s, x + 1, y) === "#" ? 2 : 0) +
          (tile(s, x, y + 1) === "#" ? 4 : 0) +
          (tile(s, x - 1, y) === "#" ? 8 : 0);
      else if (t === "g") frame = 18;
      ctx.globalAlpha = v === "l" ? 1 : 0.24;
      sprite(ctx, s, "trench-walls", frame, p.x, p.y);
      if (s.plankton[y][x] === "*") {
        ctx.fillStyle = "#9cebd7";
        ctx.shadowColor = P.cyan;
        ctx.shadowBlur = v === "l" ? 9 : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function maze(ctx: Context, s: ReadState): void {
  surround(ctx, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  const fog = s.assets["trench-walls"]?.[17];
  if (fog) {
    const pattern = ctx.createPattern(fog, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(
        C.GRID_ORIGIN_X,
        C.GRID_ORIGIN_Y,
        C.GRID_COLS * C.TILE,
        C.GRID_ROWS * C.TILE,
      );
    }
  }
  // Terrain is visible through the Kindle window and through every active flare.
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  for (const p of s.predators)
    if (p.flaring && p.state !== "den") {
      ctx.moveTo(p.x + C.FLARE_RADIUS, p.y);
      ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
    }
  ctx.clip();
  terrain(ctx, s);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#42e4cd12");
  for (const d of s.drifters) amber(ctx, d.x, d.y);
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") amber(ctx, p.x, p.y);
  ctx.restore();
  for (const cloud of s.inkClouds) {
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.5,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000108f5");
    g.addColorStop(1, "#00010800");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, cloud.x, cloud.y, cloud.radius * 0.9, "#39445c44");
  }
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      const passive =
        distance(s.forager, center(p.tx, p.ty)) <= s.visionRadius &&
        lineOfSight(s, s.forager, center(p.tx, p.ty), true);
      const inFlare = s.predators.some(
        (f) => f.flaring && distance(f, p) <= C.FLARE_RADIUS,
      );
      if (p.markLeft > 0 && !passive && !inFlare && !p.alert)
        ctx.globalAlpha = Math.min(1, p.markLeft / C.SONAR_MARK_TIME);
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.simTime * 8) % 8)
          : facing[p.dir] +
            (p.mind && p.travel ? Math.floor(s.simTime * 7) % 2 : 0);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const progress = 1 - p.alertLeft / C.ALERT_TIME,
        tint = p.kind === "gloamfin" ? P.violet : P.amber;
      ctx.globalAlpha = 1 - progress;
      circle(ctx, p.x, p.y, 18 + progress * 42, tint, 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * 24,
          p.y + Math.sin(a) * 24,
          p.x + Math.cos(a) * (32 + progress * 22),
          p.y + Math.sin(a) * (32 + progress * 22),
          tint,
        );
      }
      ctx.globalAlpha = 1;
    }
    if (p.flareCharging || p.flaring || p.flareFade > 0) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((p.flarePhase / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 + Math.min(2, Math.floor((p.flarePhase / C.FLARE_BLOOM) * 3))
          : p.flareFade > 0.2
            ? 6
            : 7;
      sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
    }
  }
  for (const pulse of s.pulses) {
    const tint =
      pulse.tint === "cyan"
        ? P.cyan
        : pulse.tint === "orange"
          ? P.amber
          : P.violet;
    ctx.shadowBlur = 15;
    ctx.shadowColor = tint;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = pulse.distances[y * C.GRID_COLS + x];
        if (d < 0 || d > pulse.range || Math.abs(d - pulse.front) > 0.85)
          continue;
        const c = center(x, y);
        ctx.globalAlpha = Math.max(0, 1 - Math.abs(d - pulse.front));
        ctx.strokeStyle = tint;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const dir of DIRECTIONS) {
          const [nx, ny] = neighbor(s, x, y, dir);
          if (!open(s, nx, ny)) continue;
          const next = center(nx, ny);
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(
            c.x + (Math.sign(next.x - c.x) * C.TILE) / 2,
            c.y + (Math.sign(next.y - c.y) * C.TILE) / 2,
          );
        }
        ctx.stroke();
      }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  glow(ctx, s.forager.x, s.forager.y, 42 + s.brightness * 10, "#71fce44a");
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing[s.forager.dir] +
      (s.forager.moving ? Math.floor(s.simTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
}
function gauge(
  ctx: Context,
  x: number,
  label: string,
  key: string,
  ratio: number,
): void {
  text(ctx, key, x, 691, 12, P.cyan);
  text(ctx, label, x + 55, 691, 12, ratio >= 1 ? P.white : P.dim);
  const bx = x + 135;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i / 12 < ratio ? P.cyan : "#173333";
    ctx.fillRect(bx + i * 7, 681, 4, 12);
  }
}
function hud(ctx: Context, s: ReadState): void {
  text(ctx, C.TITLE_TEXT, 64, 38, 18, P.white, "left", 700);
  tracked(ctx, C.DIVE_LABEL, 65, 60, 10, 3, P.dim);
  text(ctx, String(s.score).padStart(6, "0"), 640, 59, 48, P.white, "center");
  text(
    ctx,
    `${s.planktonRemaining} MOTES REMAIN`,
    1216,
    36,
    12,
    P.dim,
    "right",
  );
  text(
    ctx,
    s.muted ? "M  SOUND OFF" : "M  SOUND ON",
    1216,
    58,
    10,
    P.dim,
    "right",
  );
  text(ctx, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 691, 16, P.white);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 247 + i * 26, 686, 24);
  gauge(ctx, 417, "SONAR", "SPACE", 1 - s.sonar.cooldown / C.SONAR_COOLDOWN);
  gauge(ctx, 735, "INK", "SHIFT", 1 - s.ink.cooldown / C.INK_COOLDOWN);
  text(ctx, "ESC  PAUSE", 1216, 691, 12, P.dim, "right");
}
function menus(ctx: Context, s: ReadState): void {
  menuItems(s).forEach((item, i) => {
    const r = menuItemRect(s, i)!;
    const selected = i === s.menuIndex;
    ctx.fillStyle = selected ? "#102b2c" : "#071317";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#5ed8bf" : "#193335";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = P.cyan;
      ctx.fillRect(r.x, r.y, 3, r.h);
    }
    text(
      ctx,
      String(i + 1).padStart(2, "0"),
      r.x + 20,
      r.y + 33,
      11,
      selected ? P.cyan : P.dim,
    );
    text(ctx, item, r.x + 61, r.y + 34, 17, selected ? P.white : P.dim);
    if (selected) text(ctx, "→", r.x + r.w - 24, r.y + 34, 20, P.cyan, "right");
  });
}
function title(ctx: Context, s: ReadState): void {
  glow(ctx, 926, 351, 390, "#16484638");
  // A bathymetric, instrument-like chart gives the title a distinct abyssal identity.
  ctx.save();
  ctx.beginPath();
  ctx.rect(640, 80, 576, 555);
  ctx.clip();
  const cx = 927,
    cy = 346;
  for (let i = 0; i < 7; i++) {
    const r = 45 + i * 35;
    ctx.beginPath();
    for (let a = 0; a <= 160; a++) {
      const angle = (a / 160) * Math.PI * 2,
        radius =
          r + Math.sin(angle * 3 + i * 0.8) * 9 + Math.cos(angle * 5) * 4;
      const x = cx + Math.cos(angle) * radius,
        y = cy + Math.sin(angle) * radius * 0.9;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = i === 4 ? "#2d7065" : "#173a3b";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  line(ctx, 660, cy, 1190, cy, "#163334");
  line(ctx, cx, 95, cx, 610, "#163334");
  ctx.setLineDash([2, 8]);
  circle(ctx, cx, cy, 182, "#468c794f");
  ctx.setLineDash([]);
  glow(ctx, cx, cy, 100, "#56ebc834");
  sprite(ctx, s, "glimmerfin", 6, cx, cy, 96);
  amber(ctx, 1091, 237);
  circle(ctx, 1091, 237, 14, "#8b5c4544");
  text(ctx, "UNKNOWN SIGNAL", 1005, 198, 10, "#b78366");
  line(ctx, 1091, 207, 1091, 218, "#77513d");
  text(ctx, "YOU ARE THE LIGHT.", 927, 517, 12, P.cyan, "center");
  text(ctx, "YOU ARE THE LURE.", 927, 540, 12, P.dim, "center");
  ctx.restore();
  text(ctx, "F /", 64, 54, 17, P.cyan);
  text(ctx, "ABYSSAL FIELD NOTES", 110, 54, 11);
  text(ctx, "01 — THE KINDLE DIVE", 1216, 54, 11, P.dim, "right");
  line(ctx, 64, 76, 1216, 76);
  tracked(ctx, C.TAGLINE_TEXT, 130, 189, 12, 4, P.cyan);
  tracked(ctx, C.TITLE_TEXT, 120, 290, 91, 3, P.white);
  text(ctx, "A small light. An endless dark.", 130, 340, 17, "#9db8b1");
  text(ctx, "Feed your glow. Mind what follows.", 130, 368, 14, P.dim);
  menus(ctx, s);
  text(ctx, "↑ ↓  SELECT    ENTER  CONFIRM", 130, 593, 10);
  line(ctx, 64, 650, 1216, 650);
  text(ctx, "36 × 18  /  UNCHARTED WATER", 64, 683, 10);
  text(ctx, "LIGHT TRAVELS. SOUND FOLLOWS.", 640, 683, 10, P.dim, "center");
  text(
    ctx,
    s.muted ? "M  SOUND OFF" : "M  SOUND ON",
    1216,
    683,
    10,
    P.dim,
    "right",
  );
}
function howto(ctx: Context, s: ReadState): void {
  text(ctx, "F /  FIELD GUIDE", 80, 60, 13, P.cyan);
  line(ctx, 80, 82, 1200, 82);
  tracked(ctx, "LEARN THE DARK", 80, 151, 36, 2, P.white);
  text(
    ctx,
    "Eat every mote. Descend deeper. Keep a little light alive.",
    80,
    191,
    15,
  );
  const cards = [
    {
      sheet: "lanternjaw",
      title: "01  LANTERNJAW",
      sub: "HUNTS YOUR LIGHT",
      copy: [
        "An amber glow may be food.",
        "Or a mouth waiting beneath it.",
        "Ink breaks its line of sight.",
      ],
      color: P.amber,
    },
    {
      sheet: "gloamfin",
      title: "02  GLOAMFIN",
      sub: "HUNTS YOUR SOUND",
      copy: [
        "Your sonar tells it where you are.",
        "Its violet ping listens back.",
        "Turn corners. It loses speed.",
      ],
      color: P.violet,
    },
    {
      sheet: "flarefish",
      title: "03  FLAREFISH",
      sub: "HUNTS IN A FLASH",
      copy: [
        "A warm charge warns of a flare.",
        "The bloom sees through rock.",
        "Hide in ink before it finds you.",
      ],
      color: P.amber,
    },
  ];
  cards.forEach((card, i) => {
    const x = 80 + i * 380;
    ctx.fillStyle = "#08171c";
    ctx.fillRect(x, 233, 356, 249);
    line(ctx, x, 233, x + 356, 233, "#2b5452");
    sprite(ctx, s, card.sheet, 6, x + 44, 280, 48);
    text(ctx, card.title, x + 80, 276, 14, P.white);
    text(ctx, card.sub, x + 80, 299, 10, card.color);
    card.copy.forEach((v, j) =>
      text(ctx, v, x + 22, 354 + j * 26, 13, "#9db8b1"),
    );
  });
  text(ctx, "ARROWS / WASD", 80, 530, 13, P.cyan);
  text(ctx, "Swim while held", 80, 555, 12);
  text(ctx, "SPACE", 390, 530, 13, P.cyan);
  text(ctx, "Sonar: map the passages", 390, 555, 12);
  text(ctx, "SHIFT", 710, 530, 13, P.cyan);
  text(ctx, "Ink: blind light-hunters", 710, 555, 12);
  text(ctx, "ESC / P    Pause      M    Sound", 80, 600, 12);
  text(
    ctx,
    "Your glow reveals nearby rock. Sonar remembers the way.",
    80,
    628,
    12,
  );
  text(
    ctx,
    "Eat to widen your window — and become easier to find.",
    80,
    652,
    12,
  );
  text(ctx, "ENTER / ESC / TAP TO RETURN  ↵", 1200, 690, 12, P.cyan, "right");
}
export function render(s: ReadState, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen !== "gameover") {
    maze(ctx, s);
    hud(ctx, s);
  }
  if (s.screen === "playing") return;
  if (s.screen === "countdown" || s.screen === "cleared") {
    ctx.fillStyle = "#030b10b8";
    ctx.fillRect(400, 262, 480, 166);
    text(
      ctx,
      s.screen === "countdown" ? "DESCENDING" : "THE WATER FALLS QUIET",
      640,
      297,
      11,
      P.cyan,
      "center",
    );
    text(
      ctx,
      s.screen === "countdown"
        ? `${C.TITLE_ITEMS[0]}  ${Math.max(1, Math.ceil(s.screenLeft))}`
        : `DEPTH ${s.depth} CLEARED`,
      640,
      351,
      32,
      P.white,
      "center",
    );
    text(
      ctx,
      s.screen === "countdown"
        ? "Find the light. Leave no trace."
        : `+${C.SCORE_CLEAR}  /  DEEPER AWAITS`,
      640,
      389,
      12,
      P.dim,
      "center",
    );
    return;
  }
  ctx.fillStyle = "#030b10df";
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  glow(ctx, 640, 280, 310, "#164c4324");
  text(
    ctx,
    s.screen === "paused" ? "HOLD YOUR BREATH" : "YOUR LIGHT GOES OUT",
    640,
    204,
    11,
    P.cyan,
    "center",
  );
  text(
    ctx,
    s.screen === "paused" ? "PAUSED" : "DIVE ENDED",
    640,
    269,
    48,
    P.white,
    "center",
  );
  text(
    ctx,
    s.screen === "paused"
      ? `DEPTH ${s.depth}  /  ${s.planktonRemaining} MOTES TO GO`
      : `SCORE ${String(s.score).padStart(6, "0")}   /   DEPTH ${s.depth}`,
    640,
    312,
    14,
    P.dim,
    "center",
  );
  menus(ctx, s);
  text(ctx, "↑ ↓  SELECT    ENTER  CONFIRM", 640, 615, 11, P.dim, "center");
}
