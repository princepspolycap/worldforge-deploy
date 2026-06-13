# Hosted Agent: Campaign Narrator

This folder makes the Master Narrator deployable as a **Microsoft Foundry hosted
agent** - Foundry's managed agent-hosting surface where agents expose a standard
protocol (`invocations`) that other agents and apps can call, similar in spirit
to A2A interop. Foundry runs the container, injects identity + telemetry, and
gives the agent a callable endpoint in the project.

## What it exposes

`POST /invocations` with a JSON body:

```json
{ "pitch": "An AI copilot for independent coffee roasters" }
```

Response: the personalized adventure lore plus the decomposed 3-step quest line
(the same reasoning the local game server runs), including the model's
`reasoning_tokens` so callers see the thinking signal too:

```json
{
  "lore": "...",
  "steps": [ { "id": "step_1_positioning", "assigned_to": "strategist", ... } ],
  "mode": "live",
  "reasoning_tokens": 320
}
```

`{"message": "..."}` is also accepted (Foundry portal chat sends this shape).

## Run locally

```bash
# from repo root
pip install -r submission/hosted_agent/requirements.txt
python submission/hosted_agent/main.py
# then:
curl -X POST "http://localhost:8088/invocations?agent_session_id=s1" \
  -H "Content-Type: application/json" \
  -d '{"pitch": "A pixel-art landing page generator for coffee shops"}'
```

Works with zero Azure credentials (simulation mode returns the deterministic
quest line). With a configured `submission/.env` it reasons on live Foundry
deployments.

## Deploy to Foundry

The standard hosted-agent flow: build the Docker image, push to ACR, create the
agent version from [agent.yaml](agent.yaml). With the Azure Developer CLI
agent extension:

```bash
cd submission/hosted_agent
azd ai agent init   # reads agent.yaml
azd up
```

No secrets ship in this folder - configuration arrives via environment
variables at deploy time (see [../.env.example](../.env.example)).
