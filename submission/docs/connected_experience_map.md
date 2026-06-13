# Connected Experience Map

This document maps the core experience as one connected game system: intro,
founder creation, company analysis, workforce design, chapter execution,
dilemmas, voice, avatars, diagrams, and multi-agent standups.

The main product problem is not that the pieces are missing. The problem is
that the player needs to understand why each piece is happening, while still
feeling like they are inside a management RPG instead of watching a dashboard.

## 1. Main Player Journey

```mermaid
flowchart TD
    A["Intro film<br/>why this world exists"] --> B["Character Creation<br/>who are you in this world?"]
    B --> C["Venture Charter<br/>what company are you founding?"]
    C --> D["Founder Profile Saved<br/>name, archetype, skill, voice, avatar"]
    D --> E{"Input type"}
    E -->|"Company URL"| F["Company Analysis<br/>scrape homepage + infer business profile"]
    E -->|"Pitch text"| G["Pitch Brief<br/>use founder's own description"]
    F --> H["Org Designer<br/>creates digital workforce"]
    G --> H
    H --> I["World Designer<br/>creates venture chapters"]
    I --> J["Visual Walkthrough<br/>show org, chapter map, ownership"]
    J --> K["Worker Executes Chapter<br/>agent + tools + memory + validation"]
    K --> L["Artifact Rendered<br/>Mermaid, SVG, chart, text artifact"]
    L --> M["Verification Gate<br/>human approves artifact"]
    M --> N["Dilemma<br/>CEO tradeoff decision"]
    N --> O["Consequence Applied<br/>metrics, org, memory change"]
    O --> P["Agent Standup<br/>workers discuss the decision"]
    P --> Q{"CEO responds?"}
    Q -->|"Text"| R["Save CEO response to memory"]
    Q -->|"Voice"| S["SpeechRecognition<br/>transcribe CEO response"]
    S --> R
    R --> P
    Q -->|"Skip / continue"| T["Next chapter brief<br/>includes decisions + standup memory"]
    T --> K
```

Core principle: every major game beat should produce visible state, not only
narration. The player should see the system remembering, assigning, checking,
and changing.

## 2. What Each System Is Responsible For

```mermaid
flowchart LR
    subgraph Onboarding["Onboarding"]
        A1["Intro Film"]
        A2["Character Creation"]
        A3["Venture Charter"]
    end

    subgraph Identity["Founder Identity"]
        B1["FounderState"]
        B2["Avatar"]
        B3["Voice"]
        B4["Archetype + Skill"]
    end

    subgraph World["World Building"]
        C1["Company Analyst"]
        C2["Org Designer"]
        C3["World Designer"]
    end

    subgraph Execution["Chapter Execution"]
        D1["Worker Agent"]
        D2["Foundry IQ / Memory"]
        D3["Tool Calls"]
        D4["Validator Gate"]
    end

    subgraph Conversation["Conversation Layer"]
        E1["Dilemma"]
        E2["Consequence"]
        E3["Standup"]
        E4["CEO voice/text reply"]
    end

    A1 --> A2 --> A3
    A2 --> B1
    B1 --> B2
    B1 --> B3
    B1 --> B4
    A3 --> C1
    C1 --> C2 --> C3
    C3 --> D1
    D1 --> D2
    D1 --> D3
    D3 --> D4
    D4 --> E1 --> E2 --> E3 --> E4
    E4 --> D2
```

## 3. State And Memory Contract

```mermaid
classDiagram
    class CompanyState {
        string name
        string pitch
        string stage
        int xp
        int level
        FounderState founder
        OrgBlueprint org
        CompanyEconomics economics
        WorldGraph world
        replay_log[]
    }

    class FounderState {
        string name
        string archetype
        string skill
        string voice
        string avatar
    }

    class OrgBlueprint {
        string company_summary
        string operating_model
        OrgRole[] roles
        int digital_worker_count
        int monthly_burn_usd
    }

    class WorldGraph {
        Chapter[] chapters
        WorkerInvocation[] invocations
        decisions[]
        string status
    }

    class Chapter {
        string id
        string title
        string owner_role
        dict artifact
        dict dilemma_choice
    }

    class MemoryLedger {
        user_profile[]
        procedural[]
        chat_summary[]
    }

    CompanyState --> FounderState
    CompanyState --> OrgBlueprint
    CompanyState --> WorldGraph
    WorldGraph --> Chapter
    CompanyState --> MemoryLedger
```

Founder profile is the player's character sheet. It should influence:

- The org design prompt: "the human operator covers this skill."
- The worker brief: "this CEO tends to prefer this posture."
- The standup: agents address the founder by name.
- The voice layer: CEO responses and previews use the selected voice.
- The avatar layer: the founder appears as part of the party, not only as form data.

## 4. Visual Walkthrough Between Charter And First Chapter

Right now this is the confusing part: the system does important work, but the
player can lose track of what is happening. We need a visible sequence after
the charter and before the first chapter.

```mermaid
sequenceDiagram
    participant CEO as Founder
    participant UI as Story UI
    participant Analyst as Company Analyst
    participant Org as Org Designer
    participant World as World Designer
    participant Workers as Worker Party

    CEO->>UI: Starts venture charter
    UI->>Analyst: Analyze URL or pitch
    Analyst-->>UI: Business profile + evidence
    UI-->>CEO: "We read the company"
    UI->>Org: Design workforce
    Org-->>UI: OrgBlueprint
    UI-->>CEO: Show org chart on scene display
    UI->>World: Design chapters
    World-->>UI: WorldGraph
    UI-->>CEO: Show chapter map
    UI->>Workers: Bind chapters to digital workers
    Workers-->>UI: Ownership/handoff map
    UI-->>CEO: "This is your party and first room"
```

Recommended scene framing:

- Treat diagrams as in-world displays, not dashboard blocks.
- The round table is the conversation space.
- The wall screen is where Mermaid diagrams, org charts, and artifacts appear.
- Character cards or portraits sit around the table and speak when active.
- The evidence rail remains available, but it is secondary to the scene.

## 5. In-World Display Model

```mermaid
flowchart TB
    subgraph Scene["Game Scene"]
        A["Round Table<br/>characters speak here"]
        B["Wall Screen<br/>diagrams/artifacts appear here"]
        C["Evidence Rail<br/>receipts and traces"]
        D["Founder Seat<br/>avatar + voice input"]
    end

    subgraph Renderers["Visual Renderers"]
        E["Mermaid Renderer<br/>org charts, maps, workflows"]
        F["SVG Renderer<br/>fallback avatars, diagrams"]
        G["Chart Renderer<br/>metrics and economy"]
        H["Text Artifact Renderer<br/>plans, emails, briefs"]
    end

    E --> B
    F --> B
    G --> B
    H --> B
    A --> D
    B --> C
```

Mechanic: the agents are not "explaining a diagram." They are placing evidence
on the wall screen during a meeting. That makes complex Mermaid diagrams feel
natural.

## 6. Voice, Avatar, And Character Identity

```mermaid
flowchart LR
    A["Character Identity"] --> B["Name"]
    A --> C["Archetype"]
    A --> D["Skill"]
    A --> E["Voice"]
    A --> F["Avatar"]

    E --> G{"Server TTS configured?"}
    G -->|"Yes"| H["Azure neural TTS"]
    G -->|"No"| I["Browser SpeechSynthesis"]

    F --> J{"Image endpoint configured?"}
    J -->|"Yes"| K["Foundry image model"]
    J -->|"No"| L["Programmatic SVG portrait"]

    B --> M["Standup address"]
    C --> N["Org design prompt"]
    D --> N
    E --> O["Voice preview + spoken CEO lines"]
    F --> P["Founder seat at round table"]
```

Important distinction:

- Avatar is presentation.
- FounderState is identity.
- Memory is behavior over time.

Do not let image generation become required for the game. A strong SVG fallback
is enough for the core loop.

## 7. Dilemmas And Decision Trees

```mermaid
flowchart TD
    A["Chapter artifact approved"] --> B["Dilemma generated"]
    B --> C["Two authored/generated choices"]
    C --> D["Preview consequences"]
    D --> E["CEO commits"]
    E --> F["Apply decision rule"]
    F --> G["Update economics"]
    F --> H["Maybe update org"]
    F --> I["Write procedural memory"]
    I --> J["Standup discusses decision"]
    J --> K["Next worker brief inherits decision"]
```

Dilemmas are the bridge between "the agent made something" and "the company is
changing." They should always show:

- What choice is being made.
- What metric or org state changes.
- Which future worker inherits the constraint.
- What memory is being written.

## 8. Infinite Standup Loop

```mermaid
flowchart TD
    A["Decision consequence lands"] --> B["Initial standup round"]
    B --> C["Agents respond in sequence"]
    C --> D["CEO response card"]
    D --> E{"Input mode"}
    E -->|"Text"| F["Use typed response"]
    E -->|"Voice"| G["SpeechRecognition transcript"]
    E -->|"Skip"| H["Exit standup"]
    F --> I["Save response memory"]
    G --> I
    I --> J["Append CEO turn to standup history"]
    J --> K["Run next agent round with history"]
    K --> C
    H --> L["Continue to next chapter"]
```

Rules for keeping it stable:

- Each round should be short: 2-4 agent turns.
- The CEO can always skip and continue.
- The loop should store history locally in the UI and send it to the server.
- Server should degrade to deterministic turns if MAF is unavailable.
- Every CEO response should become procedural memory only after explicit submit.

## 9. Real-World Scenarios Without Paid Scenario APIs

We can still make scenarios feel real without paying for an external scenarios
API.

```mermaid
flowchart LR
    A["Scenario Source"] --> B{"Cost"}
    B -->|"Free"| C["Local scenario YAML/JSON"]
    B -->|"Free"| D["Company URL scrape"]
    B -->|"Free"| E["Curated public docs in repo"]
    B -->|"Optional paid"| F["External scenario API"]

    C --> G["Scenario Pack"]
    D --> G
    E --> G
    F --> G
    G --> H["Dilemma generator"]
    G --> I["World Designer"]
    G --> J["Standup context"]
```

Recommended no-paid path:

- Add local scenario packs later: `submission/scenarios/*.yaml`.
- Scenario pack fields: industry, market shock, constraint, stakeholder, metric pressure.
- The World Designer and dilemma generator use these as context.
- URL scrape can choose a scenario pack by company type.

## 10. Current Gaps

| Area | Gap | Why it matters | Suggested next step |
| --- | --- | --- | --- |
| Visual walkthrough | The user does not clearly see company analysis -> org design -> world design -> worker binding as a sequence. | The system feels confusing even when it is working. | Add a pre-chapter "assembly sequence" with wall-screen diagrams and short narration. |
| Character creation | Founder identity exists conceptually, but needs to be first-class in state, payloads, and UI. | The player should feel like a character, not a form submitter. | Finalize `FounderState` and pass it through analyze/design/standup. |
| Founder avatar | Needs image-model path plus SVG fallback. | Presentation should be premium, but not depend on paid image calls. | Implement `/api/founder/generate-avatar` with SVG fallback first. |
| CEO voice | Voice preview and CEO response voice are not a unified mechanic yet. | Speaking should feel like part of being at the table. | Add voice dropdown + preview using existing `/api/tts` fallback chain. |
| Standup loop | First standup exists, but the infinite response loop needs a clear history contract. | Agents need to react to the CEO's words, not restart each time. | Add `history` to `/api/world/standup` and `run_maf_group_chat`. |
| Dilemma visibility | Consequences exist, but the relationship between decision, memory, next brief, and metrics needs clearer presentation. | Dilemmas are the core game mechanic. | Show "decision -> consequence -> memory -> next brief" as a compact receipt. |
| Mermaid as scene object | Diagrams render as UI artifacts, not always as in-world displays. | Complex diagrams feel less game-like unless grounded in the scene. | Frame diagrams as a wall screen or table projection. |
| Scenario realism | Real-world scenario inspiration is desired, but paid APIs are not ideal. | Scenarios make dilemmas more meaningful. | Use local scenario packs and URL-derived company type first. |
| Parallel agent work | Multiple agents are editing connected surfaces. | High risk of conflicting implementation choices. | Use this doc as the shared contract before touching active files. |

## 11. Suggested Build Order

```mermaid
flowchart TD
    A["1. Shared contract doc<br/>this file"] --> B["2. FounderState + payload plumbing"]
    B --> C["3. Visible Character Creation + Venture Charter"]
    C --> D["4. Avatar endpoint<br/>SVG fallback first"]
    D --> E["5. Visual assembly sequence<br/>analysis -> org -> world -> party"]
    E --> F["6. Standup history contract"]
    F --> G["7. Infinite CEO response loop"]
    G --> H["8. In-world wall screen polish"]
    H --> I["9. Local scenario packs"]
```

This order keeps the core stable: state first, then UI, then live generation,
then infinite conversation, then optional realism.

