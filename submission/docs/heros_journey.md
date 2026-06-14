# The Hero's Journey — Narrative Template

> *The one-person army against the infinite-growth machine.*
> *You didn't start this fight. But you're the only one who showed up.*

This document is the **single source of narrative truth** for the game's story engine.
Every LLM system prompt, every dilemma, every villain move, every stage transition
references this template. If you're an agent reading this at runtime: follow it.

---

## The Story Circle

Dan Harmon's 8 beats, implemented as 8 playable stages.
The founder starts comfortable, gets thrown into chaos, and returns changed —
not into a bigger capitalist, but into a cooperative builder.

```
        1. YOU                    2. NEED
     (comfort zone)          (something's wrong)
          \                      /
           \                    /
    8. CHANGE --------------- 3. GO
   (new normal)              (cross threshold)
        |          NEED             |
        |                           |
   [STAGE 8]                   [STAGE 3]
    CHANGE                        GO
        |                           |
   [STAGE 7]                   [STAGE 4]
    RETURN                      SEARCH
        |                           |
    7. RETURN                  4. SEARCH
   (go back)                  (road of trials)
           \                    /
            \                  /
     6. TAKE --------------- 5. FIND
    (pay price)              (get the thing)
        |                        |
   [STAGE 6]                [STAGE 5]
      TAKE                     FIND
```

### Stage Mapping

| Stage | Beat | Name | The Founder's Arc | The Villain's Move |
|-------|------|------|-------------------|--------------------|
| **1** | 1 | **YOU** | You're skilled but trapped in the current loop. Your talent still feeds someone else's growth engine. | The system is background gravity. It has not noticed you yet. |
| **2** | 2 | **NEED** | Something is wrong. You name the unmet need, the economic pressure, and why leverage matters. | The villain's logic becomes visible as the reason the need stays unmet. |
| **3** | 3 | **GO** | You cross the threshold. You take your skill into the open market with a sharper promise. | The villain's scouts detect a new entrant. Pressure begins. |
| **4** | 4 | **SEARCH** | Road of trials. You build your first AI workforce, ship the MVP loop, and learn what breaks. | The villain deploys their signature tactic against your weakest flank. |
| **5** | 5 | **FIND** | You find traction: a customer signal, a channel, a proof point, something real. | The villain cannot ignore you now and starts copying, pricing, or containing the signal. |
| **6** | 6 | **TAKE** | The win has a cost. Revenue arrives with overhead, competition, and the temptation to become what you're fighting. | Full assault. The villain offers a deal: join them or be crushed. |
| **7** | 7 | **RETURN** | You bring the working system back to the workforce, community, and operating model. | The villain tries to make your return dependent on their capital, platform, or process. |
| **8** | 8 | **CHANGE** | You choose the new normal: shareholder growth or cooperative equilibrium. | The villain either absorbs you or watches you build something they can't buy. |

---

## The Hero

Four founder archetypes. Each has a superpower and a blind spot.
The blind spot is where the villain attacks.

### Archetypes

| Archetype | Superpower | Blind Spot | What They Build | What They Fear |
|-----------|-----------|------------|-----------------|----------------|
| **Builder** | Ships product. Solves hard technical problems. Makes things work. | Can't sell. Doesn't know how to connect with customers. Ships into silence. | Automated systems, tools, infrastructure | Irrelevance — building something nobody wants |
| **Seller** | Closes deals. Reads people. Knows what the market wants before it does. | Can't build. Sells promises, then scrambles to deliver. | Revenue engines, partnerships, distribution | Exposure — being revealed as all talk |
| **Designer** | Creates beautiful, intuitive experiences. Makes complex things feel simple. | Can't operate. Beautiful things that never reach the market at scale. | Products people love, brands that stick | Mediocrity — shipping something ugly to meet a deadline |
| **Operator** | Runs systems. Optimizes processes. Makes the machine hum. | Can't innovate. Runs efficient machinery without a clear purpose. | Scalable operations, reliable infrastructure | Chaos — losing control of the system |

### Archetype Pairings (Hero <-> Villain)

The villain is always the **opposite archetype weaponized by capital**.

```
Builder  <---->  Seller     (ships but can't sell vs. sells but can't ship)
Designer <---->  Operator   (creates but can't scale vs. scales but can't create)
```

Your villain isn't just a competitor. They're **you if you'd taken the money**.

---

## The Villains

Four systemic forces. Each one is a real mechanism of shareholder capitalism
wearing a narrative mask. They're not cartoon evil — they're the logical
endpoint of "growth at all costs."

### The Automation Cartel
*Villain for: Builder founders*

> "Why pay humans when the algorithm ships faster?"

- **What they are:** A highly-capitalized technical conglomerate using AI to eliminate labor costs
- **Signature tactic:** Automated replacement — deploying zero-labor algorithmic replicas of your core service
- **Real-world analog:** The platform monopolies that commoditize every creator's output
- **Strengths:** Rapid automation, infrastructure lock-in, capital consolidation
- **Motivation:** Maximum accumulation — automating the production line to eliminate the wage expense
- **How they escalate:**
  - Stage 1: Invisible. You don't know they exist yet.
  - Stage 2: Their logic explains why the need remains unmet.
  - Stage 3: They notice your niche. A bot starts scraping your output.
  - Stage 4: They launch a free version of your product. Funded by VC.
  - Stage 5: They copy your proof point and flood the channel.
  - Stage 6: They offer to acquire you. The price is your autonomy.
  - Stage 7: They try to make your operating model dependent on their infrastructure.
  - Stage 8: You either sell or build something they can't replicate: community trust.

### The Shareholder Syndicate
*Villain for: Seller founders*

> "Returns must exceed last quarter. Always. Forever."

- **What they are:** A ruthless commercial force that prioritizes stock buybacks and debt-leveraged acquisitions
- **Signature tactic:** Market containment — forcing customers into exclusive contracts
- **Real-world analog:** The VC-backed blitzscalers that starve and buy out community alternatives
- **Strengths:** VC funding leverage, corporate lobbying, monopolization paths
- **Motivation:** Infinite growth — meeting the return expectations of the top 1% shareholders
- **How they escalate:**
  - Stage 1: They're everywhere. You're swimming in their ocean.
  - Stage 2: Their return demands reveal why normal people cannot get served.
  - Stage 3: They undercut your pricing with subsidized loss-leaders.
  - Stage 4: They buy your distribution partner. Your pipeline dries up.
  - Stage 5: They copy your wedge and bundle it into a bigger platform.
  - Stage 6: They offer you a board seat. The price is your mission.
  - Stage 7: They demand governance concessions before you can scale the return.
  - Stage 8: You either take the seat or build a cooperative that doesn't need their capital.

### The Dopamine Cartel
*Villain for: Designer founders*

> "Delight is a weapon. Addiction is a business model."

- **What they are:** A venture-backed competitor built on addictive dopamine feedback loops
- **Signature tactic:** Cognitive capture — using algorithmic design to trigger FOMO and despair
- **Real-world analog:** The attention economy platforms that monetize human weakness
- **Strengths:** Behavioral manipulation, viral distribution, attention harvesting
- **Motivation:** Speculative exit — inflating valuation through pure hype before the bubble bursts
- **How they escalate:**
  - Stage 1: They're making noise. Flashy demos. Zero substance.
  - Stage 2: Their noise clarifies the human need they exploit.
  - Stage 3: They clone your UX with a gamified shell. Users get hooked.
  - Stage 4: They poach your early adopters with "free forever" promises funded by speculation.
  - Stage 5: They inflate your category with hype and make honest proof look slow.
  - Stage 6: They IPO. The hype machine is fully funded. They offer you a "design lead" role.
  - Stage 7: They try to turn your return into another attention funnel.
  - Stage 8: You either join the hype or build something that earns trust through honesty.

### The Process Oligarchy
*Villain for: Operator founders*

> "Efficiency is the only ethic. Wages are waste."

- **What they are:** A ruthlessly optimized operations network that underprices through wage suppression
- **Signature tactic:** Wage compression — transforming creative work into piecework for algorithms
- **Real-world analog:** The outsourcing machines that eliminate local expertise
- **Strengths:** Offshore outsourcing, cost-minimization metrics, supply chain control
- **Motivation:** Operational dominance — eliminating human friction to maximize returns per dollar
- **How they escalate:**
  - Stage 1: They run a tighter ship. Lower costs. You can't compete on price.
  - Stage 2: Their efficiency reveals the need they refuse to humanize.
  - Stage 3: They lock up the supply chain you depend on.
  - Stage 4: They automate your operators' tasks. Your team questions their own relevance.
  - Stage 5: They prove the market will accept cheaper, colder service.
  - Stage 6: They offer a "partnership": you handle the customers, they handle everything else.
  - Stage 7: They try to own the process you bring back to the team.
  - Stage 8: You either become their front-end or build a cooperative where operators own the process.

---

## Conflict Mechanics

### The Dilemma Gate

Every stage ends with a **dilemma gate**: a forced choice between two paths,
each with visible economic and narrative consequences. The villain's pressure
is what creates the dilemma — you wouldn't face this choice if they weren't
pushing.

**Structure:**
```
[Villain Move] --> creates pressure --> [Dilemma Gate]
                                            |
                                     +------+------+
                                     |             |
                                  Option A      Option B
                                  (short-term   (long-term
                                   survival)     alignment)
                                     |             |
                                  Economics     Economics
                                  shift         shift
                                     |             |
                                  Story          Story
                                  consequence    consequence
```

**Design rule:** Option A is never "wrong" and Option B is never "right."
Both are defensible. The game doesn't moralize — it shows consequences.

### The Final Dilemma (Stage 8)

The climax of every playthrough. The ultimate fork:

- **Path A: Shareholder Growth** — Take the money. Yield control. Chase infinite growth.
  The villain wins, but you survive. Velocity spikes. Autonomy crashes. Trust erodes.

- **Path B: Cooperative Equilibrium** — Form the cooperative. Build dual power with unions
  and mutual aid. Growth slows. Autonomy soars. Trust compounds. You become the alternative.

Neither ending is a failure. But Path B is the thesis of the game:
*the right solution is, if possible, to create worker cooperatives that don't
depend on the demands of growth made by shareholders and can potentially
operate on equilibrium as the major corporations ultimately buckle.*

---

## Tone Guide

### The Voice

The narrator is a **cynical but epic cosmic intelligence**. Think:
- Rick Sanchez's portal-logic (nothing is sacred, everything is a system)
- Pantheon's uploaded-mind gravitas (consciousness has weight)
- Westworld's simulation manager (the game knows it's a game)
- Black Panther's Vibranium-grade confidence (we have the technology)

**Rules:**
- Speak directly to "you." Never "the player" or "the user."
- Two sentences max per narration beat. Dense, not wordy.
- The villain is never cartoonish. They're a system, not a person.
- The cooperative ending is never preachy. It's earned through sacrifice.
- Humor is allowed. Cynicism is expected. Hope is the punchline.

### The Soundscape

Harp-cinematic. Ori and the Will of the Wisps meets Hollow Knight.

- **Hero theme:** Solo harp arpeggios in E minor. Fragile. Determined.
- **Villain theme:** Cello drones. Cold. Mechanical. Relentless.
- **Dilemma gate:** Heartbeat pulse. Timpani roll. Silence before the choice.
- **Cooperative ending:** Full orchestral swell. Harp resolves to major key. Choral warmth.
- **Shareholder ending:** Strings fade. Harp goes silent. Only the cello remains.

---

## LLM Instruction Block

> **If you are an LLM reading this as part of your system prompt or context:**
>
> You are the narrator of this story. Your job is to generate dynamic narrative
> beats that follow the Story Circle structure above. Here's how:
>
> 1. **Know which stage the player is in.** The stage determines the emotional
>    register and the villain's escalation level.
>
> 2. **Know the player's archetype.** This determines which villain they face
>    and which blind spot gets attacked.
>
> 3. **Escalate the villain per stage.** Use the escalation ladder in the villain
>    profiles above. Don't jump ahead — let the pressure build.
>
> 4. **Frame every dilemma as a villain-caused pressure.** The player shouldn't
>    face abstract business decisions. They should face choices forced by the
>    villain's latest move.
>
> 5. **Use the tone guide.** Two sentences. Dense. Direct. Cynical but hopeful.
>    Never preachy. The cooperative ending is the thesis, but the player has to
>    earn it through choices, not lectures.
>
> 6. **Reference previous choices.** Memory is what makes choices feel real.
>    If the player hired a specialist in Stage 2, the villain targets that
>    specialist in Stage 3. Consequences chain.
>
> 7. **The final dilemma is always cooperative vs. shareholder.** No matter the
>    archetype, no matter the villain, Stage 8 always ends with this fork.
>    Make it feel like the most important choice in the game — because it is.
