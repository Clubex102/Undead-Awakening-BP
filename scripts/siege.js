import { world, system, GameMode } from "@minecraft/server";

/* ================= SIEGE (asedio) =================
 * Logica portada del addon de referencia (entities/TEST):
 * - miner  -> A* hacia el objetivo ROMPIENDO su perfil de bloques
 * - builder-> A* colocando TIERRA de soporte bajo sus pies (puentes)
 * Sin loops nuevos: se llama desde los intervalos ya existentes de
 * zombie_miner.js / zombiewc.js, con cooldown por entidad (5s).
 * Perfiles:
 *   "miner" -> udaw:zombieminer (piedra/metal, mismo filtro que su raycast)
 *   "wc"    -> udaw:zombiewc    (madera, mismo filtro que su raycast)
 */

const SIEGE_RANGE = 30;
const SIEGE_COOLDOWN = 200; // ticks entre pasos de asedio por entidad (10s)
const SIEGE_COOLDOWN_BUILD = 20; // el pala puentea agresivo (1s)
const SIEGE_RETRY_NO_TARGET = 60;
const MAX_NODES = 250; // asedio local y barato; si no llega, usa ruta parcial
const MAX_CONCURRENT_JOBS = 3; // jobs baratos ya; el resto espera su turno
const SIEGE_JOB_TIMEOUT = 200; // ticks: si un job no termina, se considera colgado y se libera
const SIEGE_DEBUG = true; // TODO quitar cuando se confirme en juego

function slog(msg) {
    if (SIEGE_DEBUG) { try { console.warn("[siege] " + msg); } catch (_) {} }
}

const SIEGE_PREY = new Set([
    "minecraft:player",
    "minecraft:villager",
    "minecraft:villager_v2",
    "minecraft:iron_golem",
    "minecraft:wandering_trader",
    "minecraft:pillager",
    "minecraft:vindicator",
    "minecraft:evoker",
    "minecraft:illusioner",
    "minecraft:ravager",
    "minecraft:witch"
]);

function isIllagerFamily(e) {
    try { return e.matches({ families: ["illager"] }); } catch (_) { return false; }
}

// Bloques que NINGUN perfil rompe jamas (seguridad)
const NEVER_BREAK = new Set([
    "minecraft:bedrock",
    "minecraft:barrier",
    "minecraft:command_block",
    "minecraft:chain_command_block",
    "minecraft:repeating_command_block",
    "minecraft:deny",
    "minecraft:allow",
    "minecraft:border_block",
    "minecraft:structure_block",
    "minecraft:structure_void",
    "minecraft:end_portal",
    "minecraft:end_gateway",
    "minecraft:nether_portal"
]);

/* ================= PERFIL MINER (piedra) ================= */

const MINER_EXCLUDE_CONTAINS = [
    "_bricks",
    "_brick",
    "polished_",
    "_polished",
    "chiseled_",
    "_chiseled",
    "_block",
    "terracotta",
    "mud_brick",
    "hardened_clay"
];

const MINER_EXCLUDE_EXACT = new Set([
    "minecraft:brick_block",
    "minecraft:nether_brick",
    "minecraft:red_nether_brick",
    "minecraft:clay",
    "minecraft:packed_mud"
]);

const MINER_EXTRA = new Set([
    "minecraft:dirt",
    "minecraft:grass_block",
    "minecraft:mycelium",
    "minecraft:podzol",
    "minecraft:dirt_with_roots",
    "minecraft:farmland",
    "minecraft:gravel",
    "minecraft:sand",
    "minecraft:red_sand",
    "minecraft:soul_sand",
    "minecraft:soul_soil",
    "minecraft:deepslate",
    "minecraft:cobbled_deepslate",
    "minecraft:deepslate_coal_ore",
    "minecraft:deepslate_iron_ore",
    "minecraft:deepslate_gold_ore",
    "minecraft:deepslate_diamond_ore",
    "minecraft:deepslate_emerald_ore",
    "minecraft:deepslate_redstone_ore",
    "minecraft:deepslate_lapis_ore",
    "minecraft:deepslate_copper_ore",
    "minecraft:tuff",
    "minecraft:dripstone_block",
    "minecraft:pointed_dripstone"
]);

function isBreakableMiner(block) {
    const id = block.typeId;
    if (NEVER_BREAK.has(id)) return false;
    if (MINER_EXTRA.has(id)) return true;
    if (MINER_EXCLUDE_EXACT.has(id)) return false;
    for (const fragment of MINER_EXCLUDE_CONTAINS) {
        if (id.includes(fragment)) return false;
    }
    try {
        return (
            block.hasTag("stone") ||
            block.hasTag("metal") ||
            block.hasTag("diamond_pick_diggable") ||
            block.hasTag("iron_pick_diggable") ||
            block.hasTag("stone_pick_diggable") ||
            block.hasTag("wood_pick_diggable")
        );
    } catch (_) { return false; }
}

/* ================= PERFIL WC (madera) ================= */

const WC_EXCLUDE_EXACT = new Set([
    "minecraft:bookshelf",
    "minecraft:chiseled_bookshelf",
    "minecraft:crafting_table",
    "minecraft:cartography_table",
    "minecraft:fletching_table",
    "minecraft:smithing_table",
    "minecraft:lectern",
    "minecraft:composter",
    "minecraft:loom",
    "minecraft:grindstone",
    "minecraft:jukebox",
    "minecraft:note_block",
    "minecraft:beehive",
    "minecraft:bee_nest",
    "minecraft:bamboo_mosaic",
    "minecraft:bamboo_mosaic_slab",
    "minecraft:bamboo_mosaic_stairs",
    "minecraft:chest",
    "minecraft:trapped_chest",
    "minecraft:barrel",
    "minecraft:hopper",
    "minecraft:dispenser",
    "minecraft:dropper"
]);

const WC_LEAVES = new Set([
    "minecraft:oak_leaves",
    "minecraft:spruce_leaves",
    "minecraft:birch_leaves",
    "minecraft:jungle_leaves",
    "minecraft:acacia_leaves",
    "minecraft:dark_oak_leaves",
    "minecraft:mangrove_leaves",
    "minecraft:cherry_leaves",
    "minecraft:azalea_leaves",
    "minecraft:flowering_azalea_leaves"
]);

const WC_EXCLUDED_SUFFIXES = [
    "_button",
    "_sign",
    "_wall_sign",
    "_hanging_sign"
];

function isBreakableWC(block) {
    const id = block.typeId;
    if (NEVER_BREAK.has(id)) return false;
    if (WC_EXCLUDE_EXACT.has(id)) return false;
    for (const suffix of WC_EXCLUDED_SUFFIXES) {
        if (id.endsWith(suffix)) return false;
    }
    if (WC_LEAVES.has(id)) return true;
    try {
        if (block.getComponent("minecraft:inventory")) return false;
    } catch (_) {}
    try {
        return block.hasTag("wood") || block.hasTag("axe_item_destructible");
    } catch (_) { return false; }
}

function profileFilter(profile) {
    return profile === "wc" ? isBreakableWC : isBreakableMiner;
}

/* ================= OBJETIVO ================= */

function findSiegeTarget(entity) {
    let best = null;
    let bestDist = Infinity;
    let candidates = [];
    try {
        candidates = entity.dimension.getEntities({
            location: entity.location,
            maxDistance: SIEGE_RANGE
        });
    } catch (_) { return null; }
    for (const e of candidates) {
        if (e === entity) continue;
        if (!SIEGE_PREY.has(e.typeId) && !isIllagerFamily(e)) continue;
        if (e.typeId === "minecraft:player") {
            try {
                if (!e.matches({ excludeGameModes: [GameMode.creative, GameMode.spectator] })) continue;
            } catch (_) { continue; }
        }
        const dx = e.location.x - entity.location.x;
        const dy = e.location.y - entity.location.y;
        const dz = e.location.z - entity.location.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < bestDist) {
            bestDist = d;
            best = e;
        }
    }
    return best;
}

/* ================= ESTADO ================= */

const positionHistory = new Map(); // entityId -> [{x,y,z}] ultimas 3 (muestreadas cada 40t)
const positionTick = new Map();    // entityId -> ultimo tick de muestra
const stuckFlag = new Map();       // entityId -> ultimo resultado
const forceUnstick = new Map();    // entityId -> bool
const activeJobs = new Map();      // entityId -> jobId (mina o construye, uno a la vez)
const activeJobTick = new Map();   // entityId -> tick de inicio (reaper anti-cuelgues)

function readCooldown(zombie) {
    try { return Number(zombie.getDynamicProperty("udaw:siege_next")) || 0; }
    catch (_) { return 0; }
}

function writeCooldown(zombie, ticks) {
    try { zombie.setDynamicProperty("udaw:siege_next", system.currentTick + ticks); }
    catch (_) {}
}

function updateStuck(zombie, locX, locY, locZ) {
    // Muestreo cada 40 ticks: con muestras cada 2 ticks cualquier pausa
    // (pelear, mirar) parecia atasco y disparaba teleports fantasma.
    const tick = system.currentTick;
    const last = positionTick.get(zombie.id);
    if (last !== undefined && tick - last < 40) return stuckFlag.get(zombie.id) || false;
    positionTick.set(zombie.id, tick);
    let history = positionHistory.get(zombie.id) || [];
    history = [...history, { x: locX, y: locY, z: locZ }].slice(-3);
    positionHistory.set(zombie.id, history);
    const stuck = history.length === 3 &&
        history.every(p => p.x === history[0].x && p.y === history[0].y && p.z === history[0].z);
    stuckFlag.set(zombie.id, stuck);
    return stuck;
}

function clearJob(zombie) {
    if (activeJobs.has(zombie.id)) {
        try { system.clearJob(activeJobs.get(zombie.id)); } catch (_) {}
        activeJobs.delete(zombie.id);
    }
    activeJobTick.delete(zombie.id);
}

function swing(zombie, anim) {
    try { zombie.runCommand("playanimation @s " + (anim || "animation.zombie.swing") + " a 0.333"); } catch (_) {}
}

function teleportSlowness(entity) {
    try { entity.addEffect("slowness", 19, { amplifier: 255, showParticles: false }); } catch (_) {}
}

/* ================= HELPERS DE BLOQUES ================= */

function makeBlockHelpers(getBlock, profileFn) {
    const isReplaceable = (block) => {
        if (!block) return false;
        const id = block.typeId;
        if (id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water") return true;
        const replaceables = ["tallgrass", "lava", "snow_layer", "flower", "vines", "kelp", "fern"];
        return replaceables.some(tag => id.includes(tag));
    };
    const isAirWaterOrLava = (block) => {
        if (!block) return false;
        const id = block.typeId;
        return id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water" ||
            id === "minecraft:lava" || id === "minecraft:flowing_lava";
    };
    const isOpen = (block) => !block || isReplaceable(block) || isAirWaterOrLava(block);
    const isBreakable = (block) => {
        if (!block || isOpen(block)) return false;
        try { return profileFn(block); } catch (_) { return false; }
    };
    const isPassable = (block) => isOpen(block) || isBreakable(block);
    const hasPassableClearance = (x, y, z, height) => {
        for (let i = 0; i < height; i++) {
            if (!isPassable(getBlock(x, y + i, z))) return false;
        }
        return true;
    };
    const countBreakableInClearance = (x, y, z, height) => {
        let count = 0;
        for (let i = 0; i < height; i++) {
            if (isBreakable(getBlock(x, y + i, z))) count++;
        }
        return count;
    };
    return { isOpen, isBreakable, isPassable, hasPassableClearance, countBreakableInClearance };
}

const ASTAR_DIRECTIONS = [
    { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
    { dx: 0, dy: 1, dz: 0 },
    { dx: 1, dy: 1, dz: 0 }, { dx: -1, dy: 1, dz: 0 },
    { dx: 0, dy: 1, dz: 1 }, { dx: 0, dy: 1, dz: -1 },
    { dx: 1, dy: -1, dz: 0 }, { dx: -1, dy: -1, dz: 0 },
    { dx: 0, dy: -1, dz: 1 }, { dx: 0, dy: -1, dz: -1 }
];

function astarBounds(start, goal) {
    // Radio LOCAL alrededor del zombie (barato). Si el objetivo esta lejos,
    // el fallback de ruta parcial igual avanza hacia el.
    const R = 8;
    const UP = 6;
    const DOWN = 6;
    return {
        minX: start.x - R,
        maxX: start.x + R,
        minZ: start.z - R,
        maxZ: start.z + R,
        minY: Math.max(-64, start.y - DOWN),
        maxY: Math.min(320, start.y + UP)
    };
}

/* ================= MINAR (miner + wc) ================= */

export function siegeMineStep(zombie, profile, force) {
    const tick = system.currentTick;
    // Tope global de jobs: evita que 5 mobs a la vez saturen la cola
    if (activeJobs.size >= MAX_CONCURRENT_JOBS) {
        try { zombie.setDynamicProperty("udaw:siege_next", tick + 40); } catch (_) {}
        return;
    }
    let valid = false;
    try { valid = zombie.isValid; } catch (_) { return; }
    if (!valid) {
        positionHistory.delete(zombie.id);
        positionTick.delete(zombie.id);
        stuckFlag.delete(zombie.id);
        forceUnstick.delete(zombie.id);
        clearJob(zombie);
        return;
    }
    try { if (!zombie.isOnGround) return; } catch (_) { return; }
    if (activeJobs.has(zombie.id)) {
        // Reaper: si el job lleva demasiado sin terminar, se colgo -> liberar
        const started = activeJobTick.get(zombie.id) || 0;
        if (tick - started > SIEGE_JOB_TIMEOUT) {
            clearJob(zombie);
            slog("mine " + zombie.typeId + " job colgado, liberado");
        } else return;
    }
    // Puerta por atasco: solo se patha si esta quieto o toco el cooldown (10s)
    let lx = 0, ly = 0, lz = 0;
    try {
        lx = Math.floor(zombie.location.x);
        ly = Math.floor(zombie.location.y);
        lz = Math.floor(zombie.location.z);
    } catch (_) { return; }
    const stuckNow = updateStuck(zombie, lx, ly, lz);
    // force (llamada del raycast tras fijar objetivo): salta puerta de atasco y cooldown
    if (!force && !stuckNow && tick < readCooldown(zombie)) return;

    const target = findSiegeTarget(zombie);
    if (!target || !target.isValid) { writeCooldown(zombie, SIEGE_RETRY_NO_TARGET); return false; }
    // Forzado (raycast): el stare ya es el ritmo, cooldown corto
    writeCooldown(zombie, force ? 30 : SIEGE_COOLDOWN);
    slog("mine " + zombie.typeId + " -> " + target.typeId + (stuckNow ? " (atascado)" : "") + (force ? " (raycast)" : ""));

    const loc = zombie.location;
    const tLoc = target.location;
    const dimension = zombie.dimension;
    const isBreakableFn = profileFilter(profile);
    // Cache de bloques del job: los vecinos se solapan mucho y getBlock es caro
    const blockCache = new Map();
    const cachedBlock = (x, y, z) => {
        const k = x + "," + y + "," + z;
        if (blockCache.has(k)) return blockCache.get(k);
        let b = null;
        try { b = dimension.getBlock({ x, y, z }) || null; } catch (_) { b = null; }
        blockCache.set(k, b);
        return b;
    };
    const H = makeBlockHelpers(cachedBlock, isBreakableFn);

    const locX = Math.floor(loc.x);
    const locY = Math.floor(loc.y);
    const locZ = Math.floor(loc.z);
    const isStuck = stuckNow;

    function* calculateMiningPath() {
        const start = { x: locX, y: locY, z: locZ };
        const goal = { x: Math.floor(tLoc.x), y: Math.floor(tLoc.y), z: Math.floor(tLoc.z) };
        const B = astarBounds(start, goal);
        const inBounds = (x, y, z) => x >= B.minX && x <= B.maxX && y >= B.minY && y <= B.maxY && z >= B.minZ && z <= B.maxZ;
        const isGoal = (n) => n.x === goal.x && n.y === goal.y && n.z === goal.z;
        const heuristic = (n) => {
            const ddx = n.x - goal.x;
            const ddy = n.y - goal.y;
            const ddz = n.z - goal.z;
            return Math.sqrt(ddx * ddx + ddz * ddz) + Math.abs(ddy) * 1.2;
        };
        const getNeighbors = (node) => {
            const neighbors = [];
            for (const { dx, dy, dz } of ASTAR_DIRECTIONS) {
                const nx = node.x + dx, ny = node.y + dy, nz = node.z + dz;
                if (!inBounds(nx, ny, nz)) continue;
                const floorBlock = cachedBlock(nx, ny - 1, nz);
                if (H.isOpen(floorBlock)) continue;
                const isStairUp = dy === 1 && (dx !== 0 || dz !== 0);
                const isStairDown = dy === -1 && (dx !== 0 || dz !== 0);
                const isStaircase = isStairUp || isStairDown;
                if (isStairUp && !H.hasPassableClearance(node.x, node.y, node.z, 3)) continue;
                const requiredHeight = isStairDown ? 3 : 2;
                if (!H.hasPassableClearance(nx, ny, nz, requiredHeight)) continue;
                const breakCost = H.countBreakableInClearance(nx, ny, nz, requiredHeight) * 4;
                const baseCost = isStaircase ? 1.3 : dy !== 0 ? 1.5 : 1;
                neighbors.push({ x: nx, y: ny, z: nz, cost: baseCost + breakCost });
            }
            return neighbors;
        };
        const keyOf = (n) => `${n.x},${n.y},${n.z}`;
        if (isGoal(start)) { finishMiningPath(null); return; }
        const open = [{ ...start, g: 0, f: heuristic(start) }];
        const cameFrom = new Map();
        const gScore = new Map([[keyOf(start), 0]]);
        const visited = new Set();
        let closestNode = start;
        let minH = heuristic(start);
        let expanded = 0;
        while (open.length > 0 && expanded < MAX_NODES) {
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const current = open.splice(bestIdx, 1)[0];
            const currentKey = keyOf(current);
            if (visited.has(currentKey)) continue;
            visited.add(currentKey);
            expanded++;
            if (expanded % 10 === 0) yield;
            if (!zombie.isValid) { activeJobs.delete(zombie.id); activeJobTick.delete(zombie.id); return; }
            if (isGoal(current)) {
                finishMiningPath(reconstruct(cameFrom, currentKey));
                return;
            }
            for (const neighbor of getNeighbors(current)) {
                const nKey = keyOf(neighbor);
                if (visited.has(nKey)) continue;
                const h = heuristic(neighbor);
                if (h < minH) { minH = h; closestNode = neighbor; }
                const tentativeG = current.g + neighbor.cost;
                if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
                    gScore.set(nKey, tentativeG);
                    cameFrom.set(nKey, { parentKey: currentKey, node: neighbor });
                    open.push({ x: neighbor.x, y: neighbor.y, z: neighbor.z, g: tentativeG, f: tentativeG + h });
                }
            }
        }
        if (keyOf(closestNode) !== keyOf(start)) {
            finishMiningPath(reconstruct(cameFrom, keyOf(closestNode)));
            return;
        }
        finishMiningPath(null);
    }

    function reconstruct(cameFrom, key) {
        const path = [];
        while (cameFrom.has(key)) {
            const entry = cameFrom.get(key);
            path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
            key = entry.parentKey;
        }
        return path;
    }

    function finishMiningPath(path) {
        activeJobs.delete(zombie.id);
        activeJobTick.delete(zombie.id);
        if (!zombie.isValid) return;
        if (!path || path.length === 0) {
            try { zombie.lookAt(target.getHeadLocation()); } catch (_) {}
            slog("mine " + zombie.typeId + " SIN ruta");
            return;
        }
        const next = path[0];
        if (isStuck) forceUnstick.set(zombie.id, true);
        const forcing = forceUnstick.get(zombie.id) || false;
        let successfullyMined = false;
        const requiredHeight = (next.y < locY) ? 3 : 2;
        if (next.y > locY && (next.x !== locX || next.z !== locZ)) {
            const overheadBlock = cachedBlock(locX, locY + 2, locZ);
            if (H.isBreakable(overheadBlock)) {
                try { dimension.runCommand(`setblock ${locX} ${locY + 2} ${locZ} air destroy`); successfullyMined = true; } catch (_) {}
            }
        }
        for (let i = 0; i < requiredHeight; i++) {
            const block = cachedBlock(next.x, next.y + i, next.z);
            if (H.isBreakable(block)) {
                try { dimension.runCommand(`setblock ${next.x} ${next.y + i} ${next.z} air destroy`); successfullyMined = true; } catch (_) {}
            }
        }
        if (successfullyMined) {
            if (forcing) forceUnstick.set(zombie.id, false);
            positionHistory.set(zombie.id, []);
            swing(zombie);
            // TP tras romper: es lo que los hace ver decididos (avanza al hueco abierto)
            slog("mine " + zombie.typeId + " ROMPE->avanza");
            system.runTimeout(() => {
                if (zombie.isValid) {
                    try {
                        zombie.teleport({ x: next.x + 0.5, y: next.y, z: next.z + 0.5 }, { facingLocation: tLoc });
                        teleportSlowness(zombie);
                    } catch (_) {}
                }
            }, 2);
            return;
        }
        if (forcing) {
            forceUnstick.set(zombie.id, false);
            positionHistory.set(zombie.id, []);
            // Verificacion fresca: jamas teleportar dentro de un bloque
            let clear = false;
            try {
                const a = dimension.getBlock({ x: next.x, y: next.y, z: next.z });
                const b = dimension.getBlock({ x: next.x, y: next.y + 1, z: next.z });
                const openFresh = (blk) => !blk || blk.typeId === "minecraft:air" ||
                    blk.typeId === "minecraft:water" || blk.typeId === "minecraft:flowing_water";
                clear = openFresh(a) && openFresh(b);
            } catch (_) {}
            if (!clear) {
                slog("mine " + zombie.typeId + " rescate cancelado (sin hueco)");
                try { zombie.lookAt(target.getHeadLocation()); } catch (_) {}
                return;
            }
            slog("mine " + zombie.typeId + " TELEPORT (atascado)");
            try {
                zombie.teleport({ x: next.x + 0.5, y: next.y, z: next.z + 0.5 }, { facingLocation: tLoc });
                teleportSlowness(zombie);
            } catch (_) {}
            return;
        }
        try { zombie.lookAt(target.getHeadLocation()); } catch (_) {}
    }

    try {
        const jobId = system.runJob(calculateMiningPath());
        activeJobs.set(zombie.id, jobId);
        activeJobTick.set(zombie.id, tick);
        return true;
    } catch (_) { return false; }
}

/* ================= CONSTRUIR (shovel) ================= */

export function siegeBuildStep(zombie, buildAnim) {
    const tick = system.currentTick;
    if (activeJobs.size >= MAX_CONCURRENT_JOBS) {
        try { zombie.setDynamicProperty("udaw:siege_next", tick + 40); } catch (_) {}
        return;
    }
    let valid = false;
    try { valid = zombie.isValid; } catch (_) { return; }
    if (!valid) {
        positionHistory.delete(zombie.id);
        positionTick.delete(zombie.id);
        stuckFlag.delete(zombie.id);
        forceUnstick.delete(zombie.id);
        clearJob(zombie);
        return;
    }
    try { if (!zombie.isOnGround) return; } catch (_) { return; }
    if (activeJobs.has(zombie.id)) {
        const started = activeJobTick.get(zombie.id) || 0;
        if (tick - started > SIEGE_JOB_TIMEOUT) {
            clearJob(zombie);
            slog("build " + zombie.typeId + " job colgado, liberado");
        } else return;
    }
    if (tick < readCooldown(zombie)) return;

    const target = findSiegeTarget(zombie);
    if (!target || !target.isValid) { writeCooldown(zombie, SIEGE_RETRY_NO_TARGET); return; }
    writeCooldown(zombie, SIEGE_COOLDOWN_BUILD);
    slog("build " + zombie.typeId + " -> " + target.typeId);

    const loc = zombie.location;
    const tLoc = target.location;
    const dimension = zombie.dimension;
    const blockType = "minecraft:dirt";
    const blockCacheB = new Map();
    const cachedBlockB = (x, y, z) => {
        const k = x + "," + y + "," + z;
        if (blockCacheB.has(k)) return blockCacheB.get(k);
        let b = null;
        try { b = dimension.getBlock({ x, y, z }) || null; } catch (_) { b = null; }
        blockCacheB.set(k, b);
        return b;
    };

    const locX = Math.floor(loc.x);
    const locY = Math.floor(loc.y);
    const locZ = Math.floor(loc.z);

    const isReplaceable = (block) => {
        if (!block) return false;
        const id = block.typeId;
        if (id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water") return true;
        const replaceables = ["tallgrass", "lava", "snow_layer", "flower", "vines", "kelp", "fern"];
        return replaceables.some(tag => id.includes(tag));
    };
    const isAirWaterOrLava = (block) => {
        if (!block) return false;
        const id = block.typeId;
        return id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water" ||
            id === "minecraft:lava" || id === "minecraft:flowing_lava";
    };
    const isOpen = (block) => !block || isReplaceable(block) || isAirWaterOrLava(block);
    const hasClearance = (x, y, z, height) => {
        for (let i = 0; i < height; i++) {
            if (!isOpen(cachedBlockB(x, y + i, z))) return false;
        }
        return true;
    };

    function* calculateBuildingPath() {
        const start = { x: locX, y: locY, z: locZ };
        const goal = { x: Math.floor(tLoc.x), y: Math.floor(tLoc.y), z: Math.floor(tLoc.z) };
        const B = astarBounds(start, goal);
        const inBounds = (x, y, z) => x >= B.minX && x <= B.maxX && y >= B.minY && y <= B.maxY && z >= B.minZ && z <= B.maxZ;
        const isGoal = (n) => n.x === goal.x && n.y === goal.y && n.z === goal.z;
        const heuristic = (n) => {
            const ddx = n.x - goal.x;
            const ddy = n.y - goal.y;
            const ddz = n.z - goal.z;
            return Math.sqrt(ddx * ddx + ddz * ddz) + Math.abs(ddy) * 1.2;
        };
        const getNeighbors = (node) => {
            const neighbors = [];
            for (const { dx, dy, dz } of ASTAR_DIRECTIONS) {
                const nx = node.x + dx, ny = node.y + dy, nz = node.z + dz;
                if (!inBounds(nx, ny, nz)) continue;
                const isStairUp = dy === 1 && (dx !== 0 || dz !== 0);
                const isStairDown = dy === -1 && (dx !== 0 || dz !== 0);
                if (isStairUp && !hasClearance(node.x, node.y, node.z, 3)) continue;
                const requiredHeight = isStairDown ? 3 : 2;
                if (!hasClearance(nx, ny, nz, requiredHeight)) continue;
                const isStaircase = isStairUp || isStairDown;
                const cost = isStaircase ? 1.3 : dy !== 0 ? 1.5 : 1;
                neighbors.push({ x: nx, y: ny, z: nz, cost });
            }
            return neighbors;
        };
        const keyOf = (n) => `${n.x},${n.y},${n.z}`;
        if (isGoal(start)) { finishBuildingPath(null); return; }
        const open = [{ ...start, g: 0, f: heuristic(start) }];
        const cameFrom = new Map();
        const gScore = new Map([[keyOf(start), 0]]);
        const visited = new Set();
        let closestNode = start;
        let minH = heuristic(start);
        let expanded = 0;
        while (open.length > 0 && expanded < MAX_NODES) {
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const current = open.splice(bestIdx, 1)[0];
            const currentKey = keyOf(current);
            if (visited.has(currentKey)) continue;
            visited.add(currentKey);
            expanded++;
            if (expanded % 10 === 0) yield;
            if (!zombie.isValid) { activeJobs.delete(zombie.id); activeJobTick.delete(zombie.id); return; }
            if (isGoal(current)) {
                finishBuildingPath(reconstructB(cameFrom, currentKey));
                return;
            }
            for (const neighbor of getNeighbors(current)) {
                const nKey = keyOf(neighbor);
                if (visited.has(nKey)) continue;
                const h = heuristic(neighbor);
                if (h < minH) { minH = h; closestNode = neighbor; }
                const tentativeG = current.g + neighbor.cost;
                if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
                    gScore.set(nKey, tentativeG);
                    cameFrom.set(nKey, { parentKey: currentKey, node: neighbor });
                    open.push({ x: neighbor.x, y: neighbor.y, z: neighbor.z, g: tentativeG, f: tentativeG + h });
                }
            }
        }
        if (keyOf(closestNode) !== keyOf(start)) {
            finishBuildingPath(reconstructB(cameFrom, keyOf(closestNode)));
            return;
        }
        finishBuildingPath(null);
    }

    function reconstructB(cameFrom, key) {
        const path = [];
        while (cameFrom.has(key)) {
            const entry = cameFrom.get(key);
            path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
            key = entry.parentKey;
        }
        return path;
    }

    function finishBuildingPath(path) {
        activeJobs.delete(zombie.id);
        activeJobTick.delete(zombie.id);
        if (!zombie.isValid) return;
        if (!path || path.length === 0) {
            try { zombie.lookAt(target.getHeadLocation()); } catch (_) {}
            slog("build " + zombie.typeId + " SIN ruta");
            return;
        }
        const next = path[0];
        const tryPlaceSupport = (x, y, z) => {
            try {
                const b = cachedBlockB(x, y, z);
                if (!b || !isOpen(b)) return false;
                let blocked = false;
                try {
                    blocked = dimension.getEntitiesAtBlockLocation({ x, y, z })
                        .some(e => e.id !== zombie.id);
                } catch (_) {}
                if (blocked) return false;
                b.setType(blockType);
                try { dimension.playSound("use.gravel", { x, y, z }); } catch (_) {}
                return true;
            } catch (_) { return false; }
        };
        let placed = false;
        // Soporte bajo el siguiente nodo y TP encima (fiel al TEST: 1 bloque, decidido)
        if (tryPlaceSupport(next.x, next.y - 1, next.z)) placed = true;
        // Sin desatasco (logica TEST): si puso, animacion + TP encima; si no, camina el vanilla.
        if (placed) {
            swing(zombie, buildAnim);
            slog("build " + zombie.typeId + " PONE+AVANZA");
            try {
                zombie.teleport({ x: next.x + 0.5, y: next.y + 0.05, z: next.z + 0.5 }, { facingLocation: tLoc });
                teleportSlowness(zombie);
            } catch (_) {}
            return;
        }
        try { zombie.lookAt(target.getHeadLocation()); } catch (_) {}
    }

    try {
        const jobId = system.runJob(calculateBuildingPath());
        activeJobs.set(zombie.id, jobId);
        activeJobTick.set(zombie.id, tick);
    } catch (_) {}
}
