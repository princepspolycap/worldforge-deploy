// Phaser + Web client orchestrator for "Your Company Is the Dungeon"

let phaserGame = null;
let currentGameState = null;
let isPlayerNearActiveAgent = false;
let isReasoningBusy = false;

// Core API endpoints
const API_BASE = "/api";
const GAME_MECHANICS = window.DUNGEON_GAME_MECHANICS || {};
const ROOM_SEQUENCE = GAME_MECHANICS.roomSequence || [
    {
        agent: 'strategist', name: 'Soren', role: 'Strategist', roomName: 'Blueprint Room', roomLabel: 'BLUEPRINT ROOM',
        roomX: 80, roomY: 50, roomW: 200, roomH: 260, roomColor: 0x0284c7,
        deskX: 120, deskY: 100, deskColor: 0x0284c7,
        npcX: 180, npcY: 130, statusY: 175, approachX: 144, approachY: 148, accentColor: 0x38bdf8,
        dialogue: "I have the positioning room primed. Press E to run the strategy turn."
    },
    {
        agent: 'designer', name: 'Dahlia', role: 'Designer', roomName: 'UX Lab', roomLabel: 'UX LAB',
        roomX: 300, roomY: 50, roomW: 200, roomH: 260, roomColor: 0x8b5cf6,
        deskX: 340, deskY: 100, deskColor: 0x8b5cf6,
        npcX: 400, npcY: 130, statusY: 175, approachX: 364, approachY: 148, accentColor: 0xc084fc,
        dialogue: "The layout board is ready. Press E to turn positioning into a page."
    },
    {
        agent: 'marketer', name: 'Maddox', role: 'Marketer', roomName: 'Outreach Core', roomLabel: 'OUTREACH CORE',
        roomX: 520, roomY: 50, roomW: 200, roomH: 260, roomColor: 0xeab308,
        deskX: 560, deskY: 100, deskColor: 0xeab308,
        npcX: 620, npcY: 130, statusY: 175, approachX: 584, approachY: 148, accentColor: 0xfde047,
        dialogue: "Campaign channels are open. Press E to draft the launch copy."
    },
];
const AGENT_DISPLAY = GAME_MECHANICS.agents || {
    strategist: { name: "Soren", room: "Blueprint Room" },
    designer: { name: "Dahlia", room: "UX Lab" },
    marketer: { name: "Maddox", room: "Outreach Core" }
};

const AGENT_DIALOGUE = GAME_MECHANICS.dialogue || {
    strategist: "I have the positioning room primed. Press E to run the strategy turn.",
    designer: "The layout board is ready. Press E to turn positioning into a page.",
    marketer: "Campaign channels are open. Press E to draft the launch copy."
};

// DOM elements
const launcherView = document.getElementById("launcher-view");
const gameView = document.getElementById("game-view");
const sidebarView = document.getElementById("sidebar-view");
const statusPanel = document.getElementById("status-panel");
const resetBtn = document.getElementById("reset-btn");

const companyInput = document.getElementById("company-input");
const pitchInput = document.getElementById("pitch-input");
const launchBtn = document.getElementById("launch-btn");
const pitchBanner = document.getElementById("pitch-banner");

const levelBadge = document.getElementById("level-badge");
const xpBar = document.getElementById("xp-bar");
const xpLabel = document.getElementById("xp-label");

const questBoard = document.getElementById("quest-board");
const activeAgentBadge = document.getElementById("active-agent-badge");
const triggerPanel = document.getElementById("trigger-panel");
const runStepBtn = document.getElementById("run-step-btn");
const roomAccessStatus = document.getElementById("room-access-status");
const reasoningLoader = document.getElementById("reasoning-loader");

const valScoreBox = document.getElementById("validation-score-box");
const checkingScore = document.getElementById("checking-score");
const failsList = document.getElementById("fails-list");
const artifactContentArea = document.getElementById("artifact-content-area");

const gatePanel = document.getElementById("gate-panel");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const terminalLogs = document.getElementById("terminal-logs");
const streakBadge = document.getElementById("streak-badge");
const tierBadge = document.getElementById("tier-badge");
const autoplayBtn = document.getElementById("autoplay-btn");

let isAutoplayActive = false;
const AUTOPLAY_DELAY_MS = 700;
const TIER_STYLES = GAME_MECHANICS.tierStyles || {
    gold:   { color: "#fde047", border: "border-yellow-400/60", text: "text-yellow-300", label: "GOLD x2.0" },
    silver: { color: "#cbd5f5", border: "border-slate-300/60", text: "text-slate-100", label: "SILVER x1.5" },
    bronze: { color: "#fb923c", border: "border-orange-500/60", text: "text-orange-300", label: "BRONZE x1.0" }
};

function chooseWalkDirection(dx, dy, deadZone = 0) {
    if (GAME_MECHANICS.getWalkDirection) {
        return GAME_MECHANICS.getWalkDirection(dx, dy, deadZone);
    }
    if (Math.abs(dx) <= deadZone && Math.abs(dy) <= deadZone) return null;
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx < -deadZone) return 'left';
        if (dx > deadZone) return 'right';
    }
    if (dy < -deadZone) return 'up';
    if (dy > deadZone) return 'down';
    return null;
}

function getAutoplayApproachPoint(agentKey, npc) {
    if (GAME_MECHANICS.getApproachPoint) {
        const point = GAME_MECHANICS.getApproachPoint(agentKey);
        if (point) return point;
    }
    return { x: npc.x - 36, y: npc.y + 18 };
}

// Launch the Game
async function initClient() {
    try {
        const response = await fetch(`${API_BASE}/state`);
        const data = await response.json();
        
        if (data.initialized && data.state) {
            currentGameState = data.state;
            showGameScreen();
        } else {
            showLauncherScreen();
        }
    } catch (e) {
        console.error("API Connection error:", e);
        logTerminal(`[system] Failed to reach local backend. Run: python3 submission/tools/server.py`, "text-rose-400");
    }
}

function showLauncherScreen() {
    launcherView.classList.remove("hidden");
    gameView.classList.add("hidden");
    sidebarView.classList.add("hidden");
    statusPanel.classList.add("hidden");
    resetBtn.classList.add("hidden");
    if (autoplayBtn) autoplayBtn.classList.add("hidden");
}

function showGameScreen() {
    launcherView.classList.add("hidden");
    gameView.classList.remove("hidden");
    sidebarView.classList.remove("hidden");
    statusPanel.classList.remove("hidden");
    resetBtn.classList.remove("hidden");
    if (autoplayBtn) autoplayBtn.classList.remove("hidden");

    // Initialize Phaser if not already done
    if (!phaserGame) {
        phaserGame = initPhaser();
    }
    
    updateUIWithState();
}

function logTerminal(message, textColorClass = "text-slate-400") {
    const div = document.createElement("div");
    div.className = `${textColorClass} mb-2 leading-relaxed transition-all`;
    div.innerText = message;
    terminalLogs.appendChild(div);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Render dynamic elements
function updateUIWithState() {
    if (!currentGameState) return;
    
    pitchBanner.innerText = `"${currentGameState.pitch}"`;
    levelBadge.innerText = currentGameState.level;

    const stageBadge = document.getElementById("stage-badge");
    if (stageBadge && currentGameState.stage) {
        stageBadge.innerText = currentGameState.stage;
    }
    
    // Update XP Bar (limit 50 XP per level in design)
    const baseXP = currentGameState.xp;
    let targetLimit = 50;
    let computedWidth = (baseXP / targetLimit) * 100;
    if (baseXP >= 50 && currentGameState.level > 1) {
        // level 2 xp
        targetLimit = 100;
        computedWidth = ((baseXP - 50) / 50) * 100;
        xpLabel.innerText = `${baseXP} / 100 XP`;
    } else {
        xpLabel.innerText = `${baseXP} / 50 XP`;
    }
    xpBar.style.width = `${Math.min(100, Math.max(0, computedWidth))}%`;

    // Streak indicator
    if (streakBadge) {
        const streak = currentGameState.streak || 0;
        streakBadge.innerText = streak;
        streakBadge.className = streak >= 3
            ? "pixel-font-title text-base text-orange-300 animate-pulse"
            : "pixel-font-title text-base text-orange-300";
    }
    
    // Render logs
    terminalLogs.innerHTML = "";
    currentGameState.replay_log.forEach(log => {
        let color = "text-slate-300";
        if (log.event_type.includes("APPROVED")) color = "text-emerald-400 font-bold";
        else if (log.event_type.includes("REJECTED") || log.event_type.includes("ERROR")) color = "text-rose-400";
        else if (log.event_type.includes("START")) color = "text-yellow-300";
        else if (log.actor && log.actor !== "system") color = "text-teal-400";
        
        logTerminal(`[${log.actor}] ${log.message}`, color);
    });
    
    // Render Quests Track List
    questBoard.innerHTML = "";
    if (currentGameState.active_quest && currentGameState.active_quest.steps) {
        const activeIdx = currentGameState.active_quest.current_step_index;
        
        currentGameState.active_quest.steps.forEach((step, idx) => {
            let borderClass = "border-slate-800 bg-slate-900";
            let tagClass = "bg-slate-800 text-slate-400";
            let statusText = "Pending";
            
            if (idx === activeIdx) {
                borderClass = "border-teal-500 bg-teal-950/20 shadow-md ring-1 ring-teal-500/20";
                tagClass = "bg-teal-500 text-slate-950 font-bold";
                statusText = "Active Room";
            } else if (idx < activeIdx) {
                borderClass = "border-emerald-500/50 bg-emerald-950/10";
                tagClass = "bg-emerald-950 text-emerald-400";
                statusText = "Passed";
            }
            
            const card = document.createElement("div");
            card.className = `p-4 rounded border transition-all ${borderClass}`;
            card.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${tagClass}">${step.assigned_to}</span>
                    <span class="text-[10px] text-slate-400">${statusText}</span>
                </div>
                <h4 class="text-xs font-bold text-slate-200 mb-1">${step.title}</h4>
                <p class="text-[10px] text-slate-400 leading-tight">${step.description}</p>
                <div class="mt-3 flex items-center justify-between text-[10px]">
                    <span class="text-yellow-400">💎 Reward: ${step.xp_reward} XP</span>
                    <span class="text-slate-500">${step.artifact_type.toUpperCase()}</span>
                </div>
            `;
            questBoard.appendChild(card);
        });
        
        // Setup Active Step Artifact & Button views
        const currentActiveStep = currentGameState.active_quest.steps[activeIdx];
        if (currentActiveStep) {
            activeAgentBadge.innerText = `${currentActiveStep.assigned_to.toUpperCase()} Agent`;
            
            // If the step has been executed in the current session and has artifacts...
            if (currentActiveStep.artifact_data) {
                triggerPanel.classList.add("hidden");
                gatePanel.classList.remove("hidden");
                valScoreBox.classList.remove("hidden");
                
                // Set Artifact Viewer content
                let artHTML = `<div class="space-y-4">`;
                for (const [k, v] of Object.entries(currentActiveStep.artifact_data)) {
                    artHTML += `
                        <div>
                            <span class="text-yellow-400 font-bold block mb-1 text-[10px] uppercase tracking-wider">${k.replace("_", " ")}:</span>
                            <span class="text-slate-100 bg-slate-900 border border-slate-800 rounded p-2 block font-mono text-xs whitespace-pre-wrap select-all leading-normal">${v}</span>
                        </div>
                    `;
                }
                artHTML += `</div>`;
                artifactContentArea.innerHTML = artHTML;
                
                // Show deterministic scoring
                const score = currentActiveStep.validation_results?.score || 0;
                checkingScore.innerText = `${score}/100`;
                if (score >= 90) {
                    checkingScore.className = "pixel-font-title text-sm text-emerald-400";
                } else if (score >= 70) {
                    checkingScore.className = "pixel-font-title text-sm text-yellow-400";
                } else {
                    checkingScore.className = "pixel-font-title text-sm text-rose-400";
                }

                // Tier preview: derived from score even before approval.
                if (tierBadge) {
                    const previewTier = GAME_MECHANICS.getTierForScore
                        ? GAME_MECHANICS.getTierForScore(score)
                        : score >= 95 ? "gold" : score >= 80 ? "silver" : "bronze";
                    const approvedTier = currentActiveStep.validation_results?.tier;
                    const tierKey = approvedTier || previewTier;
                    const style = TIER_STYLES[tierKey] || TIER_STYLES.bronze;
                    tierBadge.classList.remove("hidden");
                    tierBadge.innerText = approvedTier ? style.label : `${style.label} (preview)`;
                    tierBadge.className = `text-[10px] px-2 py-0.5 rounded font-bold border ${style.border} ${style.text} bg-slate-950`;
                }
                
                failsList.innerHTML = "";
                const checks = currentActiveStep.validation_results?.checks || {};
                const feedback = currentActiveStep.validation_results?.feedback || [];
                
                for (const [checkName, isPassed] of Object.entries(checks)) {
                    const symb = isPassed ? "🟩" : "🟥";
                    const color = isPassed ? "text-emerald-400" : "text-rose-400";
                    const row = document.createElement("div");
                    row.className = `flex items-center gap-1 ${color}`;
                    row.innerHTML = `<span>${symb}</span> <span class="truncate">${checkName}</span>`;
                    failsList.appendChild(row);
                }
                
                if (feedback.length > 0) {
                    const notice = document.createElement("div");
                    notice.className = "text-rose-400 border border-rose-500/20 bg-rose-950/20 p-2 rounded mt-2 text-[10px]";
                    notice.innerHTML = `<strong>Validator Notes:</strong><br>` + feedback.map(f => `- ${f}`).join("<br>");
                    failsList.appendChild(notice);
                }
                
            } else {
                // Not yet executed
                triggerPanel.classList.remove("hidden");
                gatePanel.classList.add("hidden");
                valScoreBox.classList.add("hidden");
                if (tierBadge) tierBadge.classList.add("hidden");
                artifactContentArea.innerHTML = `
                    <div class="h-full flex flex-col items-center justify-center text-slate-500">
                        <span>No artifact generated yet.</span>
                        <span class="text-[10px] mt-1 text-slate-600">Walk to the active agent room, then run the turn from the canvas or side panel.</span>
                    </div>
                `;
            }
        } else {
            // Quest Completed!
            triggerPanel.classList.add("hidden");
            gatePanel.classList.add("hidden");
            valScoreBox.classList.add("hidden");
            if (tierBadge) tierBadge.classList.add("hidden");
            artifactContentArea.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center text-teal-400 text-center p-4">
                    <span class="text-3xl mb-2">🏆</span>
                    <span class="pixel-font-title text-xs mb-1">QUEST LINE ACCOMPLISHED</span>
                    <span class="text-[10px] text-slate-400 max-w-xs leading-normal font-mono">You successfully validated target positioning, designed layouts, and published emails. Venture Stage: Validated!</span>
                </div>
            `;
        }
    }

    refreshActiveAgentProximity();
    syncPhaserQuestState();
    syncRunButtonState();
    syncInteractionMarker();
}

function getCurrentActiveStep() {
    const quest = currentGameState?.active_quest;
    if (!quest || quest.current_step_index >= quest.steps.length) return null;
    return quest.steps[quest.current_step_index];
}

function getCurrentAgentKey() {
    return getCurrentActiveStep()?.assigned_to || null;
}

function getCurrentNpc() {
    const agentKey = getCurrentAgentKey();
    return agentKey ? npcs[agentKey] : null;
}

function refreshActiveAgentProximity() {
    if (!player || !currentGameState) {
        isPlayerNearActiveAgent = false;
        return;
    }

    const activeNpc = getCurrentNpc();
    if (!activeNpc) {
        isPlayerNearActiveAgent = false;
        return;
    }

    const dist = Phaser.Math.Distance.Between(player.x, player.y, activeNpc.x, activeNpc.y);
    isPlayerNearActiveAgent = dist < 72;
}

function syncRunButtonState() {
    const currentStep = getCurrentActiveStep();
    if (!runStepBtn || !roomAccessStatus) return;

    if (!currentStep) {
        runStepBtn.disabled = true;
        runStepBtn.innerText = "QUEST COMPLETE";
        roomAccessStatus.className = "w-full mb-3 rounded border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300 font-mono";
        roomAccessStatus.innerText = "All rooms cleared. The company stage has advanced.";
        return;
    }

    const agentMeta = AGENT_DISPLAY[currentStep.assigned_to] || { name: currentStep.assigned_to, room: "Agent Room" };

    if (currentStep.artifact_data) {
        runStepBtn.disabled = true;
        runStepBtn.innerText = "AWAITING VERIFICATION";
        roomAccessStatus.className = "w-full mb-3 rounded border border-yellow-500/30 bg-yellow-950/20 px-3 py-2 text-[11px] text-yellow-300 font-mono";
        roomAccessStatus.innerText = `${agentMeta.name}'s artifact is ready. Review it to approve or reject.`;
        return;
    }

    if (isReasoningBusy) {
        runStepBtn.disabled = true;
        runStepBtn.innerText = "AGENT TURN RUNNING";
        roomAccessStatus.className = "w-full mb-3 rounded border border-teal-500/30 bg-teal-950/20 px-3 py-2 text-[11px] text-teal-300 font-mono";
        roomAccessStatus.innerText = `${agentMeta.name} is reasoning through ${currentStep.title}.`;
        return;
    }

    if (isPlayerNearActiveAgent) {
        runStepBtn.disabled = false;
        runStepBtn.innerText = `RUN ${agentMeta.name.toUpperCase()} TURN (E)`;
        roomAccessStatus.className = "w-full mb-3 rounded border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300 font-mono";
        roomAccessStatus.innerText = `${agentMeta.room} unlocked. Press E or use the button to run this agent turn.`;
    } else {
        runStepBtn.disabled = true;
        runStepBtn.innerText = `APPROACH ${agentMeta.name.toUpperCase()}`;
        roomAccessStatus.className = "w-full mb-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-400 font-mono";
        roomAccessStatus.innerText = `Move next to ${agentMeta.name} in the ${agentMeta.room} to unlock the turn.`;
    }
}

// Launch Startup Action
launchBtn.addEventListener("click", async () => {
    const pitch = pitchInput.value.trim();
    const cName = companyInput.value.trim();
    if (!pitch) return;
    
    launchBtn.disabled = true;
    launchBtn.innerText = "DEPLOYING CORE NARRATIVE...";
    
    try {
        const res = await fetch(`${API_BASE}/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pitch: pitch, company_name: cName })
        });
        const data = await res.json();
        currentGameState = data.state;
        showGameScreen();
    } catch (e) {
        console.error(e);
        alert("Failed to initialize adventure. Is the backend server running?");
    } finally {
        launchBtn.disabled = false;
        launchBtn.innerText = "ENTER THE DUNGEON ⚔️";
    }
});

// Run Step Reasoning loops
runStepBtn.addEventListener("click", attemptRunCurrentStep);

async function attemptRunCurrentStep() {
    const currentStep = getCurrentActiveStep();
    if (!currentStep || currentStep.artifact_data || isReasoningBusy) return;

    if (!isPlayerNearActiveAgent) {
        const agentMeta = AGENT_DISPLAY[currentStep.assigned_to] || { name: currentStep.assigned_to, room: "Agent Room" };
        logTerminal(`[game] Approach ${agentMeta.name} in the ${agentMeta.room} before running the turn.`, "text-yellow-300");
        const npc = getCurrentNpc();
        if (npc && phaserSceneRef) showSpeechBubble(npc.x, npc.y - 65, "Come closer to start this room's agent turn.");
        syncRunButtonState();
        return;
    }

    isReasoningBusy = true;
    runStepBtn.disabled = true;
    reasoningLoader.classList.remove("hidden");
    syncRunButtonState();
    
    // Animate Phaser NPC focusing attention
    notifyPhaserAgentActive();
    
    try {
        const res = await fetch(`${API_BASE}/step/execute`, { method: "POST" });
        if (!res.ok) throw new Error("Agent fail");
        
        const data = await res.json();
        currentGameState = data.state;
        updateUIWithState();
        
        // Trigger Phaser success balloon
        notifyPhaserAgentComplete(true);
    } catch (e) {
        console.error(e);
        logTerminal(`[system] Reasoning connection failure. Agent exhausted spell slots. Retry.`, "text-rose-400");
        notifyPhaserAgentComplete(false);
    } finally {
        isReasoningBusy = false;
        reasoningLoader.classList.add("hidden");
        syncRunButtonState();
    }
}

// Approve step
approveBtn.addEventListener("click", async () => {
    try {
        const approvedStep = getCurrentActiveStep();
        const res = await fetch(`${API_BASE}/step/approve`, { method: "POST" });
        const data = await res.json();

        // Pull authoritative earned XP from the now-finalized step.
        const finalizedStep = (data.state?.active_quest?.steps || [])
            .find(s => s.id === approvedStep?.id) || approvedStep;
        const earnedXp = finalizedStep?.validation_results?.xp_earned
            ?? approvedStep?.xp_reward
            ?? 0;
        spawnPhaserXPEffect(earnedXp);
        
        currentGameState = data.state;
        updateUIWithState();
    } catch (e) {
        console.error(e);
    }
});

// Reject step
rejectBtn.addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_BASE}/step/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback: "Needs refactoring on feature alignments." })
        });
        const data = await res.json();
        
        // Sweat balloon in Phaser
        notifyPhaserAgentReject();
        
        currentGameState = data.state;
        updateUIWithState();
    } catch (e) {
        console.error(e);
    }
});

// Reset Button
resetBtn.addEventListener("click", async () => {
    if (confirm("Reset current dungeon state and start over?")) {
        await fetch(`${API_BASE}/reset`, { method: "POST" });
        location.reload();
    }
});

// ---------------------------------------------------------------------------
// Autoplay / Demo mode
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function setAutoplayButtonState(active) {
    if (!autoplayBtn) return;
    if (active) {
        autoplayBtn.innerText = "Stop Autoplay";
        autoplayBtn.classList.remove("bg-indigo-950", "hover:bg-indigo-900", "border-indigo-500/40", "text-indigo-200");
        autoplayBtn.classList.add("bg-rose-950", "hover:bg-rose-900", "border-rose-500/40", "text-rose-200");
    } else {
        autoplayBtn.innerText = "Autoplay Demo";
        autoplayBtn.classList.add("bg-indigo-950", "hover:bg-indigo-900", "border-indigo-500/40", "text-indigo-200");
        autoplayBtn.classList.remove("bg-rose-950", "hover:bg-rose-900", "border-rose-500/40", "text-rose-200");
    }
}

function tweenPlayerTo(targetX, targetY) {
    return new Promise(resolve => {
        if (!phaserSceneRef || !player) return resolve();
        const dx = targetX - player.x;
        const dy = targetY - player.y;
        const distance = Math.hypot(dx, dy);
        const duration = Math.max(250, Math.min(1400, distance * 6));
        // Pick walk direction by dominant axis so the right animation plays.
        const dir = chooseWalkDirection(dx, dy, 2);
        if (dir && typeof player.face === 'function') {
            player.face(dir, true);
            player.setData('facing', dir);
        }
        phaserSceneRef.tweens.add({
            targets: player,
            x: targetX,
            y: targetY,
            duration,
            ease: "Sine.easeInOut",
            onComplete: () => {
                // Return to a held idle pose facing the same way.
                if (dir && typeof player.face === 'function') player.face(dir, false);
                resolve();
            },
        });
    });
}

async function runAutoplayLoop() {
    if (!currentGameState || !currentGameState.active_quest) return;
    logTerminal("[autoplay] Demo mode engaged. The party will run itself.", "text-indigo-300");

    let safety = 12;
    while (isAutoplayActive && safety-- > 0) {
        const step = getCurrentActiveStep();
        if (!step) {
            logTerminal("[autoplay] Quest line complete. Standing down.", "text-emerald-400");
            break;
        }

        // 1. Walk to the active NPC.
        const npc = getCurrentNpc();
        if (npc) {
            const approachPoint = getAutoplayApproachPoint(step.assigned_to, npc);
            await tweenPlayerTo(approachPoint.x, approachPoint.y);
            refreshActiveAgentProximity();
            await sleep(AUTOPLAY_DELAY_MS / 2);
        }
        if (!isAutoplayActive) break;

        // 2. Run the turn if the artifact is not already on the table.
        if (!getCurrentActiveStep()?.artifact_data) {
            await attemptRunCurrentStep();
            // Wait out the reasoning loader.
            let guard = 30;
            while (isReasoningBusy && guard-- > 0) await sleep(200);
        }
        if (!isAutoplayActive) break;

        // 3. Auto-approve via the same DOM path the human uses.
        await sleep(AUTOPLAY_DELAY_MS);
        approveBtn.click();
        await sleep(AUTOPLAY_DELAY_MS);
    }

    isAutoplayActive = false;
    setAutoplayButtonState(false);
}

if (autoplayBtn) {
    autoplayBtn.addEventListener("click", () => {
        if (isAutoplayActive) {
            isAutoplayActive = false;
            setAutoplayButtonState(false);
            logTerminal("[autoplay] Stop requested. Handing control back to the human.", "text-indigo-300");
            return;
        }
        isAutoplayActive = true;
        setAutoplayButtonState(true);
        runAutoplayLoop();
    });
}

// PHASER CANVAS WORLD INTEGRATION
let phaserSceneRef = null;

const WORLD_W = 960;
const WORLD_H = 540;
const CORRIDOR_Y = 460;
const PLAYER_BOUNDS = { minX: 24, maxX: WORLD_W - 24, minY: 60, maxY: WORLD_H - 24 };

function initPhaser() {
    const config = {
        type: Phaser.AUTO,
        parent: 'canvas-container',
        width: WORLD_W,
        height: WORLD_H,
        backgroundColor: '#04070f',
        pixelArt: true,
        roundPixels: true,
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0 },
                debug: false
            }
        },
        scene: {
            preload: phaserPreload,
            create: phaserCreate,
            update: phaserUpdate
        }
    };
    return new Phaser.Game(config);
}

// Optional pixel-art sprite keys. Files live under submission/ui/assets/local/characters/
// and are gitignored. When missing (default after `git clone`), the procedural drawings
// below take over - the game still runs without the Polyverse pack.
const SPRITE_KEYS = GAME_MECHANICS.spriteKeys || {
    player: 'player_sheet',
    strategist: 'npc_strategist',
    designer: 'npc_designer',
    marketer: 'npc_marketer',
};

function phaserPreload() {
    const base = '/game/assets/local/characters/';
    const sheets = [
        [SPRITE_KEYS.player, 'player.png'],
        [SPRITE_KEYS.strategist, 'strategist.png'],
        [SPRITE_KEYS.designer, 'designer.png'],
        [SPRITE_KEYS.marketer, 'marketer.png'],
    ];
    sheets.forEach(([key, file]) => {
        this.load.spritesheet(key, base + file, { frameWidth: 32, frameHeight: 64 });
    });
    // Swallow missing-file errors - procedural fallback handles them.
    this.load.on('loaderror', (file) => {
        console.info(`[sprites] '${file.key}' not present at ${file.src} - using procedural fallback.`);
    });
}

// Limezu Modern Interiors Revamped premade atlas layout (per character PNG):
//   Row 0 (frames 0-3): 4-direction idle  - 0=left, 1=up, 2=right, 3=down
//   Row 1 walk cycles (6 frames each):
//     56-61=walk-left, 62-67=walk-up, 68-73=walk-right, 74-79=walk-down
// We expose these as 8 named anims per spritesheet key, plus a `face()` helper.
const DIR_FRAMES = GAME_MECHANICS.dirFrames || {
    idle: { left: 0, up: 1, right: 2, down: 3 },
    walk: {
        left:  [56, 57, 58, 59, 60, 61],
        up:    [62, 63, 64, 65, 66, 67],
        right: [68, 69, 70, 71, 72, 73],
        down:  [74, 75, 76, 77, 78, 79],
    },
};

function ensureCharacterAnims(scene, key) {
    if (!scene.textures.exists(key)) return false;
    const tex = scene.textures.get(key);
    const total = tex.frameTotal;
    const dirs = ['left', 'up', 'right', 'down'];
    dirs.forEach((dir) => {
        const idleKey = `${key}_idle_${dir}`;
        if (!scene.anims.exists(idleKey)) {
            const f = DIR_FRAMES.idle[dir];
            const frame = f < total ? f : 0;
            scene.anims.create({
                key: idleKey,
                frames: [{ key, frame }, { key, frame }],
                frameRate: 2,
                repeat: -1,
            });
        }
        const walkKey = `${key}_walk_${dir}`;
        if (!scene.anims.exists(walkKey)) {
            const wf = DIR_FRAMES.walk[dir].filter((n) => n < total);
            // If walk frames aren't available, the anim degenerates to a held idle frame.
            const frames = wf.length > 0
                ? wf.map((n) => ({ key, frame: n }))
                : [{ key, frame: DIR_FRAMES.idle[dir] < total ? DIR_FRAMES.idle[dir] : 0 }];
            scene.anims.create({
                key: walkKey,
                frames,
                frameRate: 8,
                repeat: -1,
            });
        }
    });
    return true;
}

// Backwards-compatible idle helper (callers that just want a calm idle pose).
function ensureIdleAnim(scene, key) {
    if (!ensureCharacterAnims(scene, key)) return null;
    return `${key}_idle_down`;
}

let player = null;
let nameplates = {};
let npcs = {};
let npcStatusBadges = {};
let roomDoors = {};
let roomFloors = {};
let roomFurniture = {};
let cursors = null;
let wasdKeys = null;
let activeNpcBubble = null;
let bubbleTimer = null;
let activeRoomBeacon = null;
let interactionMarker = null;
let lastNearAgentKey = null;
let footstepCooldown = 0;

function phaserCreate() {
    phaserSceneRef = this;

    // 1. Layered background: deep stone, hatched ground, corridor carpet.
    drawDungeonBackground(this);

    // 2. Each room: tile floor, walls with a doorway, themed furniture.
    ROOM_SEQUENCE.forEach((room) => {
        drawDungeonRoom(this, room);
    });

    // 3. NPCs in the back of each room.
    ROOM_SEQUENCE.forEach((room) => {
        const npc = createProceduralNPC(this, room.npcX, room.npcY, room.name, room.accentColor, SPRITE_KEYS[room.agent]);
        npc.setDepth(5);
        addNpcIdleBob(this, npc, room);
        npcs[room.agent] = npc;
        npcStatusBadges[room.agent] = createStatusBadge(this, room.npcX, room.statusY, "LOCKED", "#94a3b8");
    });

    // 4. Player starts in the corridor in front of the first room.
    player = createProceduralPlayer(this, ROOM_SEQUENCE[0].doorX, CORRIDOR_Y + 30, SPRITE_KEYS.player);
    if (player.setDepth) player.setDepth(6);

    // 5. Soft edge vignette so the canvas reads as a lit stage.
    drawVignette(this);

    // Controls setup
    cursors = this.input.keyboard.createCursorKeys();
    wasdKeys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        interact: Phaser.Input.Keyboard.KeyCodes.E,
        space: Phaser.Input.Keyboard.KeyCodes.SPACE
    });
    this.input.keyboard.on("keydown-E", attemptRunCurrentStep);
    this.input.keyboard.on("keydown-SPACE", attemptRunCurrentStep);

    // Floating ambient particles.
    createDungeonParticles(this);
    syncPhaserQuestState();
    syncRunButtonState();
}

function phaserUpdate() {
    if (!player) return;
    
    // Smooth control inputs
    player.body.setVelocity(0);
    const speed = 160;
    
    let dx = 0, dy = 0;
    if (cursors.left.isDown || wasdKeys.left.isDown) {
        player.body.setVelocityX(-speed);
        dx = -1;
    } else if (cursors.right.isDown || wasdKeys.right.isDown) {
        player.body.setVelocityX(speed);
        dx = 1;
    }
    
    if (cursors.up.isDown || wasdKeys.up.isDown) {
        player.body.setVelocityY(-speed);
        dy = -1;
    } else if (cursors.down.isDown || wasdKeys.down.isDown) {
        player.body.setVelocityY(speed);
        dy = 1;
    }
    
    // Collide edges
    player.x = Phaser.Math.Clamp(player.x, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    player.y = Phaser.Math.Clamp(player.y, PLAYER_BOUNDS.minY, PLAYER_BOUNDS.maxY);

    // Footstep dust puffs while moving.
    if ((dx !== 0 || dy !== 0) && this.time.now > footstepCooldown) {
        spawnFootstepDust(this, player.x, player.y + 18);
        footstepCooldown = this.time.now + 180;
    }
    
    // Directional animation: prefer horizontal when both axes are pressed.
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
        const dir = chooseWalkDirection(dx, dy);
        player.setData('facing', dir);
        if (typeof player.face === 'function') player.face(dir, true);
    } else {
        const lastDir = player.getData('facing') || 'down';
        if (typeof player.face === 'function') player.face(lastDir, false);
    }

    // Walk feedback for the procedural fallback only - the real spritesheet uses
    // its own per-direction walk cycle, so we skip the container bounce there.
    const usingSprite = this.textures.exists(SPRITE_KEYS.player);
    if (!usingSprite) {
        if (moving) {
            player.setScale(1 + Math.sin(this.time.now * 0.015) * 0.05);
            player.angle = Math.sin(this.time.now * 0.01) * 3;
        } else {
            player.setScale(1);
            player.angle = 0;
        }
    }
    
    // Proximity dialogues
    checkProximityDialogues(this);
    syncRunButtonState();
    syncInteractionMarker();
}

function syncInteractionMarker() {
    const step = getCurrentActiveStep();
    const npc = getCurrentNpc();
    const shouldShow = Boolean(
        phaserSceneRef &&
        step &&
        npc &&
        !step.artifact_data &&
        !isReasoningBusy &&
        isPlayerNearActiveAgent
    );

    if (!shouldShow) {
        if (interactionMarker) {
            interactionMarker.destroy();
            interactionMarker = null;
        }
        return;
    }

    if (!interactionMarker) {
        interactionMarker = phaserSceneRef.add.text(npc.x, npc.y - 82, "E", {
            fontFamily: 'Press Start 2P, Arial',
            fontSize: '12px',
            color: '#0f172a',
            backgroundColor: '#fbbf24',
            padding: { x: 7, y: 5 }
        }).setOrigin(0.5).setDepth(20);

        phaserSceneRef.tweens.add({
            targets: interactionMarker,
            y: interactionMarker.y - 6,
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    interactionMarker.setPosition(npc.x, npc.y - 82);
}

// ============================================================
//  DUNGEON DRAWING - tiled floors, walls with doorways, furniture
// ============================================================

function drawDungeonBackground(scene) {
    // Base stone fill.
    const g = scene.add.graphics();
    g.fillStyle(0x07101e, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle diagonal hatch for stone feel.
    g.lineStyle(1, 0x0e1a30, 0.5);
    for (let i = -WORLD_H; i < WORLD_W; i += 24) {
        g.lineBetween(i, 0, i + WORLD_H, WORLD_H);
    }

    // Corridor carpet runner.
    const corridor = scene.add.graphics();
    corridor.fillStyle(0x0c1a30, 1);
    corridor.fillRect(20, CORRIDOR_Y, WORLD_W - 40, WORLD_H - CORRIDOR_Y - 20);
    corridor.lineStyle(2, 0x1a2a48, 1);
    corridor.strokeRect(20, CORRIDOR_Y, WORLD_W - 40, WORLD_H - CORRIDOR_Y - 20);

    // Carpet stripes - JRPG corridor cue.
    corridor.fillStyle(0x122742, 0.6);
    for (let x = 30; x < WORLD_W - 30; x += 40) {
        corridor.fillRect(x, CORRIDOR_Y + 18, 24, 4);
        corridor.fillRect(x, WORLD_H - 46, 24, 4);
    }

    // Cabinet label across the top stone band.
    scene.add.text(WORLD_W / 2, 18, 'OFFICE LEVEL  -  STAGE 01', {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '10px',
        color: '#14b8a6'
    }).setOrigin(0.5, 0.5).setAlpha(0.6);
}

function drawDungeonRoom(scene, room) {
    const { roomX, roomY, roomW, roomH, roomColor, floorTint, accentColor, doorX, theme, name, role, roomLabel } = room;

    // --- Tiled floor ---
    const floor = scene.add.graphics();
    floor.fillStyle(floorTint, 1);
    floor.fillRect(roomX + 4, roomY + 4, roomW - 8, roomH - 8);
    // Tile grid.
    floor.lineStyle(1, 0x000000, 0.35);
    const tile = 32;
    for (let x = roomX + 4; x <= roomX + roomW - 4; x += tile) {
        floor.lineBetween(x, roomY + 4, x, roomY + roomH - 4);
    }
    for (let y = roomY + 4; y <= roomY + roomH - 4; y += tile) {
        floor.lineBetween(roomX + 4, y, roomX + roomW - 4, y);
    }
    // Checker accent on alternating tiles.
    floor.fillStyle(roomColor, 0.06);
    for (let x = roomX + 4; x < roomX + roomW - 4; x += tile) {
        for (let y = roomY + 4; y < roomY + roomH - 4; y += tile) {
            const ix = Math.floor((x - roomX) / tile);
            const iy = Math.floor((y - roomY) / tile);
            if ((ix + iy) % 2 === 0) floor.fillRect(x, y, tile, tile);
        }
    }
    roomFloors[room.agent] = floor;

    // --- Walls with doorway at the bottom ---
    const wall = scene.add.graphics();
    wall.fillStyle(0x182742, 1);
    const wallTh = 6;
    // Top wall.
    wall.fillRect(roomX, roomY, roomW, wallTh);
    // Left wall.
    wall.fillRect(roomX, roomY, wallTh, roomH);
    // Right wall.
    wall.fillRect(roomX + roomW - wallTh, roomY, wallTh, roomH);
    // Bottom wall split by doorway.
    const doorGap = 64;
    const doorLeft = doorX - doorGap / 2;
    const doorRight = doorX + doorGap / 2;
    wall.fillRect(roomX, roomY + roomH - wallTh, doorLeft - roomX, wallTh);
    wall.fillRect(doorRight, roomY + roomH - wallTh, roomX + roomW - doorRight, wallTh);

    // Wall highlight.
    wall.lineStyle(1, accentColor, 0.4);
    wall.strokeRect(roomX + 1, roomY + 1, roomW - 2, roomH - 2);

    // --- Door panels (will slide open when room unlocks) ---
    const doorLeftPanel = scene.add.rectangle(doorLeft + (doorGap / 4), roomY + roomH - 4, doorGap / 2 - 4, 14, accentColor, 1).setOrigin(0.5);
    const doorRightPanel = scene.add.rectangle(doorRight - (doorGap / 4), roomY + roomH - 4, doorGap / 2 - 4, 14, accentColor, 1).setOrigin(0.5);
    doorLeftPanel.setStrokeStyle(1, 0x000000, 0.6);
    doorRightPanel.setStrokeStyle(1, 0x000000, 0.6);
    roomDoors[room.agent] = { left: doorLeftPanel, right: doorRightPanel, baseX: { left: doorLeftPanel.x, right: doorRightPanel.x }, gap: doorGap };

    // --- Corner torches ---
    drawCornerTorch(scene, roomX + 14, roomY + 14, accentColor);
    drawCornerTorch(scene, roomX + roomW - 14, roomY + 14, accentColor);

    // --- Themed furniture ---
    roomFurniture[room.agent] = drawThemedFurniture(scene, room);

    // --- Room title plaque ---
    scene.add.text(roomX + roomW / 2, roomY + 18, roomLabel, {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '9px',
        color: '#e2e8f0'
    }).setOrigin(0.5).setAlpha(0.85);
    scene.add.text(roomX + roomW / 2, roomY + 36, `${name} - ${role}`, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '10px',
        color: '#94a3b8'
    }).setOrigin(0.5);
}

function drawCornerTorch(scene, x, y, color) {
    const sconce = scene.add.graphics();
    sconce.fillStyle(0x1e293b, 1);
    sconce.fillRect(x - 3, y - 2, 6, 8);
    const flame = scene.add.circle(x, y - 6, 4, color, 0.9);
    scene.tweens.add({
        targets: flame,
        scale: { from: 0.85, to: 1.15 },
        alpha: { from: 0.65, to: 1 },
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });
}

function drawThemedFurniture(scene, room) {
    const { deskX, deskY, accentColor, theme, roomX, roomW, roomY, roomH } = room;
    const g = scene.add.container(0, 0);

    // Common desk.
    const desk = scene.add.graphics();
    desk.fillStyle(0x1e293b, 1);
    desk.fillRect(deskX, deskY, 80, 32);
    desk.lineStyle(2, accentColor, 0.85);
    desk.strokeRect(deskX, deskY, 80, 32);
    // Monitor.
    desk.fillStyle(0x020617, 1);
    desk.fillRect(deskX + 20, deskY + 6, 40, 14);
    desk.lineStyle(1, accentColor, 0.6);
    desk.strokeRect(deskX + 20, deskY + 6, 40, 14);
    // Keyboard.
    desk.fillStyle(0x334155, 1);
    desk.fillRect(deskX + 26, deskY + 24, 28, 5);
    g.add(desk);

    // Code glow on monitor.
    const code = scene.add.graphics();
    code.fillStyle(accentColor, 0.7);
    code.fillRect(deskX + 24, deskY + 10, 32, 2);
    code.fillRect(deskX + 24, deskY + 14, 22, 2);
    g.add(code);

    if (theme === 'strategy') {
        // Whiteboard with trajectory chart, back-left wall.
        const board = scene.add.graphics();
        board.fillStyle(0xf8fafc, 1);
        board.fillRect(roomX + 18, roomY + 60, 70, 50);
        board.lineStyle(2, accentColor, 0.9);
        board.strokeRect(roomX + 18, roomY + 60, 70, 50);
        // Trend line.
        board.lineStyle(2, accentColor, 1);
        board.beginPath();
        board.moveTo(roomX + 24, roomY + 100);
        board.lineTo(roomX + 40, roomY + 88);
        board.lineTo(roomX + 58, roomY + 92);
        board.lineTo(roomX + 82, roomY + 70);
        board.strokePath();
        g.add(board);
    } else if (theme === 'design') {
        // Easel with mockup, back-left wall.
        const easel = scene.add.graphics();
        easel.fillStyle(0x4c1d95, 1);
        easel.fillRect(roomX + 22, roomY + 60, 60, 50);
        easel.lineStyle(2, accentColor, 0.9);
        easel.strokeRect(roomX + 22, roomY + 60, 60, 50);
        // Hero block.
        easel.fillStyle(0xf5d0fe, 0.8);
        easel.fillRect(roomX + 28, roomY + 68, 48, 14);
        // Lines.
        easel.fillStyle(accentColor, 0.7);
        easel.fillRect(roomX + 28, roomY + 88, 38, 3);
        easel.fillRect(roomX + 28, roomY + 94, 30, 3);
        easel.fillRect(roomX + 28, roomY + 100, 22, 3);
        g.add(easel);
    } else if (theme === 'marketing') {
        // Megaphone + send-stack on back-left wall.
        const stack = scene.add.graphics();
        stack.fillStyle(0x713f12, 1);
        stack.fillRect(roomX + 18, roomY + 60, 70, 50);
        stack.lineStyle(2, accentColor, 0.9);
        stack.strokeRect(roomX + 18, roomY + 60, 70, 50);
        // Envelope.
        stack.fillStyle(0xfef9c3, 1);
        stack.fillRect(roomX + 26, roomY + 68, 54, 28);
        stack.lineStyle(1, 0x422006, 1);
        stack.strokeRect(roomX + 26, roomY + 68, 54, 28);
        stack.beginPath();
        stack.moveTo(roomX + 26, roomY + 68);
        stack.lineTo(roomX + 53, roomY + 84);
        stack.lineTo(roomX + 80, roomY + 68);
        stack.strokePath();
        g.add(stack);
    }

    return g;
}

function drawVignette(scene) {
    // Dark vignette frame to focus the eye on the playable area.
    const v = scene.add.graphics();
    v.fillStyle(0x000000, 0.5);
    v.fillRect(0, 0, WORLD_W, 28);
    v.fillRect(0, WORLD_H - 18, WORLD_W, 18);
    v.fillRect(0, 0, 18, WORLD_H);
    v.fillRect(WORLD_W - 18, 0, 18, WORLD_H);
    v.setDepth(50);
}

function addNpcIdleBob(scene, npc, room) {
    scene.tweens.add({
        targets: npc,
        y: room.npcY - 3,
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });
}

function spawnFootstepDust(scene, x, y) {
    const dust = scene.add.circle(x, y, 3, 0x94a3b8, 0.45);
    dust.setDepth(2);
    scene.tweens.add({
        targets: dust,
        alpha: 0,
        scale: 1.8,
        duration: 380,
        onComplete: () => dust.destroy()
    });
}

function createProceduralNPC(scene, x, y, name, colorVal, spriteKey) {
    const container = scene.add.container(x, y);

    if (spriteKey && scene.textures.exists(spriteKey)) {
        // Real pixel-art sprite (Polyverse pack, local-only). Frames are 32x64.
        const sprite = scene.add.sprite(0, 0, spriteKey, 0).setScale(1.5);
        const hasAnims = ensureCharacterAnims(scene, spriteKey);
        // face() picks the right anim per direction + idle/walk state.
        container.face = (dir, moving = false) => {
            if (!hasAnims) return;
            const key = `${spriteKey}_${moving ? 'walk' : 'idle'}_${dir}`;
            if (scene.anims.exists(key) && sprite.anims.currentAnim?.key !== key) {
                sprite.play(key);
            }
        };
        container.face('down', false);
        const label = scene.add.text(0, -56, name, {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '11px',
            color: '#e2e8f0',
            backgroundColor: '#0a0f1daa',
            padding: { x: 4, y: 1 }
        }).setOrigin(0.5);
        container.add([sprite, label]);
        return container;
    }

    // Procedural fallback (default - works after `git clone`).
    container.face = () => {}; // no-op for graphics fallback
    const body = scene.add.graphics();
    body.fillStyle(0x1e293b, 1);
    body.fillCircle(0, 0, 18);
    body.lineStyle(2.5, colorVal, 1);
    body.strokeCircle(0, 0, 18);
    
    const visor = scene.add.graphics();
    visor.fillStyle(colorVal, 1);
    visor.fillRect(-10, -5, 20, 6);
    
    const label = scene.add.text(0, -32, name, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '11px',
        color: '#e2e8f0',
        backgroundColor: '#0a0f1daa',
        padding: { x: 4, y: 1 }
    }).setOrigin(0.5);
    
    container.add([body, visor, label]);
    return container;
}

function createStatusBadge(scene, x, y, text, color) {
    return scene.add.text(x, y, text, {
        fontFamily: 'Share Tech Mono, monospace',
        fontSize: '10px',
        color,
        backgroundColor: '#0a0f1dcc',
        padding: { x: 6, y: 2 }
    }).setOrigin(0.5);
}

function createProceduralPlayer(scene, x, y, spriteKey) {
    const container = scene.add.container(x, y);

    if (spriteKey && scene.textures.exists(spriteKey)) {
        const sprite = scene.add.sprite(0, 0, spriteKey, 0).setScale(1.5);
        const hasAnims = ensureCharacterAnims(scene, spriteKey);
        container.face = (dir, moving = false) => {
            if (!hasAnims) return;
            const key = `${spriteKey}_${moving ? 'walk' : 'idle'}_${dir}`;
            if (scene.anims.exists(key) && sprite.anims.currentAnim?.key !== key) {
                sprite.play(key);
            }
        };
        container.face('down', false);
        // Keep setFlipX exposed for any leftover callers (no-op against real anims).
        container.setFlipX = () => {};
        const nameplate = scene.add.text(0, -56, "Foundry Player", {
            fontFamily: 'Press Start 2P, Arial',
            fontSize: '7px',
            color: '#2dd4bf',
            backgroundColor: '#0f172aaa',
            padding: { x: 3, y: 2 }
        }).setOrigin(0.5);
        container.add([sprite, nameplate]);
        scene.physics.world.enable(container);
        return container;
    }

    // Procedural fallback.
    container.face = () => {};
    container.setFlipX = () => {};
    const head = scene.add.graphics();
    head.fillStyle(0x0f172a, 1);
    head.fillCircle(0, 0, 16);
    head.lineStyle(2.5, 0x2dd4bf, 1);
    head.strokeCircle(0, 0, 16);
    
    const visor = scene.add.graphics();
    visor.fillStyle(0xffcc00, 1);
    visor.fillEllipse(0, -2, 10, 6);

    const nameplate = scene.add.text(0, -30, "Foundry Player", {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '7px',
        color: '#2dd4bf',
        backgroundColor: '#0f172aaa',
        padding: { x: 3, y: 2 }
    }).setOrigin(0.5);

    container.add([head, visor, nameplate]);
    scene.physics.world.enable(container);
    return container;
}

function createDungeonParticles(scene) {
    // Generate lovely floating coding particles across the whole world.
    scene.time.addEvent({
        delay: 70,
        callback: () => {
            const px = Phaser.Math.Between(40, WORLD_W - 40);
            const py = Phaser.Math.Between(40, WORLD_H - 40);
            const dot = scene.add.circle(px, py, Phaser.Math.Between(1, 2), 0x14b8a6, 0.18);
            scene.tweens.add({
                targets: dot,
                y: py - 50,
                alpha: 0,
                duration: 1400,
                onComplete: () => dot.destroy()
            });
        },
        loop: true
    });
}

// Pop up visual speech bubble over active character
function notifyPhaserAgentActive() {
    if (!currentGameState || !phaserSceneRef) return;
    const activeIdx = currentGameState.active_quest?.current_step_index;
    const step = currentGameState.active_quest?.steps[activeIdx];
    if (!step) return;
    
    const npcKey = step.assigned_to;
    const npc = npcs[npcKey];
    if (!npc) return;
    
    // Zoom camera on the active unit
    phaserSceneRef.cameras.main.zoomTo(1.15, 800, 'Sine.easeInOut', true);
    
    // Spawn speech bubble
    showSpeechBubble(npc.x, npc.y - 65, "Agent turn running. Watch the trace panel for handoffs and checks.");
}

function notifyPhaserAgentComplete(isSuccess) {
    if (!currentGameState || !phaserSceneRef) return;
    const activeIdx = currentGameState.active_quest?.current_step_index;
    const step = currentGameState.active_quest?.steps[activeIdx];
    if (!step) return;
    
    const npcKey = step.assigned_to;
    const npc = npcs[npcKey];
    if (!npc) return;
    
    // Zoom back
    phaserSceneRef.cameras.main.zoomTo(1, 600, 'Sine.easeInOut', true);
    
    if (isSuccess) {
        showSpeechBubble(npc.x, npc.y - 65, "Artifact complete. Review it at the verification gate.");
    } else {
        showSpeechBubble(npc.x, npc.y - 65, "Logical exception detected. Recalibrating...");
    }
}

function notifyPhaserAgentReject() {
    if (!currentGameState || !phaserSceneRef) return;
    const activeIdx = currentGameState.active_quest?.current_step_index;
    const step = currentGameState.active_quest?.steps[activeIdx];
    if (!step) return;
    
    const npcKey = step.assigned_to;
    const npc = npcs[npcKey];
    if (!npc) return;
    
    showSpeechBubble(npc.x, npc.y - 65, "Feedback noted. I will rework the artifact.");
}

function spawnPhaserXPEffect(xpAmount = 0) {
    if (!player || !phaserSceneRef) return;

    // Camera shake for impact.
    phaserSceneRef.cameras.main.shake(220, 0.004);

    // Big XP text rising.
    const text = phaserSceneRef.add.text(player.x, player.y - 50, `+${xpAmount} XP`, {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '14px',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 4
    }).setOrigin(0.5).setDepth(40);

    phaserSceneRef.tweens.add({
        targets: text,
        y: player.y - 110,
        alpha: 0,
        scale: 1.5,
        duration: 1800,
        onComplete: () => text.destroy()
    });

    // Gold spark burst.
    for (let i = 0; i < 14; i++) {
        const ang = (Math.PI * 2 * i) / 14;
        const dist = Phaser.Math.Between(30, 60);
        const spark = phaserSceneRef.add.circle(player.x, player.y - 10, 3, 0xfde047, 1).setDepth(39);
        phaserSceneRef.tweens.add({
            targets: spark,
            x: player.x + Math.cos(ang) * dist,
            y: player.y - 10 + Math.sin(ang) * dist,
            alpha: 0,
            scale: 0.2,
            duration: 700 + Math.random() * 300,
            ease: 'Cubic.easeOut',
            onComplete: () => spark.destroy()
        });
    }
}

function syncPhaserQuestState() {
    if (!currentGameState || !phaserSceneRef) return;

    const quest = currentGameState.active_quest;
    if (!quest || !quest.steps) return;

    const activeIdx = quest.current_step_index;
    const statusByAgent = {};
    quest.steps.forEach((step, idx) => {
        if (idx < activeIdx) statusByAgent[step.assigned_to] = { text: "CLEARED", color: "#34d399", alpha: 0.85 };
        else if (idx === activeIdx) statusByAgent[step.assigned_to] = { text: "ACTIVE", color: "#fbbf24", alpha: 1 };
        else statusByAgent[step.assigned_to] = { text: "LOCKED", color: "#94a3b8", alpha: 0.45 };
    });

    Object.entries(npcStatusBadges).forEach(([agentKey, badge]) => {
        const status = statusByAgent[agentKey] || { text: "LOCKED", color: "#94a3b8", alpha: 0.45 };
        badge.setText(status.text);
        badge.setColor(status.color);
        badge.setAlpha(status.alpha);
        if (npcs[agentKey]) npcs[agentKey].setAlpha(status.alpha === 0.45 ? 0.55 : 1);

        // Doors slide open for active or cleared rooms; closed when locked.
        const door = roomDoors[agentKey];
        if (door) {
            const open = status.text !== 'LOCKED';
            const offset = open ? door.gap / 2 - 4 : 0;
            phaserSceneRef.tweens.add({
                targets: door.left,
                x: door.baseX.left - offset,
                duration: 350,
                ease: 'Cubic.easeOut'
            });
            phaserSceneRef.tweens.add({
                targets: door.right,
                x: door.baseX.right + offset,
                duration: 350,
                ease: 'Cubic.easeOut'
            });
        }

        // Floor brightens for the active room.
        const floor = roomFloors[agentKey];
        if (floor) floor.setAlpha(status.text === 'ACTIVE' ? 1 : 0.7);
    });

    if (activeRoomBeacon) activeRoomBeacon.destroy();
    const activeNpc = getCurrentNpc();
    if (activeNpc) {
        activeRoomBeacon = phaserSceneRef.add.graphics();
        activeRoomBeacon.lineStyle(2, 0xfbbf24, 0.85);
        activeRoomBeacon.strokeCircle(activeNpc.x, activeNpc.y, 30);
        activeRoomBeacon.setDepth(5);
        phaserSceneRef.tweens.add({
            targets: activeRoomBeacon,
            alpha: 0.25,
            duration: 750,
            yoyo: true,
            repeat: -1
        });
    }
}

function showSpeechBubble(x, y, text) {
    if (activeNpcBubble) {
        activeNpcBubble.destroy();
    }
    if (bubbleTimer) {
        bubbleTimer.remove();
    }
    
    const bubble = phaserSceneRef.add.container(x, y);
    
    // Backdrop
    const bg = phaserSceneRef.add.graphics();
    bg.fillStyle(0x0a0f1d, 0.9);
    bg.fillRect(-100, -32, 200, 38);
    bg.lineStyle(1.5, 0x14b8a6, 0.8);
    bg.strokeRect(-100, -32, 200, 38);
    
    // Bubble arrow pointing down
    const arrow = phaserSceneRef.add.graphics();
    arrow.fillStyle(0x0a0f1d, 0.9);
    arrow.beginPath();
    arrow.moveTo(-8, 6);
    arrow.lineTo(0, 14);
    arrow.lineTo(8, 6);
    arrow.closePath();
    arrow.fillPath();
    arrow.lineStyle(1.5, 0x14b8a6, 0.8);
    arrow.beginPath();
    arrow.moveTo(-8, 6);
    arrow.lineTo(0, 14);
    arrow.lineTo(8, 6);
    arrow.strokePath();
    
    const msg = phaserSceneRef.add.text(0, -14, text, {
        fontFamily: 'Share Tech Mono, Arial',
        fontSize: '10px',
        color: '#14b8a6',
        align: 'center',
        wordWrap: { width: 180 }
    }).setOrigin(0.5);
    
    bubble.add([bg, arrow, msg]);
    activeNpcBubble = bubble;
    
    // Auto-wipe dialogue bubble after 5000ms
    bubbleTimer = phaserSceneRef.time.addEvent({
        delay: 5000,
        callback: () => {
            if (activeNpcBubble === bubble) {
                bubble.destroy();
                activeNpcBubble = null;
            }
        }
    });
}

// Local collision checks if the player gets near the active agent desk.
function checkProximityDialogues(scene) {
    if (!currentGameState || !player) return;
    const step = getCurrentActiveStep();
    if (!step) return;
    
    const activeNpcKey = step.assigned_to;
    const npc = npcs[activeNpcKey];
    if (!npc) return;
    
    refreshActiveAgentProximity();
    const isNearNow = isPlayerNearActiveAgent;

    // If player stands near current active agent desk and speech balloon is dormant.
    if (isNearNow && !activeNpcBubble && lastNearAgentKey !== activeNpcKey) {
        const msg = AGENT_DIALOGUE[activeNpcKey] || "Press E to run this agent turn.";
        showSpeechBubble(npc.x, npc.y - 65, msg);
        lastNearAgentKey = activeNpcKey;
    }

    if (!isNearNow && lastNearAgentKey === activeNpcKey) {
        lastNearAgentKey = null;
    }
}

// Initial pull on window load
window.addEventListener("DOMContentLoaded", initClient);
