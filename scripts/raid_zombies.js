import { world, system, GameMode, EquipmentSlot } from "@minecraft/server";
import * as MC from "@minecraft/server";

const RAID_ITEM_ID = "udaw:raid_bottle";
const RAID_SCAN_RANGE = 120;
const WAVE_REST_TICKS = 600;
const RAID_SPAWN_EFFECT_TICKS = 70;
const RAID_SPAWN_ANIMATION = "animation.zombie.spawn";

const ZOMBIE_COMUN = "udaw:zombiecomun";
const ZOMBIE_RANGE = "udaw:zombierange";
const ZOMBIE_LANCE = "udaw:zombie_lance";
const ZOMBIE_MINER = "udaw:zombieminer";
const ZOMBIE_WC = "udaw:zombiewc";
const ZOMBIE_IGNITER = "udaw:zombie_igniter";
const PL_ZOMBIE = "udaw:plzombie";
const ZOMBIE_SHOVEL = "udaw:zombie_shovel";
const PILLAGER_ZOMBIE = "udaw:pillagerzombie";
const VINDICATOR_ZOMBIE = "udaw:vindicatorzombie";
const EVOCATOR_ZOMBIE = "udaw:evocatorzombie";
const ZOMBIE_CUIRASSIER = "udaw:zombie_cuirassier";

const INFANTRY_UNITS = [ZOMBIE_COMUN, ZOMBIE_RANGE, ZOMBIE_LANCE];
const INFANTRY_WEIGHTS = [7, 1, 2];
const SPECIALIST_UNITS = [ZOMBIE_MINER, ZOMBIE_WC, ZOMBIE_IGNITER, PL_ZOMBIE, ZOMBIE_SHOVEL];
const SPECIALIST_WEIGHTS = [12, 12, 2, 8, 8];
const ELITE_UNITS = [PILLAGER_ZOMBIE, VINDICATOR_ZOMBIE];
const CARDINAL_DIRECTIONS = ["NORTE", "SUR", "ESTE", "OESTE"];

const DEATH_INFANTRY_UNITS = [ZOMBIE_COMUN, ZOMBIE_RANGE, ZOMBIE_LANCE, PILLAGER_ZOMBIE, VINDICATOR_ZOMBIE];
const DEATH_INFANTRY_WEIGHTS = [5, 1, 2, 3, 3];
const DEATH_SPECIALIST_UNITS = [ZOMBIE_MINER, ZOMBIE_WC, ZOMBIE_IGNITER, PL_ZOMBIE, ZOMBIE_SHOVEL, PILLAGER_ZOMBIE, VINDICATOR_ZOMBIE];
const DEATH_SPECIALIST_WEIGHTS = [10, 10, 2, 6, 6, 4, 4];
const WAVE6_ELITE_POOL = [PILLAGER_ZOMBIE, VINDICATOR_ZOMBIE, EVOCATOR_ZOMBIE, ZOMBIE_CUIRASSIER];

const CAVALRY_ZOMBIE = "minecraft:zombie";
const CAVALRY_HORSE = "minecraft:zombie_horse";
const CAVALRY_HORSE_HEALTH = 120;
const CAVALRY_WEAPONS = ["minecraft:iron_spear", "udaw:iron_sable"];
const FIRE_RESISTANCE_TICKS = 200;

let cavalrySeq = 0;

const WAVE_COMPLETE_MESSAGES = [
    "§a§lThe darkness recedes... but not for long.",
    "§a§lYou survived... this is only the beginning.",
    "§a§lThe dead fall... more will come.",
    "§a§lA brief breath in hell.",
    "§a§lThe army of the dead regroups..."
];

const DEATH_WAVE_COMPLETE_MESSAGES = [
    "§4§lStill alive? IMPOSSIBLE!",
    "§4§lThe abyss roars... this is not over!",
    "§4§lThe damned never rest! Get ready!",
    "§4§lYou saw hell and are still standing!",
    "§4§lThe nightmare grows stronger!"
];

const TELEPORT_THRESHOLD = 45;
const MAX_TELEPORT_PER_CYCLE = 15;
const DESPAWN_GRACE_SCANS = 3;

const DEBUG = false;

try {
    if (system.beforeEvents?.startup) {
        system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
            try {
                if (!customCommandRegistry || typeof customCommandRegistry.registerCommand !== "function") return;
                customCommandRegistry.registerCommand(
                    {
                        name: "udaw:cavalry",
                        description: "Invoca caballeros de la muerte (cantidad opcional).",
                        permissionLevel: MC.CommandPermissionLevel.Any,
                        cheatsRequired: false,
                        optionalParameters: [
                            { name: "count", type: MC.CustomCommandParamType.Integer }
                        ]
                    },
                    (origin, count) => {
                        try {
                            const source = origin?.initiator ?? origin?.sourceEntity;
                            if (!source || source.typeId !== "minecraft:player") {
                                return { status: MC.CustomCommandStatus.Failure, message: "Solo lo puede usar un jugador." };
                            }
                            const amount = Math.max(1, Math.min(Number(count) || 1, 20));
                            system.run(() => spawnCavalryTest(source, amount));
                            return { status: MC.CustomCommandStatus.Success, message: `Invocando ${amount} caballero(s).` };
                        } catch {
                            return { status: MC.CustomCommandStatus.Failure };
                        }
                    }
                );
            } catch {}
        });
    }
} catch {}

const state = {
    active: false,
    player: null,
    playerId: null,
    waveIndex: 0,
    livingInWave: new Set(),
    waveSpawned: 0,
    trackedEntities: new Set(),
    waitingNext: false,
    nextWaveScheduled: false,
    lastBroadcastTick: 0,
    lastRemainingCount: -1,
    killCounter: 0,
    currentDirection: "",
    playerDied: false,
    deathMode: false,
    lastKillTick: 0,
    idleWarningShown: false,
    zombiesDespawned: false,
    missingSince: {}
};

const ALLOWED_ADMINS = [];

function weightedChoice(items, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
    }
    return items[items.length - 1];
}

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

function broadcastMessage(source, message) {
    const cleanMessage = message.replace(/§[0-9a-fk-or]/g, "");
    try { source?.runCommand(`title @s actionbar ${cleanMessage}`); } catch {}
    try { source?.sendMessage(message); } catch {}
    for (const p of getNearbyPlayers(source)) {
        try { if (p.id === source?.id) continue; p.sendMessage(message); } catch {}
        try { p.runCommand(`title @s actionbar ${cleanMessage}`); } catch {}
    }
}

function applyRaidSpawnEffects(entity, deathModeResistance = false) {
    if (!isEntityValid(entity)) return;
    const apply = () => {
        try {
            if (!isEntityValid(entity)) return;
            entity.playAnimation(RAID_SPAWN_ANIMATION);
        } catch {}
        try {
            if (!isEntityValid(entity)) return;
            entity.addEffect("minecraft:slowness", RAID_SPAWN_EFFECT_TICKS, { amplifier: 255, showParticles: false });
            entity.addEffect("minecraft:weakness", RAID_SPAWN_EFFECT_TICKS, { amplifier: 255, showParticles: false });
            entity.addEffect("minecraft:resistance", RAID_SPAWN_EFFECT_TICKS, { amplifier: 255, showParticles: false });
        } catch {}
    };
    apply();
    system.runTimeout(apply, 2);
    system.runTimeout(() => {
        try {
            if (!isEntityValid(entity)) return;
            entity.removeEffect("minecraft:slowness");
            entity.removeEffect("minecraft:weakness");
            entity.removeEffect("minecraft:resistance");
            if (deathModeResistance) {
                entity.addEffect("minecraft:resistance", 999999, { amplifier: 1, showParticles: true });
            }
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
        if (dx * dx + dy * dy + dz * dz <= RAID_SCAN_RANGE * RAID_SCAN_RANGE) {
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
        1: { infantry: Math.max(12, Math.round(12 * multiplier)) },
        2: { infantry: Math.max(12, Math.round(12 * multiplier)), specialists: Math.max(4, Math.round(4 * multiplier)) },
        3: { infantry: Math.max(12, Math.round(12 * multiplier)), specialists: Math.max(6, Math.round(6 * multiplier)), tnt: 1, plZombie: 1 },
        4: { infantry: Math.max(12, Math.round(12 * multiplier)), specialists: Math.max(6, Math.round(6 * multiplier)), tnt: 1, plZombie: 1, elites: Math.max(5, Math.round(5 * multiplier)) },
        5: { infantry: Math.max(12, Math.round(12 * multiplier)), specialists: Math.max(8, Math.round(8 * multiplier)), tnt: 1, plZombie: 1, cuirassiers: Math.max(2, Math.round(2 * multiplier)) }
    };
}

function getDeathWaveCounts(player) {
    const multiplier = getScalingMultiplier(player);
    return {
        1: { infantry: Math.max(14, Math.round(14 * multiplier)), specialists: Math.max(3, Math.round(3 * multiplier)) },
        2: { infantry: Math.max(14, Math.round(14 * multiplier)), specialists: Math.max(5, Math.round(5 * multiplier)), elites: Math.max(3, Math.round(3 * multiplier)) },
        3: { infantry: Math.max(14, Math.round(14 * multiplier)), specialists: Math.max(6, Math.round(6 * multiplier)), elites: Math.max(4, Math.round(4 * multiplier)), cuirassiers: 1 },
        4: { infantry: Math.max(14, Math.round(14 * multiplier)), specialists: Math.max(8, Math.round(8 * multiplier)), elites: Math.max(6, Math.round(6 * multiplier)), cuirassiers: 3 },
        5: { infantry: Math.max(14, Math.round(14 * multiplier)), specialists: Math.max(10, Math.round(10 * multiplier)), elites: Math.max(8, Math.round(8 * multiplier)), cuirassiers: 6 },
        6: { deathElite: 26 }
    };
}

function getDirectionVector(dir) {
    switch (dir) {
        case "NORTE": return { x: 0, z: -1 };
        case "SUR": return { x: 0, z: 1 };
        case "ESTE": return { x: 1, z: 0 };
        case "OESTE": return { x: -1, z: 0 };
        default: return { x: 0, z: -1 };
    }
}

function makePersistent(entity) {
    try {
        const despawn = entity.getComponent("minecraft:despawn");
        if (despawn) {
            despawn.despawnFromDistance = { maxDistance: 999999 };
            despawn.despawnFromInactivity = false;
            despawn.despawnFromSimulationEdge = false;
        }
    } catch (e) {}
    try { entity.triggerEvent("minecraft:spawn_for_raid"); } catch (e) {}
}

function spawnRaidEntity(dimension, base, entityId, directionVec) {
    const distance = randomBetween(25, 30);
    const spreadAngle = (Math.random() - 0.5) * 1.2;
    const angle = Math.atan2(directionVec.z, directionVec.x) + spreadAngle;
    const x = base.x + Math.cos(angle) * distance;
    const z = base.z + Math.sin(angle) * distance;
    const y = findGround(dimension, x, base.y + 40, z);
    try {
        const entity = dimension.spawnEntity(entityId, { x, y, z });
        if (!isEntityValid(entity)) return null;
        try { entity.addTag("udaw_raid_zombie"); } catch {}
        makePersistent(entity);
        applyRaidSpawnEffects(entity, state.deathMode);
        return entity;
    } catch { return null; }
}

function spawnCavalryZombie(dimension, base, directionVec) {
    const distance = randomBetween(25, 30);
    const spreadAngle = (Math.random() - 0.5) * 1.2;
    const angle = Math.atan2(directionVec.z, directionVec.x) + spreadAngle;
    const x = base.x + Math.cos(angle) * distance;
    const z = base.z + Math.sin(angle) * distance;
    const y = findGround(dimension, x, base.y + 40, z);

    let horse = null;
    try {
        horse = dimension.spawnEntity(CAVALRY_HORSE, { x, y, z });
    } catch { return null; }
    if (!isEntityValid(horse)) return null;

    try { horse.addTag("udaw_raid_zombie"); } catch {}
    makePersistent(horse);

    const cavSeq = ++cavalrySeq;
    const riderTag = "udaw_cav_rider_" + cavSeq;
    const mountTag = "udaw_cav_mount_" + cavSeq;
    try { horse.addTag(mountTag); } catch {}

    try {
        const health = horse.getComponent("minecraft:health");
        if (health) {
            health.setMaxHealth(CAVALRY_HORSE_HEALTH);
            health.setCurrentValue(CAVALRY_HORSE_HEALTH);
        }
    } catch {}

    applyRaidSpawnEffects(horse, false);
    try {
        horse.addEffect("minecraft:fire_resistance", FIRE_RESISTANCE_TICKS, { amplifier: 0, showParticles: false });
    } catch {}

    system.runTimeout(() => {
        try {
            if (!isEntityValid(horse)) return;
            horse.triggerEvent("minecraft:spawn_adult_with_rider");
        } catch {}
    }, 4);

    system.runTimeout(() => {
        try {
            if (!isEntityValid(horse)) return;
            horse.runCommand("replaceitem entity @s slot.armor.body 0 horsearmordiamond 1");
        } catch {}
        try {
            if (!isEntityValid(horse)) return;
            const equippable = horse.getComponent("minecraft:equippable");
            if (equippable && typeof equippable.setEquipment === "function") {
                equippable.setEquipment(EquipmentSlot.Body, new MC.ItemStack("horsearmordiamond", 1));
            }
        } catch {}
    }, 10);

    system.runTimeout(() => {
        try {
            if (!isEntityValid(horse)) return;
            horse.addEffect("minecraft:resistance", 999999, { amplifier: 1, showParticles: true });
            horse.addEffect("minecraft:speed", 999999, { amplifier: 1, showParticles: true });
        } catch {}
    }, RAID_SPAWN_EFFECT_TICKS + 4);

    const setupRider = (rider) => {
        if (!isEntityValid(rider)) return;
        try { rider.addTag("udaw_raid_zombie"); } catch {}
        try { rider.addTag(riderTag); } catch {}
        makePersistent(rider);
        applyRaidSpawnEffects(rider, state.deathMode);
        try {
            rider.addEffect("minecraft:fire_resistance", FIRE_RESISTANCE_TICKS, { amplifier: 0, showParticles: false });
        } catch {}
        const cavalryWeapon = randomChoice(CAVALRY_WEAPONS);
        system.runTimeout(() => {
            try {
                if (!isEntityValid(rider)) return;
                rider.runCommand("replaceitem entity @s slot.armor.head 0 udaw:heavy_diamond_helmet 1");
                rider.runCommand("replaceitem entity @s slot.armor.chest 0 udaw:heavy_diamond_chestplate 1");
                rider.runCommand("replaceitem entity @s slot.armor.legs 0 minecraft:diamond_leggings 1");
                rider.runCommand("replaceitem entity @s slot.armor.feet 0 minecraft:diamond_boots 1");
                rider.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${cavalryWeapon} 1`);
            } catch {}
        }, 6);
    };

    let findAttempts = 0;
    const findRider = () => {
        if (!isEntityValid(horse)) return;
        findAttempts++;
        let riders = [];
        try {
            const rideable = horse.getComponent("minecraft:rideable");
            if (rideable && typeof rideable.getRiders === "function") riders = rideable.getRiders() || [];
        } catch {}
        if (riders.length > 0 && isEntityValid(riders[0])) {
            setupRider(riders[0]);
            return;
        }
        if (findAttempts < 4) {
            system.runTimeout(findRider, 12);
        } else {
            let zombie = null;
            try { zombie = dimension.spawnEntity(CAVALRY_ZOMBIE, { x, y, z }); } catch {}
            if (isEntityValid(zombie)) {
                try { zombie.triggerEvent("minecraft:spawn_as_rider"); } catch {}
                setupRider(zombie);
                system.runTimeout(() => {
                    try {
                        const rideable = horse.getComponent("minecraft:rideable");
                        if (rideable && typeof rideable.addRider === "function") rideable.addRider(zombie);
                    } catch {}
                }, 6);
            }
        }
    };
    system.runTimeout(findRider, 12);

    return horse;
}

function spawnCavalryTest(player, count) {
    if (!isEntityValid(player)) return;
    const dimension = player.dimension;
    const base = player.location;
    const amount = Math.max(1, Math.min(count || 1, 20));
    let spawned = 0;
    for (let i = 0; i < amount; i++) {
        const dirVec = getDirectionVector(CARDINAL_DIRECTIONS[i % CARDINAL_DIRECTIONS.length]);
        const horse = spawnCavalryZombie(dimension, base, dirVec);
        if (horse) spawned++;
    }
    const text = spawned > 0
        ? `§6§l[CAVALIER] §aSe invocaron ${spawned} caballeros de la muerte.`
        : "§6§l[CAVALIER] §cNo se pudieron invocar.";
    try { player.sendMessage(text); } catch {}
    try { player.runCommand(`title @s actionbar ${text.replace(/§[0-9a-fk-or]/g, "")}`); } catch {}
}

function getAnnouncePlayer() {
    if (isEntityValid(state.player)) return state.player;
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
    return world.getPlayers()[0] || null;
}

function broadcastRemaining(player) {
    try {
        const remaining = state.livingInWave.size;
        if (remaining <= 0) return;
        const text = state.deathMode
            ? `§4§l§k¡§r §4§lQuedan ${remaining} almas condenadas... §k¡§r`
            : `§4§lQuedan ${remaining} muertos vivientes...`;
        player?.sendMessage(text);
        for (const p of getNearbyPlayers(player)) {
            try { if (p.id === player?.id) continue; p.sendMessage(text); } catch {}
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

        for (const id of foundIds) {
            if (!state.trackedEntities.has(id)) {
                state.trackedEntities.add(id);
                state.livingInWave.add(id);
            }
            try {
                const e = dim.getEntity(id);
                if (e) makePersistent(e);
            } catch {}
        }

        const now = system.currentTick;
        if (!state.missingSince) state.missingSince = {};
        for (const existingId of [...state.livingInWave]) {
            if (foundIds.has(existingId)) {
                delete state.missingSince[existingId];
                continue;
            }
            let stillExists = false;
            try { stillExists = isEntityValid(dim.getEntity(existingId)); } catch {}
            if (stillExists) {
                delete state.missingSince[existingId];
                continue;
            }
            if (!state.missingSince[existingId]) state.missingSince[existingId] = now;
            if (now - state.missingSince[existingId] >= DESPAWN_GRACE_SCANS * 100) {
                const maybeLast = state.livingInWave.size <= 1;
                state.livingInWave.delete(existingId);
                state.trackedEntities.delete(existingId);
                delete state.missingSince[existingId];
                state.waveSpawned = Math.max(0, state.waveSpawned - 1);
                if (maybeLast) {
                    const p = getAnnouncePlayer();
                    if (p) announce(p, "§7§lUn muerto se ha desvanecido... la oleada continúa.");
                }
            }
        }
        if (state.livingInWave.size === 0 && !state.nextWaveScheduled) {
            completeWave(getAnnouncePlayer() || state.player);
        }
    } catch {}
}

function refreshZombiePositions() {
    try {
        if (!state.active || !isEntityValid(state.player)) return;
        if (state.waitingNext) return;
        const player = state.player;
        const dim = player.dimension;
        const playerLoc = player.location;
        const directionVec = getDirectionVector(state.currentDirection);
        let teleported = 0;

        for (const entityId of state.livingInWave) {
            if (teleported >= MAX_TELEPORT_PER_CYCLE) break;
            try {
                const entity = dim.getEntity(entityId);
                if (!isEntityValid(entity)) continue;
                const dx = entity.location.x - playerLoc.x;
                const dz = entity.location.z - playerLoc.z;
                if (dx * dx + dz * dz > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
                    const distance = randomBetween(20, 28);
                    const spreadAngle = (Math.random() - 0.5) * 1.2;
                    const angle = Math.atan2(directionVec.z, directionVec.x) + spreadAngle;
                    const nx = playerLoc.x + Math.cos(angle) * distance;
                    const nz = playerLoc.z + Math.sin(angle) * distance;
                    const ny = findGround(dim, nx, playerLoc.y + 40, nz);
                    entity.teleport({ x: nx, y: ny, z: nz }, { dimension: dim });
                    teleported++;
                }
            } catch {}
        }
    } catch {}
}

function giveBasicRewards(player) {
    if (!isEntityValid(player)) return;
    const isDeath = state.deathMode;
    const ironCount = isDeath ? BASIC_IRON_COUNT * 2 : BASIC_IRON_COUNT;
    const appleCount = isDeath ? 12 : GOLDEN_APPLE_COUNT;
    const repairPct = isDeath ? 0.6 : 0.35;

    player.runCommand(`give @s iron_ingot ${ironCount}`);
    player.runCommand(`give @s golden_apple ${appleCount}`);

    try {
        const equippable = player.getComponent("minecraft:equippable");
        if (!equippable) return;
        const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand, EquipmentSlot.Mainhand];
        for (const slot of slots) {
            const item = equippable.getEquipment(slot);
            if (!item) continue;
            const fixed = item.clone();
            const durability = fixed.getComponent("minecraft:durability");
            if (!durability) continue;
            const repair = Math.floor(durability.maxDamage * repairPct);
            durability.damage = Math.max(0, durability.damage - repair);
            equippable.setEquipment(slot, fixed);
        }
    } catch (e) {
        if (DEBUG) console.warn("Repair error: " + e);
    }
}

function giveBonusRewards(player) {
    if (!isEntityValid(player)) return;
    const isDeath = state.deathMode;
    const diamondCount = isDeath ? 20 : BONUS_DIAMOND_COUNT;
    const xpCount = isDeath ? BONUS_XP_BOTTLE_COUNT * 2 : BONUS_XP_BOTTLE_COUNT;
    const totemCount = isDeath ? 2 : 1;
    try {
        player.runCommand(`give @s diamond ${diamondCount}`);
        player.runCommand(`give @s experience_bottle ${xpCount}`);
        player.runCommand(`give @s totem_of_undying ${totemCount}`);
    } catch {}
}

function giveDeathSurvivalBonus(player) {
    if (!isEntityValid(player)) return;
    try {
        player.runCommand("give @s diamond 10");
        player.runCommand("give @s totem_of_undying 1");
    } catch {}
}

function finishRaid(player) {
    const died = state.playerDied;
    const wasDeathMode = state.deathMode;

    try { player?.runCommand("gamerule doMobSpawning true"); } catch {}

    if (player && isEntityValid(player)) {
        giveBasicRewards(player);
        if (wasDeathMode) {
            player.sendMessage("§4§l☠ §6§lTHE KING RECOGNIZES YOUR COURAGE §4§l☠");
            player.sendMessage("§cYou endured the storm. Take your reward, warrior.");
            player.sendMessage("§6—— §fCombat reward delivered §6——");
        } else {
            player.sendMessage("§6§lTHE KING HAS SEEN YOUR BRAVERY");
            player.sendMessage("§eTake these supplies, hero. The fight continues.");
            player.sendMessage("§e—— §fBasic reward delivered §e——");
        }

        if (wasDeathMode || !died) {
            giveBonusRewards(player);
            if (wasDeathMode) {
                player.sendMessage("§4§l✦ §6§lHONOR OF WAR §4§l✦");
                player.sendMessage("§6The King rewards your effort on the battlefield.");
                player.sendMessage("§6—— §fWar booty delivered §6——");
            } else {
                player.sendMessage("§b§l✦ IMMORTAL REWARD ✦");
                player.sendMessage("§bYou resisted without falling... the King honors you.");
                player.sendMessage("§b—— §fSurvival bonus delivered §b——");
            }
        }

        if (wasDeathMode && !died) {
            giveDeathSurvivalBonus(player);
            player.sendMessage("§4§l✦ §c§lUNYIELDING SOUL §4§l✦");
            player.sendMessage("§cNot even the abyss could break you. The King recognizes your strength.");
            player.sendMessage("§c—— §fSupreme bonus delivered §c——");
        }
    }

    state.active = false;
    state.player = null;
    state.playerId = null;
    state.waveIndex = 0;
    state.livingInWave = new Set();
    state.waveSpawned = 0;
    state.trackedEntities = new Set();
    state.killCounter = 0;
    state.playerDied = false;
    state.deathMode = false;
    state.zombiesDespawned = false;
    state.missingSince = {};
}

function cleanupRaid() {
    state.active = false;
    state.player = null;
    state.playerId = null;
    state.waveIndex = 0;
    state.livingInWave = new Set();
    state.waveSpawned = 0;
    state.trackedEntities = new Set();
    state.killCounter = 0;
    state.playerDied = false;
    state.deathMode = false;
    state.zombiesDespawned = false;
    state.missingSince = {};
    try { world.getPlayers()[0]?.runCommand("gamerule doMobSpawning true"); } catch {}
}

function advanceRaid(player) {
    if (!isEntityValid(player)) return;

    if (state.active) {
        announce(player, "§c§lThe night is not over yet. Survive!");
        return;
    }

    const badOmen = player.getEffect("minecraft:bad_omen");
    state.deathMode = badOmen !== undefined && badOmen !== null;
    if (state.deathMode) {
        try { player.removeEffect("minecraft:bad_omen"); } catch {}
    }
    state.playerDied = false;

    try { player.runCommand("gamerule doMobSpawning false"); } catch {}

    if (state.deathMode) {
        broadcastMessage(player, "§4§l☠ THE APOCALYPSE HAS BEGUN ☠");
        broadcastMessage(player, "§cThe very horrors of the abyss emerge!");
        broadcastMessage(player, "§4§k¡§r §4NO ESCAPE! §k¡§r");
    } else {
        broadcastMessage(player, "§4§l☠ THE DEAD RISE ☠");
        broadcastMessage(player, "§cThe air grows putrid... something approaches!");
    }

    system.runTimeout(() => {
        if (!isEntityValid(player)) return;
        startWave(player, 1);
    }, 20);
}

function completeWave(player) {
    if (!state.active) return;

    const announcer = getAnnouncePlayer();

    if (DEBUG && announcer) {
        try { announcer.sendMessage(`DEBUG: completeWave wave=${state.waveIndex} living=${state.livingInWave.size}`); } catch {}
    }

    const maxWave = state.deathMode ? 6 : 5;
    const completeMsgs = state.deathMode ? DEATH_WAVE_COMPLETE_MESSAGES : WAVE_COMPLETE_MESSAGES;
    if (announcer) broadcastMessage(announcer, randomChoice(completeMsgs));

    if (state.waveIndex >= maxWave) {
        finishRaid(announcer || player);
        return;
    }

    if (state.nextWaveScheduled) return;
    state.nextWaveScheduled = true;
    state.waitingNext = true;

    if (announcer) {
        const text = state.deathMode
            ? "§4§lNext wave in 30s... PRAY! §k¡§r"
            : "§6§lNext wave in 30s... get ready!";
        broadcastMessage(announcer, text);
    }

    scheduleCountdown(announcer, 30);

    system.runTimeout(() => {
        if (!state.active) return;
        const starter = getAnnouncePlayer() || announcer || player;
        state.waitingNext = false;
        state.nextWaveScheduled = false;
        startWave(starter, state.waveIndex + 1);
    }, WAVE_REST_TICKS + 20);
}

function startWave(player, waveNumber) {
    if (!isEntityValid(player)) return;

    const dimension = player.dimension;
    const base = player.location;
    const isDeath = state.deathMode;
    const counts = isDeath ? getDeathWaveCounts(player)[waveNumber] : getWaveCounts(player)[waveNumber];

    state.currentDirection = randomChoice(CARDINAL_DIRECTIONS);

    state.active = true;
    state.player = player;
    state.playerId = player.id;
    state.waveIndex = waveNumber;
    state.livingInWave = new Set();
    state.waveSpawned = 0;
    state.trackedEntities = new Set();
    state.origin = { dimension: dimension.id, x: base.x, y: base.y, z: base.z };
    state.waitingNext = false;
    state.nextWaveScheduled = false;
    state.killCounter = 0;
    state.lastKillTick = system.currentTick;
    state.idleWarningShown = false;
    state.zombiesDespawned = false;
    state.missingSince = {};

    const directionVec = getDirectionVector(state.currentDirection);

    try { dimension.playSound("horde", base, { volume: 2, maxDistance: 120 }); } catch {}

    if (isDeath) {
        broadcastMessage(player, `§4§l§k¡§r §4§l★ WAVE ${waveNumber} ★ §k¡§r`);
        broadcastMessage(player, `§c§lTHE DAMNED RUSH FROM THE ${state.currentDirection}!`);
        broadcastMessage(player, "§4§lNO MERCY! NO ESCAPE!");
    } else {
        broadcastMessage(player, `§4§l★ WAVE ${waveNumber} ★`);
        broadcastMessage(player, `§c§lTHE DEAD COME FROM THE ${state.currentDirection}`);
        broadcastMessage(player, "§4Get ready or be devoured!");
    }

    const register = (entity) => {
        if (!isEntityValid(entity)) return;
        const entityId = entity.id;
        if (!entityId) return;
        state.livingInWave.add(entityId);
        state.trackedEntities.add(entityId);
        state.waveSpawned += 1;
    };

    const spawnCavalry = (count) => {
        for (let i = 0; i < count; i++) {
            const horse = spawnCavalryZombie(dimension, base, directionVec);
            if (!horse) continue;
            register(horse);
        }
    };

    if (isDeath) {
        const deathInfantryPool = DEATH_INFANTRY_UNITS;
        const deathInfantryWeights = DEATH_INFANTRY_WEIGHTS;
        const deathSpecialistPool = DEATH_SPECIALIST_UNITS;
        const deathSpecialistWeights = DEATH_SPECIALIST_WEIGHTS;

        for (let i = 0; i < counts.infantry; i++) {
            register(spawnRaidEntity(dimension, base, weightedChoice(deathInfantryPool, deathInfantryWeights), directionVec));
        }

        if (waveNumber >= 1) {
            for (let i = 0; i < counts.specialists; i++) {
                register(spawnRaidEntity(dimension, base, weightedChoice(deathSpecialistPool, deathSpecialistWeights), directionVec));
            }
        }

        if (waveNumber >= 2 && counts.elites) {
            for (let i = 0; i < counts.elites; i++) {
                register(spawnRaidEntity(dimension, base, randomChoice(ELITE_UNITS), directionVec));
            }
        }

        if (waveNumber >= 3 && counts.cuirassiers) {
            for (let i = 0; i < counts.cuirassiers; i++) {
                register(spawnRaidEntity(dimension, base, ZOMBIE_CUIRASSIER, directionVec));
            }
        }

        if (waveNumber === 6 && counts.deathElite) {
            for (let i = 0; i < counts.deathElite; i++) {
                register(spawnRaidEntity(dimension, base, randomChoice(WAVE6_ELITE_POOL), directionVec));
            }
        }

        if (waveNumber === 5) spawnCavalry(1);
        if (waveNumber === 6) spawnCavalry(2);
    } else {
        for (let i = 0; i < counts.infantry; i++) {
            register(spawnRaidEntity(dimension, base, weightedChoice(INFANTRY_UNITS, INFANTRY_WEIGHTS), directionVec));
        }

        if (waveNumber >= 2) {
            for (let i = 0; i < counts.specialists; i++) {
                register(spawnRaidEntity(dimension, base, weightedChoice(SPECIALIST_UNITS, SPECIALIST_WEIGHTS), directionVec));
            }
            for (let i = 0; i < counts.tnt; i++) {
                register(spawnRaidEntity(dimension, base, ZOMBIE_IGNITER, directionVec));
            }
            for (let i = 0; i < counts.plZombie; i++) {
                register(spawnRaidEntity(dimension, base, PL_ZOMBIE, directionVec));
            }
        }

        if (waveNumber >= 4 && counts.elites) {
            for (let i = 0; i < counts.elites; i++) {
                register(spawnRaidEntity(dimension, base, randomChoice(ELITE_UNITS), directionVec));
            }
        }

        if (waveNumber === 5 && counts.cuirassiers) {
            for (let i = 0; i < counts.cuirassiers; i++) {
                register(spawnRaidEntity(dimension, base, ZOMBIE_CUIRASSIER, directionVec));
            }
        }

        if (waveNumber === 5) spawnCavalry(1);
    }

    if (state.waveSpawned <= 0) {
        finishRaid(player);
    }
}

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
                        const text = state.deathMode
                            ? (sec > 5 ? `§4§lThe end approaches! ${sec}s...` : `§4§l§k¡§r §4§l${sec}! §k¡§r`)
                            : (sec > 5 ? `§c§lThe terror returns in ${sec}s...` : `§4§l${sec}...`);
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

const BASIC_IRON_COUNT = 32;
const GOLDEN_APPLE_COUNT = 4;
const BONUS_DIAMOND_COUNT = 5;
const BONUS_XP_BOTTLE_COUNT = 10;

system.runInterval(() => {
    try {
        if (!state.active) return;
        refreshLivingSet();
        refreshZombiePositions();

        const now = system.currentTick;
        if (state.waitingNext || state.nextWaveScheduled) return;

        const idleTicks = now - state.lastKillTick;
        const hasZombies = state.livingInWave.size > 0;

        if (!hasZombies) {
            if (idleTicks > 400 && !state.idleWarningShown) {
                state.idleWarningShown = true;
                const p = getAnnouncePlayer();
                if (p) announce(p, "§4§lNo undead remain... canceling the raid.");
            }
            if (idleTicks > 600) {
                const p = getAnnouncePlayer() || state.player;
                if (state.zombiesDespawned) {
                    if (p) announce(p, "§7§lThe dead fled... the raid ends without rewards.");
                    cleanupRaid();
                } else {
                    if (p) announce(p, "§4§lThe raid has been canceled due to inactivity.");
                    finishRaid(p);
                }
                return;
            }
        } else {
            const timeout = state.deathMode ? 2400 : 3600;
            const warnTime = state.deathMode ? 1200 : 2400;
            if (idleTicks > warnTime && !state.idleWarningShown) {
                state.idleWarningShown = true;
                const msg = state.deathMode
                    ? "§4§lTHE DAMNED ARE REGROUPING! Return to the battlefield."
                    : "§4§lThe dead are fading... return or you will lose the raid.";
                const p = getAnnouncePlayer();
                if (p) announce(p, msg);
            }
            if (idleTicks > timeout) {
                const p = getAnnouncePlayer() || state.player;
                if (state.zombiesDespawned) {
                    if (p) announce(p, "§7§lThe dead fled... the raid ends without rewards.");
                    cleanupRaid();
                } else {
                    if (p) announce(p, "§4§lThe raid has been canceled due to inactivity.");
                    finishRaid(p);
                }
            }
        }
    } catch {}
}, 100);

world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;

    if (!player || !item || item.typeId !== RAID_ITEM_ID) return;

    if (state.active) {
        announce(player, "§c§lThe night is not over yet. Survive!");
        return;
    }

    event.cancel = true;

    try { player.runCommand(`clear @s ${RAID_ITEM_ID} 0 1`); } catch {}

    system.runTimeout(() => {
        if (!isEntityValid(player)) return;
        advanceRaid(player);
    }, 1);
});

world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (!isEntityValid(entity)) return;

    if (state.active && state.playerId && entity.id === state.playerId) {
        state.playerDied = true;
    }

    const entityId = entity.id;
    if (!entityId) return;
    if (!state.active || !isEntityValid(state.player)) return;
    if (!state.livingInWave.has(entityId) && !state.trackedEntities.has(entityId)) return;

    state.livingInWave.delete(entityId);
    state.trackedEntities.delete(entityId);
    state.waveSpawned = Math.max(0, state.waveSpawned - 1);

    state.killCounter++;
    state.lastKillTick = system.currentTick;
    state.idleWarningShown = false;
    if (state.killCounter >= 5) {
        state.killCounter = 0;
        const p = getAnnouncePlayer();
        if (p) broadcastRemaining(p);
    }

    if (state.livingInWave.size <= 0) {
        if (state.zombiesDespawned) {
            const p = getAnnouncePlayer() || state.player;
            if (p) announce(p, "§7§lThe dead fled... the raid ends without rewards.");
            cleanupRaid();
        } else {
            completeWave(getAnnouncePlayer() || state.player);
        }
    }
});

world.afterEvents.scriptEventReceive.subscribe((event) => {
    const player = event.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;
    if (event.id === "udaw:cancel_raid") {
        cancelRaid(player);
        return;
    }
    if (event.id === "udaw:cavalry") {
        let count = 1;
        try {
            const parsed = parseInt((event.message || "").trim(), 10);
            if (!isNaN(parsed) && parsed > 0) count = parsed;
        } catch {}
        spawnCavalryTest(player, count);
    }
});

try {
    world.beforeEvents.chatSend.subscribe((event) => {
        try {
            const sender = event.sender;
            const msg = (event.message || "").trim();
            if (!sender || sender.typeId !== "minecraft:player") return;
            if (msg === "/cancelraid" || msg === "!cancelraid") {
                event.cancel = true;
                cancelRaid(sender);
                return;
            }
            const cavMatch = msg.match(/^[!/]cavalry(?:\s+(\d+))?$/);
            if (cavMatch) {
                event.cancel = true;
                spawnCavalryTest(sender, cavMatch[1] ? parseInt(cavMatch[1], 10) : 1);
                return;
            }
        } catch {}
    });
} catch {}

function cancelRaid(player) {
    if (!isEntityValid(player)) return;

    const name = player.name || player.getName?.() || "";
    const isAdminName = ALLOWED_ADMINS.includes(name);
    const isCreative = (typeof player.getGameMode === "function" && player.getGameMode() === GameMode.Creative);
    const hasAdminTag = player.hasTag?.("admin") || player.hasTag?.("op") || player.hasTag?.("udaw_admin");

    if (!isAdminName && !isCreative && !hasAdminTag) {
        announce(player, "§cOnly admins can cancel the raid.");
        return;
    }

    if (!state.active) {
        announce(player, "§cThere is no active raid.");
        return;
    }

    announce(player, "§4§lThe curse has been dispelled by a superior.");
    try { player.runCommand("gamerule doMobSpawning true"); } catch {}
    finishRaid(player);
}
