# AI City: The Living World

A browser city-management game. You govern a small futuristic city whose citizens make their own decisions; you shape outcomes through construction, economic decisions, policy and how you answer their petitions.

## How to play

- **Stay in office.** Every 7 days citizens vote. Your approval rating (top bar, and itemised in the **Mayor** tab) must be above the threshold for your difficulty (Relaxed 30%, Standard 40%, Hard 50%). Losing ends the game; you can then start again or keep playing in sandbox mode.
- **Answer petitions.** When specific conditions arise, citizens bring you a decision with clear costs: bail out a failing business, buy emergency power during blackouts, sponsor a weekend festival, open cooling centers in a heatwave, cut taxes, or promise a park (and keep the promise). The game pauses until you answer (toggle under the event log); unanswered petitions apply their default when they expire.
- **Grow the city.** Eleven milestones pay regional grants and raise the city's rank (Settlement → Town → City → Metropolis). Town rank unlocks the School.
- **Read the morning paper.** *The Morning Circuit* arrives every day at 06:00 with the biggest news, key figures with daily change, a citizen spotlight and the weather forecast.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit + simulation tests
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the production build
```

## Controls

| Input | Action |
| --- | --- |
| Left click | Inspect citizen/building, or apply the current tool |
| Left drag | Pan (inspect tool) · paint roads / demolish (road & demolish tools) |
| Right/middle drag, wheel | Pan, zoom |
| `Space` | Pause / resume |
| `1`–`4` | Speed 1x / 2x / 4x / 8x |
| `V` `R` `B` `Esc` | Inspect, road, demolish, cancel tool |
| `O` | Cycle map view: normal, pollution, service coverage, happiness by home |

## Architecture

```
src/sim/        Pure TypeScript simulation (no DOM, React or Phaser)
  types.ts        World state and entity interfaces (plain JSON)
  constants.ts    Balance values (1 tick = 5 in-game minutes)
  rng.ts          Seeded mulberry32; state stored in the world
  clock.ts        Fixed-timestep accumulator (pause, speed, catch-up cap)
  map.ts          Tiles, footprints, entrances
  navigation.ts   Weighted Dijkstra (roads 1 tick/tile, open ground 3)
  buildings.ts    Building catalogue and queries
  construction.ts Placement, roads, demolition (validated, atomic)
  needs.ts        Need decay and itemised happiness model
  decision.ts     Utility-based action selection with recorded reasoning
  activities.ts   idle → traveling → performing state machine
  citizens.ts     Creation, goals, memories, relationships, hiring
  economy.ts      Ledgered money transfers, wages, retail, supply chain
  power.ts        Generation and priority-based distribution
  events.ts       Causal event detectors (each event lists its causes)
  population.ts   Immigration / emigration
  policies.ts     Taxes, benefits, conservation, subsidies
  weather.ts      Seeded weather fronts with a forecast (solar output, demand, mood)
  environment.ts  Pollution, service coverage (park/clinic/school) and commutes
  approval.ts     Itemised mayor approval, difficulty settings and elections
  milestones.ts   Objectives, grants, city rank and building unlocks
  petitions.ts    Condition-triggered decisions with costs, defaults and expiry
  effects.ts      Timed effects (festival, power imports, cooling, promises)
  bulletin.ts     The daily newspaper built from the last 24 hours
  engine.ts       One-tick orchestration (hourly and daily phases)
  persistence.ts  Versioned save format with validation
src/game/       GameController (loop, commands, persistence) + Phaser CityScene
src/ui/         React panels (top bar, toolbar, inspector, stats, policies, event log)
tests/          Vitest suites
```

The simulation advances only through `stepWorld(world)`; the controller converts real time into ticks with `FixedStepClock`, so simulation speed is independent of frame rate. The renderer interpolates citizen movement between ticks.

### Key rules

- **Money is conserved.** Every credit moves through `transfer()`, which refuses overdrafts. Only the outside world account may go negative, so citizens, businesses and the treasury can never go below zero.
- **Citizens decide by utility.** Scores combine needs, personality, goals, money, time of day, travel time and friendships. The inspector shows the chosen action, its reasons and the runner-up scores.
- **Events need causes.** Shortages, closures, protests, complaints, unemployment and migration fire only from explicit state conditions (with hysteresis/streaks) and record the triggering values.
- **The week has a rhythm.** Day 1 is a Monday. Offices and fabricators close at weekends; shops, services and the power plant keep working, and citizens shop and socialise more.
- **Neighbourhoods matter.** Homes near running factories breathe polluted air (mood and slow health loss); parks clean the air; nearby parks, a staffed clinic and a school raise mood; long commutes lower it. Residents near a school gain skills and earn raises.
- **Living costs.** Residents pay rent and a daily utilities bill; wealthier citizens spend more on luxuries.
- **No one gets stuck.** Unreachable targets are never chosen, paths are re-planned when the map changes, trips have a time limit, and citizens on newly built tiles are moved out.

## Saves

Saved to `localStorage` (`ai-city:save:slot1`) as `{ format, version, savedAt, world }`. The current format is version 2; version 1 saves are migrated automatically (`MIGRATIONS` in `persistence.ts`). Loading validates the whole structure (ids, references, ranges, capacities, overlaps, petitions, effects) and leaves the running game untouched if anything is wrong.

In development builds the controller is exposed as `window.__city` for debugging.
