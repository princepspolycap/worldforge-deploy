# AGENTS.md

This repo's canonical AI-agent context lives in [.github/copilot-instructions.md](.github/copilot-instructions.md).

Read it before making changes. Highlights:

- We're building a Microsoft Agents League submission ("Gamifying World Improvement") for the **June 10, 2026** live battle.
- All reasoning agents must run on **Microsoft Foundry models**.
- All new code lives under `submission/`. Never modify `starter-kits/` (upstream Microsoft).
- Reuse Foundry credentials from a local Foundry `.env` (path kept off this public repo).
- Release UI is `submission/ui/story.html` plus `submission/ui/game/*.js`; old game-art prototype notes are private history.
- Keep local art, video exports, deployment notes, quota notes, and demo logistics out of the public repo.
- Base branch: `main`.
- Current feature branch: `feat/important-next-phase`.

Run the end-to-end simulator (no Azure needed):

```bash
python3 submission/tools/run_quest_simulation.py --pitch "Green energy grids"
```

Full strategy: [PROJECT_NARRATIVE.md](PROJECT_NARRATIVE.md).
