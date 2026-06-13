# World Improvement Pivot

Status: product direction update. This document defines the new framing before
we do a full wording and UI migration.

Implementation detail: `submission/docs/profile_identity_enrichment.md` defines
the tiered URL-handle -> public scrape -> optional external API strategy for the
profile-first entry path.

## 1. The Shift

The old frame was useful for the initial Microsoft Agents League mapping:

- a company was the dungeon;
- chapters were rooms;
- agents cleared the rooms;
- the founder approved artifacts at gates.

That helped us map the live battle's game-master pattern onto business
execution. But the stronger product direction is now broader and more focused:

> A gamified world-improvement simulator where a founder enters with their own
> identity, an AI workforce forms around their strengths and blind spots, and
> multi-agent work turns a mission into verified artifacts, decisions, memory,
> and operating loops.

The company can still exist as a vehicle, but it is not the point. The point is
the founder entering a world-improvement campaign and learning how to deploy a
reasoning-agent workforce toward a concrete mission.

## 2. New Entry Point

The entry should be profile-first, not generic-website-first.

Primary input:

- founder name;
- LinkedIn or public profile URL;
- founder archetype;
- optional pitch/mission later.

Secondary fallback:

- no URL required;
- use archetype plus default world-improvement mission;
- keep the run fully demoable without private credentials.

Why LinkedIn/profile-first:

- it makes the player the character;
- it gives the game a real starting identity;
- it lets the org design around strengths and blind spots;
- it supports the roguelike idea of growth over repeated runs.

Important implementation constraint:

- Do not make private LinkedIn API access required for the demo.
- Treat a LinkedIn URL as a public profile signal.
- If LinkedIn blocks scraping or returns limited content, degrade to archetype
  plus manually entered mission.
- Never ask the browser to hold private LinkedIn credentials.

## 3. New Language

Prefer:

- mission;
- world;
- run;
- campaign;
- workforce;
- operating loop;
- chapter;
- gate;
- decision;
- graph;
- deck;
- card;
- council;
- proof.

Avoid as primary copy:

- dungeon;
- clearing the dungeon;
- your company is the dungeon;
- generic company website;
- generic startup simulator.

Some older docs can still mention the previous phrase when explaining history or
challenge mapping, but new UI and user-facing copy should move away from it.

## 4. What Changes In The UI

The first-step screen should ask:

- "LinkedIn or public profile URL"

It should not require a separate name or archetype step. The URL handle can give
us a usable founder display name, and the Profile Analyst should infer the
starting archetype when public signal exists. Manual archetype selection can
come back later as an advanced override, not the primary entry.

The hidden default should be a world-improvement mission, not a canned company
website.

The center world surface should show:

- the founder identity;
- the mission graph;
- agent relationships;
- decisions and consequences;
- artifacts as cards.

The bottom card carousel should be:

- the player's agent workforce deck;
- a way to inspect agent state;
- a way to see who is talking, challenging, handing off, or waiting.

## 5. What Changes In The Data Model

The current local model is close:

- `FounderState` already stores name, archetype, skill, locale, voice, and
  avatar.
- `/api/company/analyze` already accepts URL and founder fields.
- `/api/world/design` already carries founder fields forward.
- `/api/world/standup` already returns speaker profiles and character state.

Near-term changes:

- rename UI copy from company URL to LinkedIn/public profile URL;
- preserve URL as `source_ref`, but treat it as identity/mission context;
- add explicit `source_kind` later: `linkedin_profile`, `public_profile`,
  `mission_url`, `manual_pitch`;
- add profile-analysis fields later: strengths, blind spots, domain, network,
  credibility, mission fit.

## 6. What Changes In The Story

Old:

```text
Pitch company -> company becomes dungeon -> agents clear rooms.
```

New:

```text
Founder enters -> profile/archetype defines the human seat
  -> agents form a workforce around strengths and blind spots
  -> the world-improvement mission becomes a graph
  -> agents debate, build, validate, and hand off
  -> founder decisions mutate the graph
  -> the run ends with a working operating loop.
```

This keeps the battle's core requirement - reasoning agents driving a role-play
adventure - while making the product more personal and less generic.

## 7. Current Local Changes

Implemented first pass:

- `submission/ui/story.html` now labels the entry as "LinkedIn or public profile
  URL" and no longer preloads a generic website.
- `submission/ui/game/story.js` now defaults to a world-improvement mission
  instead of a canned company URL.
- `submission/tools/server.py` now describes the URL path as public
  profile/mission URL analysis rather than generic company homepage analysis.
- `submission/agents/company_analyst.py` now classifies LinkedIn/public profile
  URLs, infers `founder_archetype` and `founder_skill`, and degrades cleanly
  when LinkedIn blocks unauthenticated page reads.
- `submission/docs/card_dag_game_design.md` should be read through this pivot.

Current reality check:

- `https://www.linkedin.com/in/princeps-polycap/` is recognized as
  `linkedin_profile`.
- LinkedIn did not expose detailed public HTML to the unauthenticated scraper in
  the local test.
- The fallback still derives the public handle and infers a safe Builder seat.
- This is acceptable for demo reliability, but not the same as a private
  LinkedIn API integration.

Still to migrate:

- older docs with "Your Company Is the Dungeon" language;
- title and public narrative naming;
- intro film copy if we decide the phrase is fully retired;
- all remaining "company dungeon" and "cleared dungeon" references;
- richer profile analysis fields and UI.

## 8. Task At Hand

The current technical task is simplification:

1. Make onboarding one gesture: paste a LinkedIn/public profile URL, then begin.
2. Infer founder display name and archetype from that public profile signal.
3. Keep profile scraping demo-safe with restricted-page fallbacks.
4. Treat manual archetype as an override/fallback, not the main path.
5. Reframe copy from "company/dungeon" toward profile -> mission -> workforce
   -> graph -> world-improvement loop.
6. Keep the card/DAG design: bottom workforce hand, center mission graph, agent
   conversation edges, result cards, and inspectable evidence.

## 9. Decision

The new design target is:

> Your profile becomes the founder seat. Your mission becomes the graph. Your AI
> workforce becomes the deck. Your decisions change the world.

That is the frame future UI and story work should optimize for.
