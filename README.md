# Fathom

**A small light. An endless dark.**

Fathom is a bioluminescent deep-sea maze chase. Graze every plankton mote,
outswim three hunters, and descend into increasingly crowded water. In this
**Kindle** dive, explored passages stay remembered, but you can only see them
through a circular window that grows as you eat. A brighter glow helps you find
your way—and helps the light-hunters find you.

## Play locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. The game runs entirely in your browser, with
keyboard, mouse menus, and automatic touchscreen controls. No account or network
service is needed.

## Controls

| Control | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held; buffer your next turn |
| Space | Sonar: reveal passages and mark hunters |
| Shift | Ink: break the light-hunters' sight |
| Escape / P | Pause or resume |
| M | Toggle sound |
| Up / Down, Enter / Space | Select and confirm menu items |
| Escape | Return from the field guide or game-over screen |
| Mouse / touch | Select and activate menus |
| Backtick | Toggle the engine's diagnostic overlay |

Sonar recharges in 1.5 seconds; ink recharges in 8. The amber Lanternjaw hunts
light and disguises itself as a harmless drifter. The violet Gloamfin hunts
sound, including your sonar. The Flarefish lights the rock with a sweeping bloom.
Ink blinds the two light-hunters, but cannot silence you. Eat all the motes to
clear a maze. Your three reserve lives buy three more attempts.

## Production build

```sh
npm ci
npm run build
npm run preview
```

Deploy the contents of `dist/` to any static host. `dist/index.html` is the entry
point. Assets and scripts use page-relative URLs, so the same output works at a
domain root or under a sub-path. Keep the emitted `assets/` tree beside the page.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests use the Simple 2D engine with an in-process canvas and counted clocks. They
cover maze invariants, fixed-tick consistency, movement and wrapping, menu input,
fog, food, progression, predator senses, sonar, ink, releases, and synthesized cue
events. Coverage and test results are written to `coverage/`.

## Source map

- `src/game.ts`: engine registration, input, and the frame accumulator; exports
  the game, state types, and debug API contract.
- `src/world.ts`: maze, continuous grid movement, pathfinding, and state values.
- `src/simulation.ts`: the render-free 120 Hz dive simulation.
- `src/debug.ts`: immutable scenario poses and JSON snapshots, available through
  `engine.debug` to callers holding the engine.
- `src/render.ts`: canvas screens, sprites, lighting, and HUD.
- `src/types.ts`: state and instrumentation types.
- `showcase/`: player-facing description, screenshots, and a captured engine replay.

The engine owns the frame loop, canvas fit, input actions, asset loading, audio,
and debug overlay. All gameplay state belongs to the game state value. Rendering
is read-only; updates and debug poses build new values.
