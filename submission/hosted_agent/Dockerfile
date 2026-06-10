FROM python:3.12-slim

WORKDIR /app

# Install hosted-agent runtime deps first for layer caching.
COPY hosted_agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Bring in the reasoning core the narrator shares with the local game server.
COPY agents/ ./agents/
COPY state/ ./state/
COPY knowledge/ ./knowledge/
COPY hosted_agent/main.py ./main.py

EXPOSE 8088
CMD ["python", "main.py"]
