import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME        = 40;
const MAX_DISTANCE      = 4.0;
const MAX_MINE_DISTANCE = 1.4;
const STEP              = 0.15;
const DIMENSIONS        = ["overworld", "nether", "the_end"];

// Evita spam extremo de comandos
const MAX_BLOCK_BREAKS_PER_TICK = 12;

let breaksThisTick = 0;

/* ================= FILTRO DE BLOQUES ================= */

const EXCLUDE_CONTAINS = [
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

const EXCLUDE_EXACT = new Set([
    "minecraft:brick_block",
    "minecraft:nether_brick",
    "minecraft:red_nether_brick",
    "minecraft:clay",
    "minecraft:packed_mud"
]);

const EXTRA_MINEABLE = new Set([
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

function isMineable(block) {

    const id = block.typeId;

    if (EXTRA_MINEABLE.has(id)) return true;
    if (EXCLUDE_EXACT.has(id)) return false;

    for (const fragment of EXCLUDE_CONTAINS) {
        if (id.includes(fragment)) {
            return false;
        }
    }

    return (
        block.hasTag("stone") ||
        block.hasTag("metal") ||
        block.hasTag("diamond_pick_diggable") ||
        block.hasTag("iron_pick_diggable") ||
        block.hasTag("stone_pick_diggable") ||
        block.hasTag("wood_pick_diggable")
    );
}

/* ================= SONIDO ================= */

const DIRT_IDS = new Set([
    "minecraft:dirt",
    "minecraft:grass_block",
    "minecraft:sand",
    "minecraft:gravel"
]);

function playBreakSound(dimension, blockTypeId, pos) {

    const sound = DIRT_IDS.has(blockTypeId)
        ? "dig.gravel"
        : "dig.stone";

    try {
        dimension.runCommand(
            `playsound ${sound} @a ${pos.x} ${pos.y} ${pos.z} 1.0 1.0`
        );
    } catch (_) {}
}

/* ================= RAYCAST ================= */

function getLookBlock(entity) {

    const dir    = entity.getViewDirection();
    const origin = entity.getHeadLocation();
    const dim    = entity.dimension;

    const CHECK_OFFSETS = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 }
    ];

    for (let d = 0.5; d <= MAX_DISTANCE; d += STEP) {

        const basePos = {
            x: Math.floor(origin.x + dir.x * d),
            y: Math.floor(origin.y + dir.y * d),
            z: Math.floor(origin.z + dir.z * d)
        };

        for (const o of CHECK_OFFSETS) {

            const pos = {
                x: basePos.x + o.x,
                y: basePos.y + o.y,
                z: basePos.z + o.z
            };

            const block = dim.getBlock(pos);

            if (block && block.typeId !== "minecraft:air") {

                if (d > MAX_MINE_DISTANCE) {
                    return null;
                }

                return { block, pos };
            }
        }
    }

    return null;
}

/* ================= OFFSETS 2x2 ================= */

function get2x2Offsets(entity) {

    const dir = entity.getViewDirection();

    if (Math.abs(dir.x) > Math.abs(dir.z)) {

        return [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 1, z: 1 }
        ];

    } else {

        return [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 1, y: 1, z: 0 }
        ];
    }
}

/* ================= 2x2 MINEABLE ================= */

function getMineable2x2(dimension, basePos, offsets) {

    const blocks = [];

    for (const o of offsets) {

        const pos = {
            x: basePos.x + o.x,
            y: basePos.y + o.y,
            z: basePos.z + o.z
        };

        const block = dimension.getBlock(pos);

        if (block && isMineable(block)) {

            blocks.push({
                pos,
                typeId: block.typeId
            });
        }
    }

    return blocks.length > 0
        ? blocks
        : null;
}

/* ================= MAIN LOOP ================= */

system.runInterval(() => {

    breaksThisTick = 0;

    for (const dimId of DIMENSIONS) {

        const dimension = world.getDimension(dimId);

        const zombies = dimension.getEntities({
            type: "udaw:zombieminer"
        });

        for (const zombie of zombies) {

            const target = getLookBlock(zombie);
            const tick   = system.currentTick;

            if (!target || !isMineable(target.block)) {

                zombie.setDynamicProperty("mineStart", null);
                zombie.setDynamicProperty("minePos", null);

                continue;
            }

            if (!zombie.getDynamicProperty("mineStart")) {

                zombie.setDynamicProperty("mineStart", tick);

                zombie.setDynamicProperty(
                    "minePos",
                    JSON.stringify(target.pos)
                );

                continue;
            }

            const start = zombie.getDynamicProperty("mineStart");

            if (tick - start < BREAK_TIME) {
                continue;
            }

            const offsets = get2x2Offsets(zombie);

            const blocks = getMineable2x2(
                dimension,
                target.pos,
                offsets
            );

            if (!blocks) {

                zombie.setDynamicProperty("mineStart", null);
                zombie.setDynamicProperty("minePos", null);

                continue;
            }

            for (const { pos, typeId } of blocks) {

                // Protección anti-lag
                if (breaksThisTick >= MAX_BLOCK_BREAKS_PER_TICK) {
                    break;
                }

                playBreakSound(dimension, typeId, pos);

                try {

                    // Destruye naturalmente y dropea loot
                    dimension.runCommand(
                        `setblock ${pos.x} ${pos.y} ${pos.z} air destroy`
                    );

                    breaksThisTick++;

                } catch (_) {}
            }

            zombie.setDynamicProperty("mineStart", null);
            zombie.setDynamicProperty("minePos", null);
        }
    }

}, 2);

/* ================= ZOMBIE SHOVEL — ESCALERA ================= */

const SHOVEL_ID         = "udaw:zombie_shovel";
const STAIR_COOLDOWN    = 60;
const STAIR_Y_THRESHOLD = 1;
const STAIR_ANIM_TICKS  = 40;
const DIRT_BLOCK        = "minecraft:dirt";

const shovelCooldowns = new Map();
const shovelTracked   = new Set();
const shovelBuildMemory = new Map();

/* ================= HELPERS ================= */

function dist3D(a, b) {

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getHorizDir(from, to) {

    const dx = to.x - from.x;
    const dz = to.z - from.z;

    const len = Math.sqrt(dx * dx + dz * dz) || 1;

    return {
        x: Math.round(dx / len),
        z: Math.round(dz / len)
    };
}

function getPerp(dir) {

    return {
        x: dir.z,
        z: -dir.x
    };
}
function directionChanged(entity, target) {

    const memory =
        shovelBuildMemory.get(entity.id);

    if (!memory)
        return false;

    const newDir = getHorizDir(
        entity.location,
        target.location
    );

    return (
        newDir.x !== memory.dirX ||
        newDir.z !== memory.dirZ
    );
}
function isSkybaseTarget(entity, target) {

    const dim = entity.dimension;

    const targetPos = {
        x: Math.floor(target.location.x),
        y: Math.floor(target.location.y),
        z: Math.floor(target.location.z)
    };

    let airCount = 0;

    for (let i = 1; i <= 8; i++) {

        try {

            const block = dim.getBlock({
                x: targetPos.x,
                y: targetPos.y - i,
                z: targetPos.z
            });

            if (
                block &&
                block.typeId === "minecraft:air"
            ) {
                airCount++;
            }

        } catch (_) {}
    }

    return airCount >= 6;
}
/* ================= ESCALERA ================= */

function placeStairStep(entity, target) {

const dim = entity.dimension;

let memory =
    shovelBuildMemory.get(entity.id);

let pos;
let dir;

if (memory) {

    pos = {
        x: memory.x,
        y: memory.y,
        z: memory.z
    };

} else {

    pos = entity.location;
}

dir = getHorizDir(
    pos,
    target.location
);

const perp = getPerp(dir);

    const baseY = Math.floor(pos.y);
    const baseX = Math.floor(pos.x);
    const baseZ = Math.floor(pos.z);

const positions = [

    {
        x: baseX + dir.x,
        y: baseY,
        z: baseZ + dir.z
    },

    {
        x: baseX + dir.x + perp.x,
        y: baseY,
        z: baseZ + dir.z + perp.z
    }
];

    let placed = 0;
let highestPlaced = null;

    for (const p of positions) {

        try {

            const block = dim.getBlock(p);

            if (block && block.typeId === "minecraft:air") {

dim.setBlockType(p, DIRT_BLOCK);

highestPlaced = p;

placed++;
            }

        } catch (_) {}
    }
        
if (highestPlaced) {

    shovelBuildMemory.set(
        entity.id,
        {
            x: highestPlaced.x,
            y: highestPlaced.y,
            z: highestPlaced.z
        }
    );
}
    if (placed > 0) {

        try {

            dim.runCommand(
                `playsound dig.gravel @a ${pos.x} ${pos.y} ${pos.z} 1.0 1.0`
            );

        } catch (_) {}
    }
}

/* ================= TARGET ================= */
function findShovelTarget(entity) {

    const candidates = entity.dimension.getEntities({
        location: entity.location,
        maxDistance: 30
    });

    let best = null;
    let bestScore = -9999;

    for (const e of candidates) {

        if (e === entity) continue;

        if (
            ![
                "minecraft:player",
                "minecraft:villager",
                "minecraft:villager_v2",
                "minecraft:iron_golem",
                "minecraft:wandering_trader"
            ].includes(e.typeId)
        ) continue;

        const dx =
            e.location.x - entity.location.x;

        const dz =
            e.location.z - entity.location.z;

        const horizontalDist =
            Math.sqrt(dx * dx + dz * dz);

        const heightDiff =
            e.location.y - entity.location.y;

        let score = 0;

        score += heightDiff * 8;

        score -= horizontalDist;

        if (score > bestScore) {

            bestScore = score;
            best = e;
        }
    }

    return best;
}
/* ================= CONSTRUCT ================= */

function executeShovelConstruct(entity) {

    const id = entity.id;

    try {
        const _ = entity.location;
    } catch {
        shovelTracked.delete(entity);
        return;
    }

    try {

        entity.addEffect(
            "slowness",
            STAIR_ANIM_TICKS,
            {
                amplifier: 255,
                showParticles: false
            }
        );

    } catch (_) {}

    try {
        entity.playAnimation(
            "animation.zombieshovel.construct"
        );
    } catch (_) {}

    const startPos = {
        x: entity.location.x,
        y: entity.location.y,
        z: entity.location.z
    };

    const target = findShovelTarget(entity);

    if (!target) return;

    system.runTimeout(() => {

        try {

            if (!shovelTracked.has(entity)) {
                return;
            }

            const currentPos = entity.location;

            const dx = currentPos.x - startPos.x;
            const dy = currentPos.y - startPos.y;
            const dz = currentPos.z - startPos.z;

            const moved = Math.sqrt(
                dx * dx +
                dy * dy +
                dz * dz
            );

            if (moved > 2) return;

            placeStairStep(entity, target);

        } catch (_) {}

    }, STAIR_ANIM_TICKS);
}

/* ================= SPAWN ================= */

world.afterEvents.entitySpawn.subscribe((event) => {

    const entity = event.entity;

    if (entity.typeId !== SHOVEL_ID) return;

    shovelTracked.add(entity);
});

/* ================= DEATH ================= */

world.afterEvents.entityDie.subscribe((event) => {

    const entity = event.deadEntity;

    if (entity.typeId !== SHOVEL_ID) return;

    shovelTracked.delete(entity);
    shovelCooldowns.delete(entity.id);
    shovelBuildMemory.delete(entity.id);
});

/* ================= SHOVEL LOOP ================= */

system.runInterval(() => {

    if (shovelTracked.size === 0) return;

    const tick = system.currentTick;

    for (const entity of shovelTracked) {

        try {

            try {
                const _ = entity.location;
            } catch {

                shovelTracked.delete(entity);
                shovelCooldowns.delete(entity.id);

                continue;
            }

            const id = entity.id;

            const readyAt =
                shovelCooldowns.get(id) ?? 0;

            if (tick < readyAt) continue;

const target = findShovelTarget(entity);

if (!target) continue;

const memory =
    shovelBuildMemory.get(id);

if (memory) {

    const movedTarget =

        Math.abs(
            Math.floor(target.location.x)
            - memory.targetX
        ) > 3 ||

        Math.abs(
            Math.floor(target.location.z)
            - memory.targetZ
        ) > 3;

    if (movedTarget) {

        shovelBuildMemory.delete(id);
    }
}
            if (
    shovelBuildMemory.has(id) &&
    directionChanged(entity, target)
) {

    shovelBuildMemory.delete(id);
}

            const dyDiff =
    target.location.y -
    entity.location.y;

if (dyDiff <= STAIR_Y_THRESHOLD) {

    shovelBuildMemory.delete(id);

    continue;
}

            if (
                target.typeId === "minecraft:player" &&
                !isSkybaseTarget(entity, target)
            ) {
                continue;
            }

            executeShovelConstruct(entity);
            shovelCooldowns.set(id, tick + STAIR_COOLDOWN);

        } catch (_) {}

    }

}, 2);