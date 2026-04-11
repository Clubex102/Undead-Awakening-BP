import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME      = 40;
const MAX_DISTANCE    = 4.0;
const MAX_MINE_DISTANCE = 1.4;
const STEP            = 0.15;
const DIMENSIONS      = ["overworld", "nether", "the_end"];

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
        if (id.includes(fragment)) return false;
    }

    return block.hasTag("stone")                 ||
           block.hasTag("metal")                 ||
           block.hasTag("diamond_pick_diggable") ||
           block.hasTag("iron_pick_diggable")    ||
           block.hasTag("stone_pick_diggable")   ||
           block.hasTag("wood_pick_diggable");}

/* ================= SONIDO ================= */

const DIRT_IDS = new Set([
    "minecraft:dirt", "minecraft:grass_block",
    "minecraft:sand", "minecraft:gravel"
]);

function playBreakSound(dimension, blockTypeId, pos) {
    const sound = DIRT_IDS.has(blockTypeId) ? "dig.gravel" : "dig.stone";
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
        const zombies   = dimension.getEntities({ type: "udaw:zombieminer" });

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

/* ================= ZOMBIE SHOVEL — ESCALERA ================= */

const SHOVEL_ID         = "udaw:zombie_shovel";
const STAIR_COOLDOWN    = 60;  // 3 segundos en ticks
const STAIR_Y_THRESHOLD = 1;   // bloques de diferencia en Y para activar
const STAIR_ANIM_TICKS  = 40;  // 2 segundos en ticks
const DIRT_BLOCK        = "minecraft:dirt";

const shovelCooldowns = new Map(); // id -> tick listo
const shovelTracked   = new Set(); // referencias directas

// Calcular distancia 3D
function dist3D(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Obtener direccion horizontal hacia el objetivo (normalizada, solo X y Z)
function getHorizDir(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return {
        x: Math.round(dx / len), // snap a -1, 0 o 1
        z: Math.round(dz / len)
    };
}

// Obtener el vector perpendicular horizontal para el ancho 2x2
function getPerp(dir) {
    // Perpendicular en el plano XZ: (z, -x)
    return { x: dir.z, z: -dir.x };
}

function placeStairStep(entity, target) {
    const dim     = entity.dimension;
    const pos     = entity.location;
    const dir     = getHorizDir(pos, target.location);
    const perp    = getPerp(dir);

    // Base del escalón (donde están los pies del zombie)
    const baseY = Math.floor(pos.y);
    const baseX = Math.floor(pos.x);
    const baseZ = Math.floor(pos.z);

    // Colocar 4 bloques en forma de escalera 2x2:
    // - 2 bloques en nivel actual (pos donde está el zombie)
    // - 2 bloques en nivel +1 pero 1 bloque más adelante (para subir diagonalmente)
    const positions = [
        // Parte baja (donde pisa el zombie)
        { x: baseX + dir.x,          y: baseY, z: baseZ + dir.z },
        { x: baseX + dir.x + perp.x, y: baseY, z: baseZ + dir.z + perp.z },
        // Parte alta (1 escalón arriba y 1 bloque hacia adelante)
        { x: baseX + 2*dir.x,          y: baseY + 1, z: baseZ + 2*dir.z },
        { x: baseX + 2*dir.x + perp.x, y: baseY + 1, z: baseZ + 2*dir.z + perp.z }
    ];

    let placed = 0;
    for (const p of positions) {
        try {
            const block = dim.getBlock(p);
            if (block && block.typeId === "minecraft:air") {
                dim.setBlockType(p, DIRT_BLOCK);
                placed++;
            }
        } catch (_) {}
    }

    // Sonido de tierra (solo si se colocaron bloques)
    if (placed > 0) {
        try {
            dim.runCommand(`playsound dig.gravel @a ${pos.x} ${pos.y} ${pos.z} 1.0 1.0`);
        } catch (_) {}
    }
}

function findShovelTarget(entity) {
    const candidates = entity.dimension.getEntities({
        location: entity.location,
        maxDistance: 20
    });

    let best = null;
    let bestDist = Infinity;

    for (const e of candidates) {
        if (e === entity) continue;
        if (!["minecraft:player", "minecraft:villager", "minecraft:villager_v2",
              "minecraft:iron_golem", "minecraft:wandering_trader"].includes(e.typeId)) continue;
        const d = dist3D(entity.location, e.location);
        if (d < bestDist) { best = e; bestDist = d; }
    }
    return best;
}

function executeShovelConstruct(entity) {
    const id = entity.id;

    // Validar que la entidad siga siendo válida
    try {
        const _ = entity.location; // Test si existe
    } catch {
        shovelTracked.delete(entity);
        return;
    }

    // Slowness durante la animacion
    try {
        entity.addEffect("slowness", STAIR_ANIM_TICKS, { amplifier: 255, showParticles: false });
    } catch (_) {}

    try { entity.playAnimation("animation.zombieshovel.construct"); } catch (_) {}

    // Guardar posición y objetivo AHORA (antes del timeout)
    const startPos = { x: entity.location.x, y: entity.location.y, z: entity.location.z };
    const target = findShovelTarget(entity);
    if (!target) return;

    // Colocar bloques al terminar la animacion
    system.runTimeout(() => {
        try {
            // Verificar que el entity siga válido
            if (!shovelTracked.has(entity)) return;
            const currentPos = entity.location;
            
            // Si el zombie se movió mucho, no colocar bloques (evita bugs)
            const dx = currentPos.x - startPos.x;
            const dy = currentPos.y - startPos.y;
            const dz = currentPos.z - startPos.z;
            const moved = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (moved > 2) return; // Se movió demasiado
            
            placeStairStep(entity, target);
        } catch (_) {}
    }, STAIR_ANIM_TICKS);
}

// Spawn — iniciar tracking
world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== SHOVEL_ID) return;
    shovelTracked.add(entity);
});

// Muerte — limpiar
world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (entity.typeId !== SHOVEL_ID) return;
    shovelTracked.delete(entity);
    shovelCooldowns.delete(entity.id);
});

// Loop del shovel
system.runInterval(() => {
    if (shovelTracked.size === 0) return;
    const tick = system.currentTick;

    for (const entity of shovelTracked) {
        try {
            // Verificar que la entidad sea válida
            try {
                const _ = entity.location;
            } catch {
                shovelTracked.delete(entity);
                shovelCooldowns.delete(entity.id);
                continue;
            }

            const id = entity.id;
            const readyAt = shovelCooldowns.get(id) ?? 0;
            if (tick < readyAt) continue;

            const target = findShovelTarget(entity);
            if (!target) continue;

            // Solo activar si el objetivo está a más de 4 bloques de distancia vertical
            const dyDiff = Math.abs(target.location.y - entity.location.y);
            if (dyDiff <= STAIR_Y_THRESHOLD) continue;

            shovelCooldowns.set(id, tick + STAIR_COOLDOWN);
            executeShovelConstruct(entity);
        } catch (_) {
            shovelTracked.delete(entity);
            shovelCooldowns.delete(entity.id);
        }
    }
}, 10);