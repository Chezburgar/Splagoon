# 🦑 Splagoon

A multiplayer ink-splatting turf war in the browser, with a 3D town to hang out
in between matches. Built on three.js and a Node websocket server — **no binary
assets at all**: every texture, sound effect, character and piece of music is
generated at runtime.

```bash
npm install
npm start           # http://localhost:8080
```

Open the page, pick a name and ink colour, and you land in **Inkopolis Plaza**.
Walk into Deca Tower (or press <kbd>Enter</kbd>) to queue for a 3-minute Turf
War on one of two stages — **Tidewater Quay**, a dockyard of containers and
gantries, or **Cinder Skatepark**, a bowl of quarter pipes and half pipes.
Squads are always 4v4 with bots taking any seat a human has not, so a match
always starts — open a second tab or send a friend the URL to play together.

## Controls

| | |
|---|---|
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Move |
| Mouse | Aim (click to capture the pointer, <kbd>Esc</kbd> to release) |
| Left mouse | Shoot |
| <kbd>Shift</kbd> (hold) | Squid form — swim fast through your own ink, refill your tank, climb inked walls, and go invisible |
| <kbd>Space</kbd> | Jump |
| <kbd>Q</kbd> | Splat Bomb |
| <kbd>E</kbd> | Special (when the ring is full) |
| <kbd>Tab</kbd> | Scoreboard |
| <kbd>T</kbd> | Chat · <kbd>M</kbd> mute · <kbd>1</kbd>–<kbd>4</kbd> pick a weapon in the plaza |

## The game

**Turf War.** Three minutes, two teams of four. Only the *ground* you have inked
counts — walls, ramps and crates take ink too, but they are there to open up
routes rather than to score. The percentages in the HUD and the minimap both
read the same ink lattice the server scores at the whistle.

**Squid form is the whole game.** In your own ink you are fast, hidden, and
refilling; on enemy ink you crawl and take damage. Inked walls become ladders.
Painting your route is how you move, and painting the enemy's route is how you
stop them.

**Your spawn deck is safe ground** — it glows in your team's colour, and no
damage lands while you are standing on it, so nobody can camp your respawn.

**Four weapons**, each with its own special:

| Weapon | Feel | Special |
|---|---|---|
| Splattershot | Rapid, all-rounder | Inkstrike — a missile that spirals ink over a target area |
| Splat Roller | Crush on contact, wide ground paint while rolling | Splashdown — invulnerable slam |
| Splat Charger | Charge for a cross-map, wall-painting shot | Bubbler — 5.5s of invulnerability |
| Slosher | Arcing blobs that clear cover | Ink Storm — a rain cloud that paints an area |

## How it is put together

```
shared/     simulation shared verbatim by client and server
  world.js      collision (AABB + wedge ramps), raycasting, paint surfaces,
                the ink lattice, coverage scoring, wall-climb queries
  mapdata.js    stages, authored as boxes and ramps then mirrored
  constants.js  weapons, movement, ink economy
  protocol.js   websocket message types
server/
  index.js      static host + websocket loop (30 Hz sim, 20 Hz snapshots)
  lobby.js      the persistent plaza: presence, chat, matchmaking queue
  match.js      authoritative match: projectiles, damage, specials, scoring
  bot.js        AI that runs the same movement code as players
client/
  main.js       scene orchestration, net glue, game loop, adaptive quality
  paint.js      per-surface render targets; splats stamped in surface UV space
  localplayer.js  controller, third-person camera, weapon handling
  stage.js      stage geometry, props, sky, water, shadow-fitted lighting
  models.js     procedural inklings, squids and weapons
  fx.js / audio.js / hud.js / textures.js / remote.js / net.js
tools/        self test and browser smoke tests
```

### Ink

Every paintable face of the stage is a planar surface with its own basis. Each
one owns two things: a **render target** for what you see, and a **byte lattice**
(2.4 cells per metre) for what the game reasons about.

A splat is a sphere. `World.splat()` intersects it with nearby surfaces, and for
each one it rasterises the resulting disc into the lattice — skipping cells that
are inside solid geometry or occluded from the splat's origin, so ink does not
bleed through walls. The client feeds the *same* call's output into the paint
pass, stamping an irregular blob mask into that surface's render target in its
own UV space.

Because both sides run identical code, the server only ever broadcasts the splat
*event* (position, radius, team, seed). Coverage, "am I standing in my own ink",
the minimap and the final score all read the lattice, so what you see is exactly
what gets scored.

### Authority

The client owns its own movement — the server sanity-checks position deltas —
while the server owns everything contested: projectiles and their hits, damage,
respawns, the ink tank, specials, and turf scoring. Shots are simulated locally
for immediate feedback and authoritatively on the server; splats always come
back from the server.

### Performance

Frame time is watched and quality steps down (bloom → shadows → resolution) and
back up on its own, so the game stays responsive on weak GPUs without a settings
menu.

## Tests

```bash
npm test                          # shared simulation: collision, ink, scoring,
                                  # climbing, per-stage validation (spawns on
                                  # solid ground, ramps meeting their platforms,
                                  # bots playing without falling out), a bot
                                  # match and the full match lifecycle
npm run smoke                     # end-to-end in a real browser (playwright)
npm run smoke:multi               # two clients in one match
```

The browser tests need `npm i -D playwright && npx playwright install chromium`
and a server running. To exercise a whole match quickly:

```bash
SPLAGOON_MATCH_SECONDS=45 SPLAGOON_RESULTS_SECONDS=10 npm start
SPLAGOON_STAGE=park npm start     # pin the stage instead of rotating
```

## Notes

Splagoon is an original homage to the ink-and-squid genre — it shares no assets,
code or artwork with any commercial game.
