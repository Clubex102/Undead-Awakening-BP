import { world, system, EntityDamageCause } from "@minecraft/server";

/* ================= CONFIG ================= */

const ENTITY_TYPE_ID   = "udaw:zombie_lance";
const COOLDOWN_TICKS   = 100;   // 5 segundos
const MAX_RANGE        = 7;     // Distancia máxima al objetivo para activar
const DASH_POWER       = 2.0;   // Fuerza del impulso horizontal
const DASH_POWER_Y     = 0.2;   // Pequeño impulso vertical para que no se atasque en el suelo
const DAMAGE           = 6;     // Daño al impactar
const DAMAGE_RADIUS    = 2.0;   // Radio de daño tras el impulso

const DIMENSIONS = ["overworld", "nether", "the end"];

/* ================= ESTADO ================= */

// entityId -> tick en que podrá volver a atacar
const cooldownMap = new Map();

/* ================= UTILIDADES ================= */

function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalize2D(dx, dz) {
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) return { x: 0, z: 0 };
    return { x: dx / len, z: dz / len };
}

/* ================= BUSCAR OBJETIVO ================= */

function findTarget(entity) {
    const pos = entity.location;

    const candidates = entity.dimension.getEntities({
        location: pos,
        maxDistance: MAX_RANGE,
    });

    let best     = null;
    let bestDist = Infinity;

    for (const e of candidates) {
        if (e === entity) continue;
        if (e.typeId === ENTITY_TYPE_ID) continue;

        // Solo atacar jugadores, aldeanos y golems (igual que el JSON)
        const validTypes = [
            "minecraft:player",
            "minecraft:villager",
            "minecraft:villager_v2",
            "minecraft:pillager",
            "minecraft:evoker",
            "minecraft:witch",
            "minecraft:ravager",
            "minecraft:vindicator",
            "minecraft:iron_golem",
            "minecraft:snow_golem",
        ];
        if (!validTypes.includes(e.typeId)) continue;

        const d = dist3D(pos, e.location);
        if (d < bestDist) {
            best     = e;
            bestDist = d;
        }
    }

    return best;
}

/* ================= DAÑO POST-DASH ================= */

function applyDashDamage(entity) {
    const pos = entity.location;

    const nearby = entity.dimension.getEntities({
        location: pos,
        maxDistance: DAMAGE_RADIUS,
    });

    for (const e of nearby) {
        if (e === entity) continue;
        if (e.typeId === ENTITY_TYPE_ID) continue;

        try {
            e.applyDamage(DAMAGE, {
                cause: EntityDamageCause.entityAttack,
                damagingEntity: entity,
            });
        } catch (_) {}
    }
}

/* ================= MAIN LOOP ================= */

system.runInterval(() => {
    const tick = system.currentTick;

    for (const dimName of DIMENSIONS) {
        let dimension;
        try { dimension = world.getDimension(dimName); }
        catch (_) { continue; }

        let entities;
        try { entities = dimension.getEntities({ typeId: ENTITY_TYPE_ID }); }
        catch (_) { continue; }

        for (const entity of entities) {
            try {
                // Validación crítica: asegurar que es realmente un zombie_lance
                if (entity.typeId !== ENTITY_TYPE_ID) continue;
                
                const id = entity.id;

                // Verificar cooldown
                const readyAt = cooldownMap.get(id) ?? 0;
                if (tick < readyAt) continue;

                // Buscar objetivo en rango
                const target = findTarget(entity);
                if (!target) continue;

                // Calcular dirección hacia el objetivo
                const pos  = entity.location;
                const tPos = target.location;
                const dir  = normalize2D(tPos.x - pos.x, tPos.z - pos.z);

                // Reproducir animación de ataque
                entity.playAnimation("animation.zombielance.attack2");

                // Aplicar impulso SOLO al zombie_lance
                entity.applyImpulse({
                    x: dir.x * DASH_POWER,
                    y: DASH_POWER_Y,
                    z: dir.z * DASH_POWER,
                });

                // Aplicar daño a lo que haya cerca tras el impulso
                system.runTimeout(() => {
                    try { applyDashDamage(entity); } catch (_) {}
                }, 4);

                // Registrar cooldown
                cooldownMap.set(id, tick + COOLDOWN_TICKS);

            } catch (_) {
                // Entidad inválida o removida, ignorar
            }
        }
    }

}, 10); // Revisar cada 10 ticks es suficiente, no necesita ser cada tick