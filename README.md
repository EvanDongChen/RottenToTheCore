# Rotten to the Core

Eight fruits with stick legs do chores in a white-walled lab. One of them is Rotten, and slices the others when nobody is looking. Nobody plays: you watch, read their minds, and see the meetings fall apart.

![A game in progress](docs/demo.gif)

It's a spectator sim in the style of Among Us, built on the fruits, wobble physics and faces from [One Bad Apple](https://github.com/EvanDongChen/OneBadApple). Underneath is a deterministic tick engine that runs the same in the browser and headless in Node, three swappable brains (heuristic, Bayesian, LLM), and benchmarks over thousands of seeded games.

## What you're watching

- **Roaming.** Crew walk to their task stations; the Rotten fake tasks, stalk, strike when it's safe, then vent or hurry away and build an alibi. Fruits gossip when they pass in hallways and chat while they work, so each one walks into a meeting knowing something different.
- **Memory.** Every fruit remembers only what it actually saw or was told. Memories fade, and the first time a faded one is recalled it may bend: the wrong room, the wrong time, or a lookalike fruit (lemon for banana, cherry for strawberry). Rumours bend again when they're passed on.
- **Meetings.** The reporter speaks first, then everyone says where they were, then the floor opens. Every alibi is checked by every listener against its own memory, so fruits corroborate, contradict, or ask awkward questions. An honest fruit with a bent memory can get an innocent juiced.
- **The Juicer.** The ejected fruit gets last words, two others carry it to the Juicer, *SPLORT*, and the glass fills.

Pick a fruit to open its mind: its thought, who it suspects, its tasks, and its **memory reel** (fading memories go pale; bent ones are striped, with what really happened).

## Running it

```
npm install
npm run dev        # the game, at http://localhost:5173/RottenToTheCore/
npm test           # Vitest
npm run sim -- --games 1000 --crew bayesian --rotten heuristic
npm run sim -- --games 5000 --matrix && npm run report   # every brain against every brain, into RESULTS.md
```

A game without the LLM brain is fully decided by its seed, rules, roster and brains, so it can be shared as a link (`?seed=42&crew=bayesian&rotten=heuristic`) and plays out the same every time. The recap at the end has a **Watch the replay** button with a scrubber, and `npm run sim -- --games 1 --seed 42 --log game.jsonl` writes an event log you can load on the setup screen; the replay says whether it matched the log exactly.

### The LLM brain

Pick **LLM** on the setup screen and paste a Gemini API key (it stays in your browser). Gemini speaks and votes in meetings and words the roaming chats; roaming itself stays rule-based. For headless runs:

```
GEMINI_API_KEY=... npm run sim -- --games 100 --crew llm --rotten heuristic
npm run report
```

Replies are cached by a hash of the prompt (`results/llm-cache.json`), so re-running the same seeds costs nothing.

## Results

Every matchup below plays the same seeds. Full tables, including memory and pacing numbers, are in [RESULTS.md](RESULTS.md).

2,000 seeded games per matchup:

| Matchup | Games | Crew win | Rotten win | Draw | By tasks | By ejection | By kills |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bayesian crew vs bayesian Rotten | 2000 | 68.4% | 30.0% | 1.6% | 0.8% | 67.6% | 30.0% |
| bayesian crew vs heuristic Rotten | 2000 | 78.9% | 19.4% | 1.8% | 0.8% | 78.1% | 19.4% |
| heuristic crew vs bayesian Rotten | 2000 | 50.0% | 48.9% | 1.2% | 1.5% | 48.5% | 48.9% |
| heuristic crew vs heuristic Rotten | 2000 | 55.4% | 43.1% | 1.6% | 1.6% | 53.7% | 43.1% |

The Bayesian crew win about 24 points more often than the heuristic crew against the same Rotten. They vote more often and act on the endgame, so they also eject more crew by mistake: their ejections are less accurate, but far fewer games run out of time. The thinking Bayesian Rotten wins about 11 points more than the heuristic one against Bayesian crew (30% against 19%), and 6 more against heuristic crew. Most of that comes from faking tasks for exactly as long as they take, since a fruit seen lingering at a station was the third most common reason crew voted for the Rotten.

### Calibration

`npm run calibrate -- --games 1000` plays Bayesian crew games and records every crew fruit's P(Rotten) for every other fruit at every vote, next to the truth. It fits each clue's likelihood ratio from how often that clue points at a Rotten rather than crew (shrunk toward 1, since clues come in bunches), plays the same games again with the fitted table, and saves it (`--write`) only if it scores better. The fitted table brought the Brier score from 0.1076 to 0.1065 (always guessing the base rate scores 0.162), and mostly fixed the hand-picked table's underconfidence in the middle:

![Reliability: what the brain said against how often it was right](docs/calibration.svg)

## How it's built

```
src/sim/        the whole game, pure TypeScript: no three, React, Rapier or Zustand
  engine.ts       tick loop (10 per sim second), phases, win check
  actions.ts      walking, tasks, kills, vents, reports, sabotage
  perception.ts   who sees whom each tick: vision radius, walls, lights, cameras
  witness.ts      what each fruit sees, turned into memories
  memory.ts       sightings, fading, bending
  encounters.ts   hallway passes, task-side chats, rumours, whispers
  claims.ts       checking what someone says against what you remember
  meeting.ts      discussion turns, votes, ejection
  rotten.ts       the Rotten's plan: blend, stalk, strike, escape, alibi
  view.ts         viewFor(fruit): the only door to what a brain may know
  brains/         heuristic, bayesian, llm, and the shared roaming and speech
src/ui/         the bridge to the screen (Zustand), sounds, replays
src/components/ the 3D lab, fruits, ghosts, camera director, HUD
src/headless/   the CLI and the results report
```

**The sim owns position.** Each fruit has a logical position on the nav graph, moved every tick by the sim; the 3D fruit chases it with springs, so physics adds the wobble but never decides where a fruit is. That's what lets the same code run headless and stay deterministic.

**Brains only see a view.** A brain is handed `viewFor(fruit)`: its own memory (with bending applied and no sign of it), tasks, what it can see right now, and the public meeting log. A test checks that no crew view ever holds anyone else's role. Every brain must return something legal; the engine repairs it rather than throw.

**Both crew brains** reason from the same clues (`brains/reasoning.ts`):
- **When each victim died.** The window runs from when it was last known alive (seen, voting, or named in a trusted alibi) to when it was found. Who could have walked there in that window?
- **Trust.** Being caught lying, changing a story, accusing fruits that turned out crew, or defending one that turned out Rotten all cost a fruit its credibility. Alibis its own eyes confirmed earn it back.
- **Stories that must hold up.** Every alibi said in any meeting is public. Two for the same stretch of time that name different places get called out, and count heavily.
- **The endgame.** When a skip or a wrong ejection plus one more kill would lose the game, the crew vote for their best guess.

**Meetings argue.** A fruit defending itself names a witness ("Ask Kiwi"), who then backs the story up or says it saw otherwise. The Bayesian brain asks pointed questions ("Where were you at 1:20?") about the moment the victim most likely died, choosing the fruit whose answer would tell it most.

**The heuristic brain** adds its clues up, weighted by personality. Suspicious fruits read more into everything, the gullible believe what they hear, and the stubborn don't. Grudge-holders never forget who accused them. Only bold fruits vote on a hunch in the endgame.

**The Bayesian brain** keeps P(Rotten) for every other fruit from a likelihood table fitted from games. It weighs hearsay as either honest or a Rotten's lie, depending on how likely the teller is to be Rotten. With two Rotten it scores every pair, so two fruits covering for each other stand out. It roams to learn, keeping an eye on whoever it is least sure about. As Rotten, it tracks who probably suspects it:
- it kills witnesses and accusers, and keeps scapegoats alive
- it fakes tasks for exactly as long as they take, then moves on
- after a kill it goes looking for company to be seen with
- it picks alibis nobody it saw could contradict, and never leans on its partner
- when it reports its own kill, it frames a crew fruit it really saw near the body, so others' memories back the story up
- if someone saw it strike, it gets in first and claims that fruit did the killing, and it turns a witness's accusation straight back on them

**Personalities** are set per fruit on the setup screen, as in One Bad Apple:
- an archetype to start from (Detective, Paranoid, Sheep, Loudmouth, Hothead, Wallflower, Contrarian)
- five sliders
- a temper
- quirks, dragged on as chips or written yourself
- a backstory
- a Rotten playstyle: aggressive, patient, framer or saboteur

They change how a fruit reasons, votes, strikes and talks.

**The LLM brain** is measured, not trusted: calls, tokens, dollars, latency, illegal replies repaired, and hallucinated claims (a crew fruit claiming to have seen something that isn't in its own memory, checked in code).

## Notes on balance

The plan's starting defaults are all in one `Rules` object on the setup screen. Two were changed after measuring 2,000 heuristic-vs-heuristic games: the kill cooldown is 20 s (was 25), and **ghosts don't finish tasks** by default (it's a toggle). With ghost tasks on, the crew win on tasks before the Rotten can do much (the Rotten win about 15%); with them off, the crew have to find the Rotten, and the Rotten win about 37%. The deeper crew reasoning later made the crew much stronger (the Rotten fell to about 24%). Making endgame votes and grudges depend on personality brought the heuristic Rotten back to about 43%, inside the plan's 35–60% band.
