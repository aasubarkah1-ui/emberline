# Emberline — a tactical three.js FPS

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/aasubarkah1-ui/emberline/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/aasubarkah1-ui/emberline/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

Round-based tactical FPS in the style Counter-Strike made famous, built
originally for the make.fun `threejs-fps-01` bounty: two teams, short rounds
won by elimination or by the spike objective, money between rounds, and
gunfire where stopping to aim pays.

## The game

You are Ember, attacking the Foundry Yard against four Ash defenders (plus
two Ember allies). Plant the spike at **Furnace (Site A)** or **Crane Dock
(Site B)** — hold **E** on a site ring — or clear every defender. Defenders
win by stopping you, defusing a planted spike, or running the clock out.
First team to 5 rounds takes the match.

- **Weapons:** Heron-9 pistol, Kestrel-5 rifle, Swift-9 SMG — buy with **B**
  during freeze time ($800 start, +$300 per kill, +$1000 round win).
  **G** throws a frag grenade; **R** reloads; **1/2/3** switch weapons.
- **Gunplay:** hitscan with body/head hitboxes (headshots ×2), recoil and
  spread that punish firing on the move, crouch (**Ctrl**) to steady aim,
  **Shift** to walk slow and quiet.
- **Bots:** defenders patrol routes between the sites, hold angles, and react
  to what they see (vision cone + line of sight) and hear (gunfire, the
  plant). They shoot in bursts and can miss — and they converge on a
  planted spike to defuse it.
- **Map:** the Foundry Yard — two lanes, flank crates, furnace hall and
  crane dock, with a dusk-foundry palette and ember lighting. All geometry
  is original, built from styled boxes; no copied map, art or names.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock the pointer) |
| Click | Fire |
| R | Reload |
| 1 / 2 / 3 | Pistol / rifle / SMG |
| G | Throw grenade |
| E (hold) | Plant the spike on a site |
| B | Buy menu (freeze time only) |
| Ctrl | Crouch |
| Shift | Walk slow |

## Run it

```sh
node serve.ts        # http://localhost:8080
```

No build step, no network requests: `game/` is static ES modules with
three.js 0.187.0 vendored under `game/vendor/three/`.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## Tech notes

- Fixed-step simulation (60 Hz) kept apart from rendering; one shared
  state object (`game/src/state.js`); reusable vectors in the hot loop.
- Modules: `main.js` (bootstrap/render), `state.js`, `world.js` (map +
  collision), `player.js`, `bots.js` (AI), `weapons.js`, `rounds.js`
  (economy + bomb), `hud.js`, `audio.js` (synthesised, no audio files).
- Screenshots are real renders of this code, staged with
  `?shot=start|play|end` (deterministic seed).

## License

MIT — see `LICENSE`.
