// Character Info Overlay - Click NPCs to view their stats and artifacts

function openCharacterOverlay(agentKey) {
    const agentMeta = AGENT_DISPLAY[agentKey] || { name: agentKey };
    const npc = npcs[agentKey];
    if (!npc || !characterInfoOverlay) return;

    // Update header
    charNameHeader.innerText = agentMeta.name.toUpperCase();

    // Populate quest path for this agent
    overlayQuestBoard.innerHTML = "";
    if (currentGameState?.active_quest?.steps) {
        const stepsForAgent = currentGameState.active_quest.steps.filter(s => s.assigned_to === agentKey);
        stepsForAgent.forEach((step, idx) => {
            const card = document.createElement("div");
            card.className = "px-2 py-1.5 rounded border border-teal-500/30 bg-teal-950/10 text-[9px]";
            card.innerHTML = `
                <div class="text-teal-300 font-bold">${escapeHTML(step.title)}</div>
                <div class="text-slate-400 text-[8px]">${escapeHTML(step.status || "pending")}</div>
            `;
            overlayQuestBoard.appendChild(card);
        });
    } else if (currentGameState?.world?.chapters) {
        const chaptersForAgent = currentGameState.world.chapters.filter(c => c.owner_role === agentKey);
        chaptersForAgent.forEach((ch, idx) => {
            const card = document.createElement("div");
            card.className = "px-2 py-1.5 rounded border border-emerald-500/30 bg-emerald-950/10 text-[9px]";
            const score = ch.validation_score ? `${ch.validation_score}/100` : "--";
            card.innerHTML = `
                <div class="text-emerald-300 font-bold">${escapeHTML(ch.title)}</div>
                <div class="text-slate-400 text-[8px]">${escapeHTML(ch.status || "pending")} • ${score}</div>
            `;
            overlayQuestBoard.appendChild(card);
        });
    }

    // Populate artifact for this agent
    overlayArtifactContent.innerHTML = "";
    const latestArtifact = currentGameState?.active_quest?.steps
        ?.filter(s => s.assigned_to === agentKey)
        ?.find(s => s.artifact_data) || null;
    const latestChapterArtifact = currentGameState?.world?.chapters
        ?.find(c => c.owner_role === agentKey && c.artifact) || null;

    if (latestArtifact) {
        overlayArtifactContent.innerHTML = renderArtifactObject(latestArtifact.artifact_data);
        if (latestArtifact.validation_results?.score != null) {
            overlayValidationScore.classList.remove("hidden");
            overlayScore.innerText = `${latestArtifact.validation_results.score}/100`;
        } else {
            overlayValidationScore.classList.add("hidden");
        }
    } else if (latestChapterArtifact) {
        overlayArtifactContent.innerHTML = renderArtifactObject(latestChapterArtifact.artifact || {});
        if (latestChapterArtifact.validation_score != null) {
            overlayValidationScore.classList.remove("hidden");
            overlayScore.innerText = `${latestChapterArtifact.validation_score}/100`;
        } else {
            overlayValidationScore.classList.add("hidden");
        }
    } else {
        overlayArtifactContent.innerHTML = `<div class="text-slate-500 text-center">No artifact produced yet.</div>`;
        overlayValidationScore.classList.add("hidden");
    }

    // Populate reasoning logs for this agent
    overlayReasoningLogs.innerHTML = "";
    const agentLogs = (currentGameState?.replay_log || [])
        .filter(log => log.actor === agentKey || log.actor === agentMeta.name.toLowerCase());
    if (agentLogs.length === 0) {
        const noLog = document.createElement("div");
        noLog.className = "text-slate-500";
        noLog.innerText = "Waiting for agent execution...";
        overlayReasoningLogs.appendChild(noLog);
    } else {
        agentLogs.slice(-15).forEach(log => {
            const line = document.createElement("div");
            line.className = "text-teal-300 text-[9px]";
            line.innerText = `[${log.actor}] ${log.message}`;
            overlayReasoningLogs.appendChild(line);
        });
    }

    // Show overlay
    characterInfoOverlay.classList.remove("hidden");
}

function closeCharacterOverlay() {
    if (characterInfoOverlay) {
        characterInfoOverlay.classList.add("hidden");
    }
}

// Wire up overlay close button
if (closeCharOverlay) {
    closeCharOverlay.addEventListener("click", closeCharacterOverlay);
}

// Close on background click
if (characterInfoOverlay) {
    characterInfoOverlay.addEventListener("click", (e) => {
        if (e.target === characterInfoOverlay) closeCharacterOverlay();
    });
}

// Keyboard close (Escape key)
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && characterInfoOverlay && !characterInfoOverlay.classList.contains("hidden")) {
        closeCharacterOverlay();
    }
});
