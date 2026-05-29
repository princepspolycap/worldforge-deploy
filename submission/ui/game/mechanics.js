// Shared sprite-game mechanics for the no-bundler Phaser shell.
// This file is intentionally data-first so quest rooms, NPCs, and automation can
// move out of the prototype orchestrator without changing the backend contract.
(function registerDungeonGameMechanics(global) {
    const spriteKeys = {
        player: 'player_sheet',
        strategist: 'npc_strategist',
        designer: 'npc_designer',
        marketer: 'npc_marketer',
    };

    const dirFrames = {
        idle: { left: 2, up: 1, right: 0, down: 3 },
        walk: {
            left: [68, 69, 70, 71, 72, 73],
            up: [62, 63, 64, 65, 66, 67],
            right: [56, 57, 58, 59, 60, 61],
            down: [74, 75, 76, 77, 78, 79],
        },
    };

    const roomSequence = [
        {
            agent: 'strategist',
            name: 'Soren',
            role: 'Strategist',
            roomName: 'Blueprint Room',
            roomLabel: 'BLUEPRINT ROOM',
            roomX: 30,
            roomY: 40,
            roomW: 280,
            roomH: 400,
            roomColor: 0x0284c7,
            floorTint: 0x0e2238,
            deskX: 110,
            deskY: 200,
            deskColor: 0x0284c7,
            npcX: 170,
            npcY: 220,
            statusY: 270,
            approachX: 170,
            approachY: 300,
            doorX: 170,
            doorY: 440,
            accentColor: 0x38bdf8,
            theme: 'strategy',
            dialogue: 'I have the positioning room primed. Press E to run the strategy turn.',
        },
        {
            agent: 'designer',
            name: 'Dahlia',
            role: 'Designer',
            roomName: 'UX Lab',
            roomLabel: 'UX LAB',
            roomX: 340,
            roomY: 40,
            roomW: 280,
            roomH: 400,
            roomColor: 0x8b5cf6,
            floorTint: 0x1d1538,
            deskX: 420,
            deskY: 200,
            deskColor: 0x8b5cf6,
            npcX: 480,
            npcY: 220,
            statusY: 270,
            approachX: 480,
            approachY: 300,
            doorX: 480,
            doorY: 440,
            accentColor: 0xc084fc,
            theme: 'design',
            dialogue: 'The layout board is ready. Press E to turn positioning into a page.',
        },
        {
            agent: 'marketer',
            name: 'Maddox',
            role: 'Marketer',
            roomName: 'Outreach Core',
            roomLabel: 'OUTREACH CORE',
            roomX: 650,
            roomY: 40,
            roomW: 280,
            roomH: 400,
            roomColor: 0xeab308,
            floorTint: 0x2b2410,
            deskX: 730,
            deskY: 200,
            deskColor: 0xeab308,
            npcX: 790,
            npcY: 220,
            statusY: 270,
            approachX: 790,
            approachY: 300,
            doorX: 790,
            doorY: 440,
            accentColor: 0xfde047,
            theme: 'marketing',
            dialogue: 'Campaign channels are open. Press E to draft the launch copy.',
        },
    ];

    const agents = roomSequence.reduce((acc, room) => {
        acc[room.agent] = { name: room.name, room: room.roomName, role: room.role };
        return acc;
    }, {});

    const dialogue = roomSequence.reduce((acc, room) => {
        acc[room.agent] = room.dialogue;
        return acc;
    }, {});

    const tierStyles = {
        gold: { color: '#fde047', border: 'border-yellow-400/60', text: 'text-yellow-300', label: 'GOLD x2.0' },
        silver: { color: '#cbd5f5', border: 'border-slate-300/60', text: 'text-slate-100', label: 'SILVER x1.5' },
        bronze: { color: '#fb923c', border: 'border-orange-500/60', text: 'text-orange-300', label: 'BRONZE x1.0' },
    };

    function getRoom(agentKey) {
        return roomSequence.find((room) => room.agent === agentKey) || null;
    }

    function getApproachPoint(agentKey) {
        const room = getRoom(agentKey);
        if (!room) return null;
        return { x: room.approachX, y: room.approachY };
    }

    function getWalkDirection(dx, dy, deadZone = 0) {
        if (Math.abs(dx) <= deadZone && Math.abs(dy) <= deadZone) return null;
        if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx < -deadZone) return 'left';
            if (dx > deadZone) return 'right';
        }
        if (dy < -deadZone) return 'up';
        if (dy > deadZone) return 'down';
        return null;
    }

    function getTierForScore(score) {
        if (score >= 95) return 'gold';
        if (score >= 80) return 'silver';
        return 'bronze';
    }

    global.DUNGEON_GAME_MECHANICS = Object.freeze({
        spriteKeys,
        dirFrames,
        roomSequence,
        agents,
        dialogue,
        tierStyles,
        getRoom,
        getApproachPoint,
        getWalkDirection,
        getTierForScore,
    });
})(window);