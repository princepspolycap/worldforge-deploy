# Deploy: Gamifying World Improvement (Creative Apps)

One-command, secret-safe deploy of the full game server (FastAPI + story-mode
UI) to **Azure Container Apps** via the Azure CLI. No local Docker required —
the image is built remotely by Azure Container Registry (ACR).

## Security model (open-source safe)

This repo is public, so the deploy is built so **nothing sensitive ever leaves
your machine in a committable or registry-visible form**:

- **Secrets stay in `submission/.env`**, which is gitignored and untracked. The
  script reads it only at deploy time and never prints values.
- [`submission/.dockerignore`](../.dockerignore) blocks `.env*`, prior-run
  state (`state/state.json`, `state/memory.json`, slots, replays),
  `private/`, and caches from the build context — so they can't be baked into
  an image layer.
- The [`Dockerfile`](../Dockerfile) uses an **explicit COPY allowlist** (no
  `COPY . .`), so credentials can only ever arrive at runtime.
- Every `.env` value is pushed as an **encrypted Container App secret** and the
  container reads it via `secretref:`. Plaintext `az containerapp show` output
  never contains a secret value.
- The container runs as a **non-root user** and starts with clean state.

## Prerequisites

- `az login` (an active subscription).
- `submission/.env` filled in (copy from [`.env.example`](../.env.example)).
  For a fully reasoning live demo set `DEMO_MODE=live` with your Foundry
  credentials; `DEMO_MODE=simulation` deploys with no Azure AI calls.

## Run it

```bash
submission/deploy/deploy_container_app.sh
```

It prints a `https://<app>.<region>.azurecontainerapps.io/` URL when done.

### Overrides (all optional)

| Variable           | Default                    | Purpose                              |
| ------------------ | -------------------------- | ------------------------------------ |
| `RESOURCE_GROUP`   | `agentsleague-creative-rg` | Resource group name                  |
| `LOCATION`         | `eastus2`                  | Azure region                         |
| `ACR_NAME`         | `aglcreative<rand>`        | Globally-unique registry name        |
| `ENVIRONMENT`      | `agentsleague-cae`         | Container Apps environment           |
| `APP_NAME`         | `worldforge-game`          | Container app name                   |
| `DEPLOY_DEMO_MODE` | (uses `.env`)              | Force `simulation` / `live` at deploy |

Example — deploy in simulation mode regardless of `.env`:

```bash
DEPLOY_DEMO_MODE=simulation submission/deploy/deploy_container_app.sh
```

## Tear down

```bash
az group delete -n agentsleague-creative-rg --yes --no-wait
```
