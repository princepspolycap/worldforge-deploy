# Profile Identity Enrichment

Status: implementation decision record for the profile-first onboarding path.

## 1. Goal

The entry flow should be as simple as possible:

```text
Paste LinkedIn/public profile URL -> infer founder identity -> build the agent deck
```

The player should not have to separately provide:

- name;
- archetype;
- skill lane;
- company description;
- initial deck composition.

Those can be inferred from the profile signal where possible, with graceful
fallbacks when public data is thin.

## 2. Current Local Behavior

Implemented locally:

- `submission/ui/story.html` exposes one visible field: LinkedIn or public
  profile URL.
- `submission/ui/game/story.js` derives a founder display name from the URL
  handle when possible.
- `submission/agents/company_analyst.py` classifies URL source kind:
  `linkedin_profile`, `linkedin_public_page`, `public_profile`, or
  `mission_or_company_url`.
- `submission/agents/company_analyst.py` infers `founder_archetype` and
  `founder_skill` from public page text or URL handle fallback.
- `submission/tools/server.py` writes inferred archetype/skill into
  `FounderState` when profile analysis returns it.

Local test result:

```text
Input: https://www.linkedin.com/in/princeps-polycap/
source_kind: linkedin_profile
scraped: false
founder_archetype: Builder
founder_skill: building product: shipping software, prototypes, systems
```

LinkedIn did not expose detailed public HTML to the unauthenticated scraper in
that test. The fallback still derived the name from the handle and produced a
safe starting seat.

## 3. Three-Tier Strategy

### Tier 1: URL Handle Inference

Always available.

Examples:

- `linkedin.com/in/princeps-polycap` -> `Princeps Polycap`
- `github.com/some-builder` -> `Some Builder`
- `bio.site/creative-operator` -> `Creative Operator`

Use for:

- founder display name;
- safe fallback identity;
- weak archetype hints from handle words.

Pros:

- instant;
- no external dependency;
- no privacy risk;
- works even when scraping is blocked.

Cons:

- shallow signal;
- can be wrong;
- cannot infer full professional history.

### Tier 2: Public Page Scrape

Current implementation.

Fetches public HTML through the SSRF-guarded scraper in
`submission/agents/retrieval.py`, then analyzes:

- title;
- description/meta tags;
- headings;
- calls to action;
- readable body excerpt.

Use for:

- richer archetype inference;
- mission/profile summary;
- initial memory entry;
- org design brief.

Pros:

- no private credentials;
- forkable;
- works for personal sites, GitHub profiles, public portfolio pages, and many
  mission/company pages.

Cons:

- LinkedIn often blocks or limits unauthenticated HTML;
- output quality depends on page markup;
- not a full identity enrichment layer.

### Tier 3: Optional External Profile Enrichment API

Not required for the demo, but likely useful later.

This would be a server-side adapter that accepts a public profile URL and
returns normalized profile facts:

```json
{
  "display_name": "Princeps Polycap",
  "headline": "...",
  "experience": [],
  "skills": [],
  "location": "",
  "public_links": [],
  "confidence": 0.82,
  "source": "profile_enrichment_api"
}
```

Use for:

- better founder archetype classification;
- stronger deck generation;
- repeat-run memory;
- richer profile cards.

Rules:

- Keep it optional.
- Run it only server-side.
- Never expose API keys to the browser.
- Never require a user's LinkedIn login for the live demo.
- Cache/summarize only the fields needed for gameplay.
- Respect public data, consent, and provider terms.

## 4. Adapter Shape

Future module:

```text
submission/agents/profile_enrichment.py
```

Suggested function:

```python
def enrich_profile(url: str) -> dict:
    """Return normalized profile signal from public scrape + optional API."""
```

Return shape:

```json
{
  "source_kind": "linkedin_profile",
  "display_name": "Princeps Polycap",
  "summary": "Public profile signal...",
  "strengths": ["product systems", "AI agents"],
  "blind_spots": ["distribution"],
  "founder_archetype": "Builder",
  "founder_skill": "building product: shipping software, prototypes, systems",
  "confidence": 0.64,
  "signals": [],
  "provider": "public_scrape"
}
```

The existing `company_analyst.py` can keep handling this for the first pass, but
the profile path should eventually move into its own module so naming stays
clean.

## 5. UI Implication

Onboarding should stay one step:

```text
LinkedIn or public profile URL
Begin the run
```

No required name field. No required archetype picker.

Optional later controls:

- "Edit inferred name";
- "Override starting class";
- "Use a different mission";
- "Add more profile context".

These should be advanced controls, not first-run friction.

## 6. Task At Hand

The immediate work is not to pick a paid API. The immediate work is to make the
local tiered pipeline clean:

1. Rename user-facing copy to profile-first language.
2. Keep URL-handle name inference working.
3. Keep public scrape fallback working.
4. Normalize the profile response shape.
5. Show inferred name/archetype in the UI after analysis.
6. Pass inferred founder state into org/world design.
7. Keep manual overrides hidden or secondary.

After that is stable, evaluate outside APIs for quality, terms, cost, and demo
risk.
