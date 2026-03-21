import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME        = 40;
const MAX_DISTANCE      = 4.0;
const MAX_MINE_DISTANCE = 1.4;
const STEP              = 0.15;
const DIMENSIONS        = ["overworld", "nether", "the_end"];

/* ================= FILTRO DE BLOQUES ================= */

const EXCLUDE_EXACT = new Set([
    "minecraft:bookshelf",
    "minecraft:chiseled_bookshelf",
    "minecraft:crafting_table",
    "minecraft:cartography_table",
    "minecraft:fletching_table",
    "minecraft:smithing_table",
    "minecraft:lectern",
    "minecraft:composter",
    "minecraft:beehive",
    "minecraft:bee_nest",
    "minecraft:jukebox",
    "minecraft:note_block",
    "minecraft:bamboo_mosaic",
    "minecraft:bamboo_mosaic_slab",
    "minecraft:bamboo_mosaic_stairs"
]);

// Bloques de madera que siempre son rompibles
const EXTRA_MINEABLE = new Set([
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
    "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:azalea_leaves",
    "minecraft:flowering_azalea_leaves"
]);

function isMineable(block) {
    const id = block.typeId;

    // Excluir exactos
    if (EXCLUDE_EXACT.has(id)) return false;

    // Hojas siempre rompibles
    if (EXTRA_MINEABLE.has(id)) return true;

    // Rompible por hacha
    return block.hasTag("wood") ||
           block.hasTag("log")  ||
           block.hasTag("axe_item_destructible");
}

/* ================= SONIDO ================= */

const LEAF_IDS = new Set([
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
    "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:azalea_leaves",
    "minecraft:flowering_azalea_leaves"
]);

function playBreakSound(dimension, blockTypeId, pos) {
    const sound = LEAF_IDS.has(blockTypeId) ? "dig.grass" : "dig.wood";
    try {
        dimension.runCommand(`playsound ${sound} @a ${pos.x} ${pos.y} ${pos.z} 1.0 1.0`);
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
                if (d > MAX_MINE_DISTANCE) return null;
                return { block, pos };
            }
        }
    }

    return null;
}

/* ================= OFFSETS 2×2 ================= */

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

/* ================= 2×2 MINEABLE ================= */

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
            blocks.push({ pos, typeId: block.typeId });
        }
    }

    if (blocks.length === 0) return null;
    return blocks;
}

/* ================= MAIN LOOP ================= */

system.runInterval(() => {
    for (const dimId of DIMENSIONS) {
        const dimension = world.getDimension(dimId);
        const zombies   = dimension.getEntities({ type: "udaw:zombiewc" });

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
                zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
                continue;
            }

            const start = zombie.getDynamicProperty("mineStart");
            if (tick - start < BREAK_TIME) continue;

            const offsets = get2x2Offsets(zombie);
            const blocks  = getMineable2x2(dimension, target.pos, offsets);

            if (!blocks) {
                zombie.setDynamicProperty("mineStart", null);
                zombie.setDynamicProperty("minePos", null);
                continue;
            }

            for (const { pos, typeId } of blocks) {
                playBreakSound(dimension, typeId, pos);
                dimension.setBlockType(pos, "minecraft:air");
            }

            zombie.setDynamicProperty("mineStart", null);
            zombie.setDynamicProperty("minePos", null);
        }
    }
}, 2);