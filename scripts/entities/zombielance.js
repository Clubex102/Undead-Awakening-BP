import { world, system, EntityDamageCause } from "@minecraft/server";

// =============================================
// CONFIGURACIÓN
// =============================================
const CONFIG = {
    ENTITY_TYPE_ID:       "udaw:zombie_lance",
    COOLDOWN_TICKS:       100,   // 5 segundos (20 ticks = 1s)
    LUNGE_DURATION_TICKS: 10,    // Duración de la estocada en ticks
    LUNGE_SPEED:          0.5,   // Fuerza del impulso por tick (knockback horizontal)
    DAMAGE:               6,     // Daño aplicado al impactar
    DAMAGE_REACH:         2.0,   // Metros hacia adelante donde se comprueba el daño
    DAMAGE_RADIUS:        1.5,   // Radio del área de daño en ese punto
    MIN_RANGE:            3,     // Distancia mínima al objetivo para activar la estocada
    MAX_RANGE:            10,    // Distancia máxima al objetivo para activar la estocada
    FACING_DOT_THRESHOLD: 0.6,   // Qué tan "de frente" debe estar mirando al objetivo (0-1)
};

// Estado por entidad: entityId (string) -> objeto de estado
const lungeMap = new Map();

// =============================================
// UTILIDADES
// =============================================

/** Vector hacia adelante según el yaw de la entidad */
function getForwardVector(entity) {
    const rot = entity.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    return {
        x: -Math.sin(rad),
        y: 0,
        z:  Math.cos(rad),
    };
}

/** Distancia 3D */
function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Normaliza un vector 2D (XZ) */
function normalize2D(v) {
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len === 0) return { x: 0, z: 0 };
    return { x: v.x / len, z: v.z / len };
}

/** Producto punto 2D */
function dot2D(a, b) {
    return a.x * b.x + a.z * b.z;
}

// =============================================
// BÚSQUEDA DE OBJETIVO
// =============================================

/**
 * Devuelve la entidad objetivo más cercana dentro del rango válido
 * que esté aproximadamente enfrente de la entidad atacante.
 */
function findTarget(attacker) {
    const pos  = attacker.location;
    const fwd  = getForwardVector(attacker);

    const candidates = attacker.dimension.getEntities({
        location: pos,
        maxDistance: CONFIG.MAX_RANGE,
    });

    let best     = null;
    let bestDist = Infinity;

    for (const e of candidates) {
        if (e === attacker) continue;
        if (e.typeId === CONFIG.ENTITY_TYPE_ID) continue;

        const d = dist3D(pos, e.location);
        if (d < CONFIG.MIN_RANGE) continue;
        if (d > CONFIG.MAX_RANGE) continue;

        // Comprobar que el objetivo esté dentro del cono frontal
        const toTarget = normalize2D({
            x: e.location.x - pos.x,
            z: e.location.z - pos.z,
        });
        const facing = dot2D(fwd, toTarget);
        if (facing < CONFIG.FACING_DOT_THRESHOLD) continue;

        if (d < bestDist) {
            best     = e;
            bestDist = d;
        }
    }

    return best;
}

// =============================================
// DAÑO
// =============================================

/**
 * Aplica daño en el punto de impacto de la estocada.
 */
function applyLungeDamage(attacker, direction) {
    const pos = attacker.location;

    const checkPos = {
        x: pos.x + direction.x * CONFIG.DAMAGE_REACH,
        y: pos.y + 0.8,
        z: pos.z + direction.z * CONFIG.DAMAGE_REACH,
    };

    const nearby = attacker.dimension.getEntities({
        location: checkPos,
        maxDistance: CONFIG.DAMAGE_RADIUS,
    });

    for (const e of nearby) {
        if (e === attacker) continue;
        if (e.typeId === CONFIG.ENTITY_TYPE_ID) continue;

        const toE = normalize2D({
            x: e.location.x - pos.x,
            z: e.location.z - pos.z,
        });
        if (dot2D(direction, toE) < 0.3) continue;

        try {
            e.applyDamage(CONFIG.DAMAGE, {
                cause: EntityDamageCause.entityAttack,
                damagingEntity: attacker,
            });
        } catch (_) { /* entidad removida */ }
    }
}

// =============================================
// TICK DE LUNGE
// =============================================

function tickLunge(entity, state) {
    if (state.phase === "lunge") {

        // Movimiento por teleport incremental — compatible con @minecraft/server 1.21.0
        // sin depender de clearVelocity ni applyKnockback.
        const currentPos = entity.location;
        const rot = entity.getRotation();
        entity.teleport(
            {
                x: currentPos.x + state.direction.x * CONFIG.LUNGE_SPEED,
                y: currentPos.y,
                z: currentPos.z + state.direction.z * CONFIG.LUNGE_SPEED,
            },
            {
                dimension: entity.dimension,
                rotation: { x: rot.x, y: rot.y },
            }
        );

        const half = Math.floor(CONFIG.LUNGE_DURATION_TICKS / 2);
        if (!state.damageDone && state.ticksLeft <= half) {
            applyLungeDamage(entity, state.direction);
            state.damageDone = true;
        }

        state.ticksLeft--;
        if (state.ticksLeft <= 0) {
            state.phase        = "cooldown";
            state.cooldownLeft = CONFIG.COOLDOWN_TICKS;
        }

    } else if (state.phase === "cooldown") {
        state.cooldownLeft--;
        if (state.cooldownLeft <= 0) {
            lungeMap.delete(entity.id);
        }
    }
}

// =============================================
// LOOP PRINCIPAL
// =============================================

// Nombres correctos de dimensiones en la Bedrock Scripting API
const DIMENSIONS = ["overworld", "nether", "the end"];

system.runInterval(() => {

    // 1. Actualizar entidades que ya están en lunge/cooldown
    for (const [id, state] of lungeMap.entries()) {
        let found = null;

        for (const dimName of DIMENSIONS) {
            try {
                const dim = world.getDimension(dimName);
                const list = dim.getEntities({ typeId: CONFIG.ENTITY_TYPE_ID });
                found = list.find(e => e.id === id);
                if (found) break;
            } catch (_) { continue; }
        }

        if (!found || !found.isValid()) {
            lungeMap.delete(id);
            continue;
        }

        tickLunge(found, state);
    }

    // 2. Detectar nuevas entidades que deban iniciar el ataque
    for (const dimName of DIMENSIONS) {
        let dim;
        try {
            dim = world.getDimension(dimName);
        } catch (_) { continue; }

        let zombies;
        try {
            zombies = dim.getEntities({ typeId: CONFIG.ENTITY_TYPE_ID });
        } catch (_) { continue; }

        for (const zombie of zombies) {
            if (!zombie.isValid()) continue;
            if (lungeMap.has(zombie.id)) continue;

            const target = findTarget(zombie);
            if (!target) continue;

            // Dirección capturada al inicio — fija durante todo el lunge
            const direction = getForwardVector(zombie);

            lungeMap.set(zombie.id, {
                phase:        "lunge",
                ticksLeft:    CONFIG.LUNGE_DURATION_TICKS,
                direction:    direction,
                damageDone:   false,
                cooldownLeft: 0,
            });
        }
    }

}, 1);