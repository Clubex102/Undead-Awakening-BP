import { world, system, GameMode } from "@minecraft/server";

const RAID_ITEM_ID = "udaw:raid_bottle";
const RAID_SCAN_RANGE = 100;
const WAVE_REST_TICKS = 600;
const RAID_SPAWN_EFFECT_TICKS = 70;
const RAID_SPAWN_ANIMATION = "animation.zombie.spawn";

const INFANTRY_UNITS = [
    "udaw:zombiecomun",
    "udaw:zombierange",
    "udaw:zombie_lance"
];

const SPECIALIST_UNITS = [
    "udaw:zombieminer",
    "udaw:zombiewc",
    "udaw:zombie_igniter",
    "udaw:plzombie",
    "udaw:zombie_shovel"
];

const ELITE_UNITS = [
    "udaw:pillagerzombie",
    "udaw:vindicatorzombie"
];

const DEBUG = false; // esta madre es para detectar error, debe estar en false si no es para testeo

const state = {
    active: false,
    player: null,
    waveIndex: 0,
    livingInWave: new Set(),
    waveSpawned: 0,
    trackedEntities: new Set()
};

// internal control flags
state.waitingNext = false; // true while resting between waves
state.nextWaveScheduled = false; // avoid double-scheduling next wave
state.lastBroadcastTick = 0;
state.lastRemainingCount = -1;

// Admin names allowed to cancel the raid (add your in-game name here if needed)
const ALLOWED_ADMINS = [];

function randomChoice(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function findGround(dimension, x, startY, z) {
    for (let y = startY; y > -64; y--) {
        const block = dimension.getBlock({
            x: Math.floor(x),
            y: Math.floor(y),
            z: Math.floor(z)
        });

        if (!block) continue;
        if (block.typeId !== "minecraft:air") {
            return y + 1;
        }
    }

    return startY;
}

function isEntityValid(entity) {
    try {
        if (!entity) return false;
        if (typeof entity.isValid === "function") return entity.isValid();
        return true;
    } catch {
        return !!entity;
    }
}

function announce(player, message) {
    try {
        const cleanMessage = message.replace(/§[0-9a-fk-or]/g, "");
        player?.runCommand(`title @s actionbar ${cleanMessage}`);
    } catch {}

    try {
        player?.sendMessage(message);
    } catch {}
}

function applyRaidSpawnEffects(entity) {
    if (!isEntityValid(entity)) return;

    const applyEffects = () => {
        try {
            if (!isEntityValid(entity)) return;
            entity.playAnimation(RAID_SPAWN_ANIMATION);
        } catch {}

        try {
            if (!isEntityValid(entity)) return;
            entity.addEffect("minecraft:slowness", RAID_SPAWN_EFFECT_TICKS, {
                amplifier: 255,
                showParticles: false
            });
            entity.addEffect("minecraft:weakness", RAID_SPAWN_EFFECT_TICKS, {
                amplifier: 255,
                showParticles: false
            });
            entity.addEffect("minecraft:resistance", RAID_SPAWN_EFFECT_TICKS, {
                amplifier: 255,
                showParticles: false
            });
        } catch {}
    };

    applyEffects();
    system.runTimeout(applyEffects, 2);

    system.runTimeout(() => {
        try {
            if (!isEntityValid(entity)) return;
            entity.removeEffect("minecraft:slowness");
            entity.removeEffect("minecraft:weakness");
            entity.removeEffect("minecraft:resistance");
        } catch {}
    }, RAID_SPAWN_EFFECT_TICKS + 2);
}

function getNearbyPlayers(player) {
    const center = player.location;
    const result = [];

    for (const candidate of world.getPlayers()) {
        if (candidate.dimension?.id !== player.dimension?.id) continue;

        const dx = candidate.location.x - center.x;
        const dy = candidate.location.y - center.y;
        const dz = candidate.location.z - center.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;

        if (distanceSq <= RAID_SCAN_RANGE * RAID_SCAN_RANGE) {
            result.push(candidate);
        }
    }

    return result;
}

function getScalingMultiplier(player) {
    const nearby = getNearbyPlayers(player);
    const count = Math.max(1, nearby.length);
    return 1 + (count - 1) * 0.3;
}

function getWaveCounts(player) {
    const multiplier = getScalingMultiplier(player);

    return {
        1: {
            infantry: Math.max(12, Math.round(12 * multiplier))
        },
        2: {
            infantry: Math.max(12, Math.round(12 * multiplier)),
            specialists: Math.max(4, Math.round(4 * multiplier))
        },
        3: {
            infantry: Math.max(12, Math.round(12 * multiplier)),
            specialists: Math.max(6, Math.round(6 * multiplier)),
            tnt: 1,
            plZombie: 1
        },
        4: {
            infantry: Math.max(12, Math.round(12 * multiplier)),
            specialists: Math.max(6, Math.round(6 * multiplier)),
            tnt: 1,
            plZombie: 1,
            elites: Math.max(5, Math.round(5 * multiplier))
        },
        5: {
            infantry: Math.max(12, Math.round(12 * multiplier)),
            specialists: Math.max(8, Math.round(8 * multiplier)),
            tnt: 1,
            plZombie: 1,
            cuirassiers: Math.max(2, Math.round(2 * multiplier))
        }
    };
}

function spawnRaidEntity(dimension, base, entityId) {
    const angle = Math.random() * Math.PI * 2;
    const distance = randomBetween(12, 24);
    const x = base.x + Math.cos(angle) * distance;
    const z = base.z + Math.sin(angle) * distance;
    const y = findGround(dimension, x, base.y + 40, z);

    try {
        const entity = dimension.spawnEntity(entityId, { x, y, z });
        if (!isEntityValid(entity)) return null;

        try {
            entity.addTag("udaw_raid_zombie");
        } catch {}

        applyRaidSpawnEffects(entity);

        return entity;
    } catch {
        return null;
    }
}

function getAnnouncePlayer() {
    // prefer state.player if valid
    if (isEntityValid(state.player)) return state.player;
    // fallback: find any player near the raid origin
    if (state.origin) {
        for (const p of world.getPlayers()) {
            try {
                if (p.dimension?.id !== state.origin.dimension) continue;
                const dx = p.location.x - state.origin.x;
                const dy = p.location.y - state.origin.y;
                const dz = p.location.z - state.origin.z;
                if (dx * dx + dy * dy + dz * dz <= RAID_SCAN_RANGE * RAID_SCAN_RANGE) return p;
            } catch {}
        }
    }
    // last resort: any online player
    return world.getPlayers()[0] || null;
}

function broadcastWaveStatus(player, opts = {}) {
    try {
        const { suppressChat = false, force = false } = opts;
        const tick = system.currentTick || 0;
        const remaining = state.livingInWave.size;

        // throttle: only send if remaining changed or > 40 ticks passed unless forced
        if (!force && remaining === state.lastRemainingCount && tick - state.lastBroadcastTick < 40) return;
        state.lastRemainingCount = remaining;
        state.lastBroadcastTick = tick;

        const wave = state.waveIndex;
        const text = `§eOleada ${wave}: quedan ${remaining} muertos.`;

        if (suppressChat) {
            // actionbar only for nearby players, avoid chat spam
            try { player.runCommand(`title @s actionbar ${text.replace(/§[0-9a-fk-or]/g, "")}`); } catch {}
            for (const p of getNearbyPlayers(player)) {
                try { p.runCommand(`title @s actionbar ${text.replace(/§[0-9a-fk-or]/g, "")}`); } catch {}
            }
            return;
        }

        // normal behavior: actionbar + chat to player, chat to nearby others (avoid duplicating to the activating player)
        announce(player, text);
        for (const p of getNearbyPlayers(player)) {
            try {
                if (p.id === player.id) continue;
                p.sendMessage(text);
            } catch {}
        }
    } catch {}
}

function refreshLivingSet() {
    try {
        if (!state.active || !isEntityValid(state.player)) return;
        if (state.waitingNext) return;
        const dim = state.player.dimension;
        const loc = state.player.location;
        const found = dim.getEntities({
            location: loc,
            maxDistance: RAID_SCAN_RANGE,
            tags: ["udaw_raid_zombie"],
            excludeTypes: ["minecraft:item", "minecraft:xp_orb"]
        }) || [];

        const foundIds = new Set(found.map(e => e.id).filter(Boolean));

        // Replace livingInWave with actual living ids near the player
        state.livingInWave = new Set(foundIds);

        // Keep trackedEntities as union
        for (const id of foundIds) state.trackedEntities.add(id);

        // update spawned count to reflect live ones
        state.waveSpawned = state.livingInWave.size;

        // broadcast status silently from refresh
        try { broadcastWaveStatus(state.player, { suppressChat: true }); } catch {}

        // if none left, advance (but avoid double-scheduling)
        if (state.livingInWave.size <= 0 && !state.nextWaveScheduled) {
            completeWave(state.player);
        }
    } catch {}
}

// run periodic refresh to avoid stale counts (every 40 ticks ~2s)
system.runInterval(() => {
    try {
        if (!state.active) return;
        refreshLivingSet();
    } catch {}
}, 40);

function scheduleCountdown(player, totalSeconds) {
    try {
        if (!player) return;
        const announceTimes = [30, 20, 10, 5, 4, 3, 2, 1];
        for (const s of announceTimes) {
            if (s > totalSeconds) continue;
            const delayTicks = (totalSeconds - s) * 20;
            system.runTimeout(((sec) => {
                return () => {
                    try {
                        const announcer = getAnnouncePlayer();
                        if (!state.active || !announcer) return;
                        const text = sec > 5 ? `§6La siguiente oleada en ${sec}s...` : `§6${sec}...`;
                        announce(announcer, text);
                        for (const p of getNearbyPlayers(announcer)) {
                            try { if (p.id === announcer.id) continue; p.sendMessage(text); } catch {}
                        }
                    } catch {}
                };
            })(s), delayTicks);
        }
    } catch {}
}

function startWave(player, waveNumber) {
    if (!isEntityValid(player)) return;

    const dimension = player.dimension;
    const base = player.location;
    const counts = getWaveCounts(player)[waveNumber];

    // prepare wave state
    state.active = true;
    state.player = player;
    state.waveIndex = waveNumber;
    state.livingInWave = new Set();
    state.waveSpawned = 0;
    state.trackedEntities = new Set();
    state.origin = { dimension: dimension.id, x: base.x, y: base.y, z: base.z };
    state.waitingNext = false;
    state.nextWaveScheduled = false;
    state.waitingNext = false;
    state.nextWaveScheduled = false;

    announce(player, `§4La oleada ${waveNumber} ha empezado.`);

    const register = (entity) => {
        if (!isEntityValid(entity)) return;
        const entityId = entity.id;
        if (!entityId) return;
        state.livingInWave.add(entityId);
        state.trackedEntities.add(entityId);
        state.waveSpawned += 1;
    };

    // announce initial status after spawns start
    system.runTimeout(() => {
        try { broadcastWaveStatus(player); } catch {}
    }, 10);

    for (let i = 0; i < counts.infantry; i++) {
        register(spawnRaidEntity(dimension, base, randomChoice(INFANTRY_UNITS)));
    }

    if (waveNumber >= 2) {
        for (let i = 0; i < counts.specialists; i++) {
            register(spawnRaidEntity(dimension, base, randomChoice(SPECIALIST_UNITS)));
        }

        for (let i = 0; i < counts.tnt; i++) {
            register(spawnRaidEntity(dimension, base, "udaw:zombie_igniter"));
        }

        for (let i = 0; i < counts.plZombie; i++) {
            register(spawnRaidEntity(dimension, base, "udaw:plzombie"));
        }
    }

    if (waveNumber >= 4) {
        for (let i = 0; i < counts.elites; i++) {
            register(spawnRaidEntity(dimension, base, randomChoice(ELITE_UNITS)));
        }
    }

    if (waveNumber === 5) {
        for (let i = 0; i < counts.cuirassiers; i++) {
            register(spawnRaidEntity(dimension, base, "udaw:zombie_cuirassier"));
        }
    }

    if (state.waveSpawned <= 0) {
        finishRaid(player);
    }
}

function finishRaid(player) {
    state.active = false;
    state.player = null;
    state.waveIndex = 0;
    state.livingInWave = new Set();
    state.waveSpawned = 0;
    state.trackedEntities = new Set();

    try {
        player?.sendMessage("§aLa raid de muertos ha cedido.");
    } catch {}
}

function advanceRaid(player) {
    if (!isEntityValid(player)) return;

    if (state.active) {
        announce(player, "§cYa hay una raid activa. No hay tiempo para dudar.");
        return;
    }

    announce(player, "§4Los Muertos Han Llegado.");

    system.runTimeout(() => {
        if (!isEntityValid(player)) return;
        startWave(player, 1);
    }, 20);
}

function completeWave(player) {
    if (!state.active) return;

    const announcer = getAnnouncePlayer();
    if (DEBUG && announcer) {
        try { announcer.sendMessage(`DEBUG: completeWave called. wave=${state.waveIndex}, living=${state.livingInWave.size}`); } catch {}
    }

    if (announcer) announce(announcer, `§aLa oleada ${state.waveIndex} ah cedido.`);

    if (state.waveIndex >= 5) {
        finishRaid(announcer || player);
        return;
    }

    // schedule next wave once, set waiting flag to avoid reentrancy
    if (state.nextWaveScheduled) return;
    state.nextWaveScheduled = true;
    state.waitingNext = true;

    // schedule countdown messages and the start
    scheduleCountdown(announcer, 30);

    // actually start after rest
    system.runTimeout(() => {
        if (!state.active) return;
        const starter = getAnnouncePlayer() || announcer || player;
        state.waitingNext = false;
        state.nextWaveScheduled = false;
        startWave(starter, state.waveIndex + 1);
    }, WAVE_REST_TICKS + 20);
}

world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;

    if (!player || !item || item.typeId !== RAID_ITEM_ID) return;

    if (state.active) {
        announce(player, "§cYa hay una raid activa. No hay tiempo para dudar.");
        return;
    }

    event.cancel = true;

    try {
        player.runCommand(`clear @s ${RAID_ITEM_ID} 0 1`);
    } catch {}

    system.runTimeout(() => {
        if (!isEntityValid(player)) return;
        advanceRaid(player);
    }, 1);
});

function cancelRaid(player) {
    if (!isEntityValid(player)) return;
    const name = player.name || player.getName?.() || "";
    const isAdminName = ALLOWED_ADMINS.includes(name);
    const isCreative = (typeof player.getGameMode === "function" && player.getGameMode() === GameMode.Creative);
    const hasAdminTag = player.hasTag?.("admin") || player.hasTag?.("op") || player.hasTag?.("udaw_admin");

    if (!isAdminName && !isCreative && !hasAdminTag) {
        announce(player, "§cSolo los administradores pueden cancelar la raid.");
        return;
    }

    if (!state.active) {
        announce(player, "§cNo hay ninguna raid activa.");
        return;
    }

    announce(player, "§4La raid ha sido cancelada por un administrador.");
    finishRaid(player);
}

world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (!isEntityValid(entity)) return;

    const entityId = entity.id;
    if (!entityId) return;
    if (!state.active || !isEntityValid(state.player)) return;
    if (!state.livingInWave.has(entityId) && !state.trackedEntities.has(entityId)) return;

    state.livingInWave.delete(entityId);
    state.trackedEntities.delete(entityId);
    state.waveSpawned = Math.max(0, state.waveSpawned - 1);

    if (DEBUG) {
        const dbg = getAnnouncePlayer();
        try { dbg?.sendMessage(`DEBUG: entityDie id=${entityId} remaining=${state.livingInWave.size}`); } catch {}
    }

    // announce remaining (silent from death to avoid double chat flood)
    try { broadcastWaveStatus(getAnnouncePlayer(), { suppressChat: false, force: true }); } catch {}

    // use livingInWave.size to determine completion
    if (state.livingInWave.size <= 0) {
        completeWave(getAnnouncePlayer() || state.player);
    }
});

world.afterEvents.scriptEventReceive.subscribe((event) => {
    const player = event.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;
    if (event.id !== "udaw:cancel_raid") return;

    cancelRaid(player);
});

// Chat-based admin cancel command: /cancelraid or !cancelraid
try {
    world.beforeEvents.chatSend.subscribe((event) => {
        try {
            const sender = event.sender;
            const msg = (event.message || "").trim();
            if (!sender || sender.typeId !== "minecraft:player") return;
            if (msg === "/cancelraid" || msg === "!cancelraid") {
                event.cancel = true;
                cancelRaid(sender);
            }
        } catch {}
    });
} catch {}
