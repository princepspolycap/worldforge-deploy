// Party hand component: renders the held worker cards that float above the
// footer. State, evidence, and economics stay in story.js; this module owns the
// card markup so spacing/face changes have one component boundary.

export function renderPartyHand({
    members,
    activeKey,
    activeName,
    line,
    flippedOwner,
    cardEvidence,
    rolePortrait,
    roleName,
    isGameMaster,
    partyMetricMarkup,
    partyCardEvidence,
    dossierBackHTML,
    clamp,
    esc,
}) {
    return (members || []).map((member) => {
        const active = member.key === activeKey
            || member.role === activeKey
            || member.name === activeName
            || member.name === activeKey;
        const done = member.status === "completed";
        const portrait = rolePortrait[member.role] || "narrator";
        const statusLine = active
            ? (line || "working with you")
            : done
                ? "sealed - receipts ready"
                : (member.title || "waiting for the brief");
        const hasCard = !!cardEvidence[member.name];
        const score = hasCard ? clamp(cardEvidence[member.name].score) : null;
        const gm = isGameMaster(member.role);
        const flipped = member.name === flippedOwner;

        return `<div class="party-agent${active ? " active" : ""}${done ? " done" : ""}${flipped ? " flipped" : ""}"`
            + ` data-owner="${esc(member.name)}" role="button" tabindex="0" aria-pressed="${flipped ? "true" : "false"}"`
            + ` title="${esc(member.name)} - open receipts, press Space to flip this card">`
            + `<div class="pa-inner">`
            + `<div class="pa-face pa-front">`
            + `<div class="pa-layer ${gm ? "gm" : "dw"}">${gm ? "Game Master" : "Digital Worker"}</div>`
            + `<img class="party-face" src="/game/assets/generated/${portrait}.png" alt="" onerror="this.style.display='none'" />`
            + `<div class="party-name">${esc(member.name)}</div>`
            + `<div class="party-role">${esc(roleName[member.role] || member.role || "agent")}</div>`
            + partyMetricMarkup(member)
            + `<div class="party-line">${esc(statusLine).slice(0, 110)}</div>`
            + `<div class="party-badge">${hasCard ? `receipts &middot; ${score}/100` : `open receipts`}</div>`
            + `</div>`
            + `<div class="pa-face pa-back">${dossierBackHTML(partyCardEvidence(member))}</div>`
            + `</div></div>`;
    }).join("");
}
