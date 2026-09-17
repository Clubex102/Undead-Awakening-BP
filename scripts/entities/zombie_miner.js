import { world, system } from "@minecraft/server";
import { siegeMineStep, siegeBuildStep } from "../siege.js";

/* ================= CONFIG ================= */

const BREAK_TIME        = 40;
const MAX_DISTANCE      = 1.6;
const MAX_MINE_DISTANCE = 1.4;
const STEP              = 0.3;
const DIMENSIONS        = ["overworld", "nether", "the_end"];

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

/* ================= RAYCAST (detector: fija objetivo, ROMPE el asedio) ================= */

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

/* ================= MAIN LOOP ================= */

system.runInterval(() => {

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

            // Puerta del asedio: si hay cooldown (jobs llenos/reintento),
            // espera SIN resetear el stare para no perder el turno
            let siegeReady = true;
            try { siegeReady = tick >= (Number(zombie.getDynamicProperty("udaw:siege_next")) || 0); } catch (_) {}
            if (!siegeReady) continue;

            // El raycast FIJA el objetivo; ROMPE el asedio (A* con perfil de pico)
            let launched = false;
            try { launched = siegeMineStep(zombie, "miner", true); } catch (_) {}
            if (!launched) continue;

            zombie.setDynamicProperty("mineStart", null);
            zombie.setDynamicProperty("minePos", null);
        }
    }

// Raycast cada 10 ticks (el stare es de 40t; no pierde nada y gasta 5x menos)
}, 10);

/* ================= ZOMBIE SHOVEL — PUENTEO (asedio TEST, sin desatasco) ================= */

const SHOVEL_ID   = "udaw:zombie_shovel";
const SHOVEL_ANIM = "animation.zombieshovel.construct";

const shovelTracked = new Set();

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
});

/* ================= SHOVEL LOOP (puenteo TEST + TP al poner, sin desatasco) ================= */

system.runInterval(() => {

    if (shovelTracked.size === 0) return;

    for (const entity of shovelTracked) {

        try {

            try {
                const _ = entity.location;
            } catch {

                shovelTracked.delete(entity);

                continue;
            }

            try { siegeBuildStep(entity, SHOVEL_ANIM); } catch (_) {}

        } catch (_) {}

    }

}, 2);
