import { world, system, EntityDamageCause } from "@minecraft/server";

// =============================================
// CONFIGURACIÓN DEL ATAQUE
// =============================================
const CONFIG = {
    ENTITY_ID: "udaw:zombie_lance",
    COOLDOWN_TICKS: 100,          // 5 segundos (20 ticks = 1 segundo)
    LUNGE_SPEED: 0.6,             // Velocidad de movimiento por tick
    LUNGE_DURATION_TICKS: 8,      // Duración total del lanzamiento (ticks)
    DAMAGE: 6,                    // Daño aplicado
    DAMAGE_RANGE: 1.5,            // Radio de hitbox de daño al frente
    MIN_TARGET_DISTANCE: 3,       // Distancia mínima al objetivo para activar
    MAX_TARGET_DISTANCE: 10,      // Distancia máxima al objetivo para activar
    DAMAGE_REACH: 2.2,            // Cuántos bloques hacia adelante se revisa el daño
};

// Mapa de estado por entidad (usando entity.id como clave)
const lungeState = new Map();

// =============================================
// UTILIDADES
// =============================================

/**
 * Obtiene el vector de dirección hacia adelante de una entidad
 * basado en su rotación (yaw).
 */
function getForwardVector(entity) {
    const rotation = entity.getRotation();
    const yawRad = (rotation.y * Math.PI) / 180;
    return {
        x: -Math.sin(yawRad),
        y: 0,
        z: Math.cos(yawRad),
    };
}

/**
 * Distancia 2D (ignorando Y) entre dos posiciones.
 */
function dist2D(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Distancia 3D entre dos posiciones.
 */
function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// =============================================
// LÓGICA DEL ATAQUE
// =============================================

/**
 * Inicia el ataque de estocada si las condiciones se cumplen.
 */
function tryStartLunge(entity) {
    const id = entity.id;

    // Verificar cooldown
    const state = lungeState.get(id);
    if (state) return; // Ya está en ataque o cooldown

    // Buscar objetivo (jugador más cercano en rango válido)
    const pos = entity.location;
    const target = findValidTarget(entity, pos);
    if (!target) return;

    // Capturar dirección al inicio del ataque (fija durante todo el lanzamiento)
    const forward = getForwardVector(entity);

    // Iniciar estado de lunge
    lungeState.set(id, {
        phase: "lunge",        // "lunge" o "cooldown"
        ticksLeft: CONFIG.LUNGE_DURATION_TICKS,
        direction: forward,
        damageDone: false,
        cooldownLeft: 0,
    });
}

/**
 * Busca un objetivo válido en el rango min-max del ataque.
 */
function findValidTarget(entity, pos) {
    // Busca jugadores en el rango máximo dentro de la dimensión
    const nearbyEntities = entity.dimension.getEntities({
        location: pos,
        maxDistance: CONFIG.MAX_TARGET_DISTANCE,
        excludeTypes: [CONFIG.ENTITY_ID],
        excludeFamilies: ["zombie_lance_family"], // opcional
    });

    let closest = null;
    let closestDist = Infinity;

    for (const e of nearbyEntities) {
        if (e.typeId === "minecraft:player" || e.typeId !== CONFIG.ENTITY_ID) {
            const d = dist3D(pos, e.location);
            if (d >= CONFIG.MIN_TARGET_DISTANCE && d < closestDist) {
                closest = e;
                closestDist = d;
            }
        }
    }

    return closest;
}

/**
 * Tick de actualización para una entidad en estado de lunge.
 */
function tickLunge(entity, state) {
    const id = entity.id;

    if (state.phase === "lunge") {
        // Mover la entidad en la dirección fija
        const vel = entity.getVelocity();
        entity.applyImpulse({
            x: state.direction.x * CONFIG.LUNGE_SPEED,
            y: vel.y,           // Respetar gravedad
            z: state.direction.z * CONFIG.LUNGE_SPEED,
        });

        // Aplicar daño UNA sola vez a mitad del lunge
        if (!state.damageDone && state.ticksLeft <= Math.floor(CONFIG.LUNGE_DURATION_TICKS / 2)) {
            applyLungeDamage(entity, state.direction);
            state.damageDone = true;
        }

        state.ticksLeft--;

        if (state.ticksLeft <= 0) {
            // Pasar a cooldown
            state.phase = "cooldown";
            state.cooldownLeft = CONFIG.COOLDOWN_TICKS;
        }

    } else if (state.phase === "cooldown") {
        state.cooldownLeft--;

        if (state.cooldownLeft <= 0) {
            lungeState.delete(id);
        }
    }
}

/**
 * Aplica daño a entidades que estén en el arco frontal de la estocada.
 */
function applyLungeDamage(entity, direction) {
    const pos = entity.location;
    const dimension = entity.dimension;

    // Centro del área de daño: un poco adelante de la entidad
    const damageCenter = {
        x: pos.x + direction.x * (CONFIG.DAMAGE_REACH * 0.6),
        y: pos.y + 0.5,
        z: pos.z + direction.z * (CONFIG.DAMAGE_REACH * 0.6),
    };

    const targets = dimension.getEntities({
        location: damageCenter,
        maxDistance: CONFIG.DAMAGE_RANGE,
    });

    for (const target of targets) {
        if (target === entity) continue;
        if (target.typeId === CONFIG.ENTITY_ID) continue; // No dañar a sus iguales

        // Verificar que el objetivo esté "hacia adelante"
        const toTarget = {
            x: target.location.x - pos.x,
            z: target.location.z - pos.z,
        };
        const len = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z);
        if (len === 0) continue;

        const dot = (toTarget.x / len) * direction.x + (toTarget.z / len) * direction.z;

        // dot > 0.4 = dentro de ~66° hacia adelante
        if (dot > 0.4) {
            try {
                target.applyDamage(CONFIG.DAMAGE, {
                    cause: EntityDamageCause.entityAttack,
                    damagingEntity: entity,
                });
            } catch (_) {
                // El objetivo puede haberse removido
            }
        }
    }
}

// =============================================
// LOOP PRINCIPAL
// =============================================

system.runInterval(() => {
    // Actualizar entidades ya en estado de lunge
    for (const [id, state] of lungeState.entries()) {
        let entity;
        try {
            // Intentar obtener la entidad por ID
            // En Bedrock Scripting API se busca en todas las dimensiones
            for (const dim of ["overworld", "nether", "the_end"]) {
                try {
                    const dim_obj = world.getDimension(dim);
                    const candidates = dim_obj.getEntities({ type: CONFIG.ENTITY_ID });
                    entity = candidates.find(e => e.id === id);
                    if (entity) break;
                } catch (_) {}
            }
        } catch (_) {}

        if (!entity || !entity.isValid()) {
            lungeState.delete(id);
            continue;
        }

        tickLunge(entity, state);
    }

    // Buscar nuevas entidades que deberían atacar
    for (const dim of ["overworld", "nether", "the_end"]) {
        let dimension;
        try {
            dimension = world.getDimension(dim);
        } catch (_) {
            continue;
        }

        const zombies = dimension.getEntities({ type: CONFIG.ENTITY_ID });

        for (const zombie of zombies) {
            if (!zombie.isValid()) continue;
            if (lungeState.has(zombie.id)) continue; // Ya en ataque/cooldown

            // El zombie ataca si tiene un objetivo (target) válido en rango
            tryStartLunge(zombie);
        }
    }
}, 1); // Cada tick