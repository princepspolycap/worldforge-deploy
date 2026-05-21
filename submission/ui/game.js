// Phaser + Web client orchestrator for "Your Company Is the Dungeon"

let phaserGame = null;
let currentGameState = null;

// Core API endpoints
const API_BASE = "/api";

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
const reasoningLoader = document.getElementById("reasoning-loader");

const valScoreBox = document.getElementById("validation-score-box");
const checkingScore = document.getElementById("checking-score");
const failsList = document.getElementById("fails-list");
const artifactContentArea = document.getElementById("artifact-content-area");

const gatePanel = document.getElementById("gate-panel");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const terminalLogs = document.getElementById("terminal-logs");

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
}

function showGameScreen() {
    launcherView.classList.add("hidden");
    gameView.classList.remove("hidden");
    sidebarView.classList.remove("hidden");
    statusPanel.classList.remove("hidden");
    resetBtn.classList.remove("hidden");
    
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
                artifactContentArea.innerHTML = `
                    <div class="h-full flex flex-col items-center justify-center text-slate-500">
                        <span>No artifact generated yet.</span>
                        <span class="text-[10px] mt-1 text-slate-600">Run the reasoning loop above to deploy Soren, Dahlia or Maddox!</span>
                    </div>
                `;
            }
        } else {
            // Quest Completed!
            triggerPanel.classList.add("hidden");
            gatePanel.classList.add("hidden");
            valScoreBox.classList.add("hidden");
            artifactContentArea.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center text-teal-400 text-center p-4">
                    <span class="text-3xl mb-2">🏆</span>
                    <span class="pixel-font-title text-xs mb-1">QUEST LINE ACCOMPLISHED</span>
                    <span class="text-[10px] text-slate-400 max-w-xs leading-normal font-mono">You successfully validated target positioning, designed layouts, and published emails. Venture Stage: Validated!</span>
                </div>
            `;
        }
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
runStepBtn.addEventListener("click", async () => {
    runStepBtn.disabled = true;
    reasoningLoader.classList.remove("hidden");
    
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
        runStepBtn.disabled = false;
        reasoningLoader.classList.add("hidden");
    }
});

// Approve step
approveBtn.addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_BASE}/step/approve`, { method: "POST" });
        const data = await res.json();
        
        // Spawn XP popping effect in Phaser!
        spawnPhaserXPEffect();
        
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

// PHASER CANVAS WORLD INTEGRATION
let phaserSceneRef = null;

function initPhaser() {
    const config = {
        type: Phaser.AUTO,
        parent: 'canvas-container',
        width: 800,
        height: 360,
        backgroundColor: '#0a0f1d',
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0 },
                debug: false
            }
        },
        scene: {
            create: phaserCreate,
            update: phaserUpdate
        }
    };
    return new Phaser.Game(config);
}

let player = null;
let nameplates = {};
let npcs = {};
let cursors = null;
let activeNpcBubble = null;
let bubbleTimer = null;

function phaserCreate() {
    phaserSceneRef = this;
    
    // 1. Draw a retro-chic modular isometric/grid layout
    const gridGraphics = this.add.graphics();
    gridGraphics.lineStyle(1, 0x14b8a6, 0.08);
    for (let x = 0; x < 800; x += 32) {
        gridGraphics.lineBetween(x, 0, x, 360);
    }
    for (let y = 0; y < 360; y += 32) {
        gridGraphics.lineBetween(0, y, 800, y);
    }
    
    // Draw 3 customized corporate rooms/mats
    // Soren's Room (Strategy Warroom) - Blue
    drawRoomMat(this, 80, 50, 200, 260, 0x0284c7, "Soren (Strategist)", "BLUEPRINT ROOM");
    // Dahlia's Room (Design Lab) - Magenta
    drawRoomMat(this, 300, 50, 200, 260, 0x8b5cf6, "Dahlia (Designer)", "UX LAB");
    // Maddox's Room (Marketing Hive) - Orange
    drawRoomMat(this, 520, 50, 200, 260, 0xeab308, "Maddox (Marketer)", "OUTREACH CORE");

    // Connect them with a hallway
    const hallway = this.add.graphics();
    hallway.fillStyle(0x0f172a, 1);
    hallway.fillRect(40, 180, 720, 48);
    hallway.lineStyle(2, 0x334155, 1);
    hallway.strokeRect(40, 180, 720, 48);

    // 2. Draw desks and office accessories
    drawOfficeDesk(this, 120, 100, 0x0284c7);
    drawOfficeDesk(this, 340, 100, 0x8b5cf6);
    drawOfficeDesk(this, 560, 100, 0xeab308);

    // 3. Create NPCs
    npcs.strategist = createProceduralNPC(this, 180, 120, "Soren", 0x38bdf8);
    npcs.designer = createProceduralNPC(this, 400, 120, "Dahlia", 0xc084fc);
    npcs.marketer = createProceduralNPC(this, 620, 120, "Maddox", 0xfde047);

    // 4. Create Player
    player = createProceduralPlayer(this, 100, 200);

    // Controls setup
    cursors = this.input.keyboard.createCursorKeys();
    
    // Create floating tech particle generators for a high-intelligence feel!
    createDungeonParticles(this);
}

function phaserUpdate() {
    if (!player) return;
    
    // Smooth control inputs
    player.body.setVelocity(0);
    const speed = 160;
    
    if (cursors.left.isDown) {
        player.body.setVelocityX(-speed);
        player.setData("facing", "left");
    } else if (cursors.right.isDown) {
        player.body.setVelocityX(speed);
        player.setData("facing", "right");
    }
    
    if (cursors.up.isDown) {
        player.body.setVelocityY(-speed);
    } else if (cursors.down.isDown) {
        player.body.setVelocityY(speed);
    }
    
    // Collide edges
    player.x = Phaser.Math.Clamp(player.x, 30, 770);
    player.y = Phaser.Math.Clamp(player.y, 30, 330);
    
    // Walk animation (small scale/rotation oscillation)
    if (player.body.velocity.x !== 0 || player.body.velocity.y !== 0) {
        player.setScale(1 + Math.sin(this.time.now * 0.015) * 0.05);
        player.angle = Math.sin(this.time.now * 0.01) * 3;
    } else {
        player.setScale(1);
        player.angle = 0;
    }
    
    // Proximity dialogues
    checkProximitydialogues(this);
}

// Draw a beautiful tech carpet under each department
function drawRoomMat(scene, x, y, w, h, color, title, label) {
    const carpet = scene.add.graphics();
    carpet.fillStyle(color, 0.1);
    carpet.fillRect(x, y, w, h);
    carpet.lineStyle(2, color, 0.4);
    carpet.strokeRect(x, y, w, h);
    
    // Add cool glowing room title
    scene.add.text(x + 10, y + 10, title, {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '8px',
        color: '#ffffff'
    }).setAlpha(0.7);
    
    scene.add.text(x + 10, y + h - 18, label, {
        fontFamily: 'Share Tech Mono, Arial',
        fontSize: '9px',
        color: '#14b8a6'
    }).setAlpha(0.5);
}

// Procedural visual components (No PNG weights necessary!)
function drawOfficeDesk(scene, x, y, themeColor) {
    const table = scene.add.graphics();
    table.fillStyle(0x1e293b, 1);
    table.fillRect(x, y, 54, 32);
    table.lineStyle(1.5, themeColor, 0.8);
    table.strokeRect(x, y, 54, 32);
    
    // Monitor screen
    table.fillStyle(0x0f172a, 1);
    table.fillRect(x + 12, y + 4, 30, 10);
    table.lineStyle(1, 0x14b8a6, 0.6);
    table.strokeRect(x + 12, y + 4, 30, 10);
    
    // Green code glowing on monitors
    const code = scene.add.graphics();
    code.fillStyle(0x10b981, 0.6);
    code.fillRect(x + 15, y + 7, 24, 4);
    
    // Keyboard
    table.fillStyle(0x334155, 1);
    table.fillRect(x + 18, y + 20, 18, 6);
}

function createProceduralNPC(scene, x, y, name, colorVal) {
    const container = scene.add.container(x, y);
    
    // Body (isometric round look)
    const body = scene.add.graphics();
    body.fillStyle(0x1e293b, 1);
    body.fillCircle(0, 0, 18);
    body.lineStyle(2.5, colorVal, 1);
    body.strokeCircle(0, 0, 18);
    
    // Face details / glowing spectacles or visor the wizard/agent has
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

function createProceduralPlayer(scene, x, y) {
    const container = scene.add.container(x, y);
    
    // Astronaut Helmet / Golden Shield
    const head = scene.add.graphics();
    head.fillStyle(0x0f172a, 1);
    head.fillCircle(0, 0, 16);
    head.lineStyle(2.5, 0x2dd4bf, 1);
    head.strokeCircle(0, 0, 16);
    
    const visor = scene.add.graphics();
    visor.fillStyle(0xffcc00, 1); // Yellow-gold shiny visor
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
    // Generate lovely floating coding particles
    const emitter = scene.add.graphics();
    scene.time.addEvent({
        delay: 50,
        callback: () => {
            const px = Phaser.Math.Between(50, 750);
            const py = Phaser.Math.Between(50, 310);
            
            const dot = scene.add.circle(px, py, Phaser.Math.Between(1, 3), 0x14b8a6, 0.15);
            scene.tweens.add({
                targets: dot,
                y: py - 40,
                alpha: 0,
                duration: 1200,
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
    showSpeechBubble(npc.x, npc.y - 65, "Orchestrating raw logic... Calculating parameters!");
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
        showSpeechBubble(npc.x, npc.y - 65, "Artifact complete! Ready for Review ⚡");
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
    
    showSpeechBubble(npc.x, npc.y - 65, "Feedback noted! Restructuring copy copy.");
}

function spawnPhaserXPEffect() {
    if (!player || !phaserSceneRef) return;
    
    // Level Up / XP golden text
    const text = phaserSceneRef.add.text(player.x, player.y - 45, "+20 XP ✨", {
        fontFamily: 'Press Start 2P, Arial',
        fontSize: '12px',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 3
    }).setOrigin(0.5);
    
    // Float upwards
    phaserSceneRef.tweens.add({
        targets: text,
        y: player.y - 95,
        alpha: 0,
        scale: 1.4,
        duration: 2000,
        onComplete: () => text.destroy()
    });
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

// Local collision checks if character gets near the corporate wizard desks
function checkProximitydialogues(scene) {
    if (!currentGameState || !player) return;
    const activeIdx = currentGameState.active_quest?.current_step_index;
    const step = currentGameState.active_quest?.steps[activeIdx];
    if (!step) return;
    
    const activeNpcKey = step.assigned_to;
    const npc = npcs[activeNpcKey];
    if (!npc) return;
    
    const dist = Phaser.Math.Distance.Between(player.x, player.y, npc.x, npc.y);
    // If player stands near current active agent desk and speech balloon is dormant
    if (dist < 55 && !activeNpcBubble) {
        let msg = "Hello! Click the side-panel button to formulate our company strategy!";
        if (activeNpcKey === "designer") msg = "Hey look, I'm analyzing wireframes to build a conversion layout!";
        if (activeNpcKey === "marketer") msg = "Drafting conversion email loops ground in product benefits.";
        
        showSpeechBubble(npc.x, npc.y - 65, msg);
    }
}

// Initial pull on window load
window.addEventListener("DOMContentLoaded", initClient);
