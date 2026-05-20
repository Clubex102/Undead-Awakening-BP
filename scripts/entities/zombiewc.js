import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME             = 40;
const MAX_DISTANCE           = 4.0;
const MAX_MINE_DISTANCE      = 1.4;
const STEP                   = 0.15;
const DIMENSIONS             = ["overworld", "nether", "the_end"];

// Evita spam extremo de comandos
const MAX_BLOCK_BREAKS_PER_TICK = 12;

let breaksThisTick = 0;

/* ================= FILTRO DE BLOQUES ================= */

const EXCLUDE_EXACT = new Set([

    // Utilidad
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

    // Sonido/interacción
    "minecraft:jukebox",
    "minecraft:note_block",

    // Abejas
    "minecraft:beehive",
    "minecraft:bee_nest",

    // Bamboo decorativo
    "minecraft:bamboo_mosaic",
    "minecraft:bamboo_mosaic_slab",
    "minecraft:bamboo_mosaic_stairs",

    // Contenedores
    "minecraft:chest",
    "minecraft:trapped_chest",
    "minecraft:barrel",
    "minecraft:hopper",
    "minecraft:dispenser",
    "minecraft:dropper"
]);

/* ================= EXCLUIR LOGS ================= */

const EXCLUDE_LOGS = new Set([

    // Oak
    "minecraft:oak_log",
    "minecraft:stripped_oak_log",
    "minecraft:oak_wood",
    "minecraft:stripped_oak_wood",

    // Spruce
    "minecraft:spruce_log",
    "minecraft:stripped_spruce_log",
    "minecraft:spruce_wood",
    "minecraft:stripped_spruce_wood",

    // Birch
    "minecraft:birch_log",
    "minecraft:stripped_birch_log",
    "minecraft:birch_wood",
    "minecraft:stripped_birch_wood",

    // Jungle
    "minecraft:jungle_log",
    "minecraft:stripped_jungle_log",
    "minecraft:jungle_wood",
    "minecraft:stripped_jungle_wood",

    // Acacia
    "minecraft:acacia_log",
    "minecraft:stripped_acacia_log",
    "minecraft:acacia_wood",
    "minecraft:stripped_acacia_wood",

    // Dark Oak
    "minecraft:dark_oak_log",
    "minecraft:stripped_dark_oak_log",
    "minecraft:dark_oak_wood",
    "minecraft:stripped_dark_oak_wood",

    // Mangrove
    "minecraft:mangrove_log",
    "minecraft:stripped_mangrove_log",
    "minecraft:mangrove_wood",
    "minecraft:stripped_mangrove_wood",

    // Cherry
    "minecraft:cherry_log",
    "minecraft:stripped_cherry_log",
    "minecraft:cherry_wood",
    "minecraft:stripped_cherry_wood",

    // Crimson
    "minecraft:crimson_stem",
    "minecraft:stripped_crimson_stem",
    "minecraft:crimson_hyphae",
    "minecraft:stripped_crimson_hyphae",

    // Warped
    "minecraft:warped_stem",
    "minecraft:stripped_warped_stem",
    "minecraft:warped_hyphae",
    "minecraft:stripped_warped_hyphae",

    // Bamboo
    "minecraft:bamboo_block",
    "minecraft:stripped_bamboo_block"
]);

/* ================= HOJAS ================= */

const EXTRA_MINEABLE = new Set([
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

/* ================= SUFIJOS EXCLUIDOS ================= */

const EXCLUDED_SUFFIXES = [
    "_button",
    "_sign",
    "_wall_sign",
    "_hanging_sign"
];

/* ================= FILTRO PRINCIPAL ================= */

function isMineable(block) {

    const id = block.typeId;

    // Exclusiones exactas
    if (EXCLUDE_EXACT.has(id)) return false;

    // Excluir logs
    if (EXCLUDE_LOGS.has(id)) return false;

    // Excluir derivados decorativos
    for (const suffix of EXCLUDED_SUFFIXES) {
        if (id.endsWith(suffix)) {
            return false;
        }
    }

    // Hojas siempre rompibles
    if (EXTRA_MINEABLE.has(id)) return true;

    // Excluir inventarios
    try {
        if (block.getComponent("minecraft:inventory")) {
            return false;
        }
    } catch (_) {}

    // Bloques rompibles
    return (
        block.hasTag("wood") ||
        block.hasTag("axe_item_destructible")
    );
}

/* ================= SONIDO ================= */

const LEAF_IDS = EXTRA_MINEABLE;

function playBreakSound(dimension, blockTypeId, pos) {

    const sound = LEAF_IDS.has(blockTypeId)
        ? "dig.grass"
        : "dig.wood";

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
            type: "udaw:zombiewc"
        });

        const vindicators = dimension.getEntities({
            type: "udaw:vindicatorzombie"
        });

        const allWorkers = [
            ...zombies,
            ...vindicators
        ];

        for (const zombie of allWorkers) {

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