# Production image for the full "Gamifying World Improvement" game server
# (FastAPI + story-mode UI). Build context is submission/.
#
# Security notes:
# - No secrets are copied in. submission/.dockerignore excludes .env*, and the
#   COPY lines below are explicit (no `COPY . .`), so credentials can only ever
#   arrive at runtime via injected environment variables / Container App secrets.
# - Prior-run state, learned memory, and maintainer notes are excluded too, so
#   the deployed app boots clean.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Bring in only the runtime code/assets the server needs (explicit allowlist).
COPY agents/ ./agents/
COPY state/ ./state/
COPY tools/ ./tools/
COPY knowledge/ ./knowledge/
COPY quests/ ./quests/
COPY ui/ ./ui/

# Run as a non-root user. State writes go to ephemeral container storage under
# /app/state, which the app owns.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/state/slots /app/replay \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Bind 0.0.0.0 (container) instead of the app's localhost default, and honor the
# platform-provided $PORT.
CMD ["sh", "-c", "uvicorn tools.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
