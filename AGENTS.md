# AGENTS.md

This repo's canonical AI-agent context lives in [.github/copilot-instructions.md](.github/copilot-instructions.md).

Read it before making changes. Highlights:

- We're building a Microsoft Agents League submission ("Your Company Is the Dungeon") for the **June 10, 2026** live battle.
- All reasoning agents must run on **Microsoft Foundry models**.
- All new code lives under `submission/`. Never modify `starter-kits/` (upstream Microsoft).
- Reuse Foundry credentials from a local Foundry `.env` (path kept off this public repo).
- Reuse Phaser-compatible game assets from a local Phaser asset library (kept off this public repo; verify license before committing any art).
- Working branch: `feat/dungeon-engine-scaffold`.

Run the end-to-end simulator (no Azure needed):

```bash
python3 submission/tools/run_quest_simulation.py --pitch "Your idea"
```

Full strategy: [PROJECT_NARRATIVE.md](PROJECT_NARRATIVE.md).
