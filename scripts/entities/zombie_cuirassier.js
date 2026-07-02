/**
 * udaw:zombie_cuirassier — Script principal
 *
 * Al recibir daño:
 *   50% → Modo bloqueo (niega el daño, animación timed block)
 *   30% → Dash hacia atrás (niega el daño, animación jump)
 *   10% → Ataque especial 2 (dispara udaw:bullet tras 0.7 s)
 *   10% → Sin reacción
 *
 * Udaw:bullet, udaw:bullet2 y udaw:cannonbullet aturden al zombie.
 *
 * isValid es getter (propiedad), no método en esta versión del API.
 */

import { world, system } from "@minecraft/server";

// ─── Constantes ───────────────────────────────────────────────────────────────

const ZOMBIE_ID  = "udaw:zombie_cuirassier";
const BULLET_ID  = "udaw:bullet";
const ANIM_BLOCK = "animation.zombiecui.blocking";
const ANIM_ATK2  = "animation.zombiecui.attack2";
const ANIM_DASH  = "animation.zombiecui.jump";

const BLOCK_CHANCE   = 0.50;
const DASH_THRESHOLD = 0.80;
const ATK2_THRESHOLD = 0.90;

const BLOCK_DURATION = 50;    // ticks del bloqueo con timing
const DASH_DURATION  = 10;    // ticks durante el dash hacia atrás
const DASH_SPEED     = 0.5;   // impulso aplicado al dash
const DASH_DISTANCE  = 3.0;   // referencia conceptual para la dirección del dash
const DASH_ATTACK_INITIAL = 40;   // 2 segundos de slowness extremo
const DASH_ATTACK_SECOND  = 40;   // 2 segundos de speed 2
const DASH_ATTACK_SPEED   = 2;
const ZOMBIE_FLOOR_SLOWNESS_DURATION = 50; // 2.50 segundos
const ZOMBIE_FLOOR_SLOWNESS_AMPLIFIER = 10;

const STUN_PROJECTILES = new Set([
    "udaw:bullet",
    "udaw:bullet2",
    "udaw:cannonbullet"
]);
const STUN_DURATION = 60;

// Sonido de disparo
const SHOOT_SOUND  = "random.explode";
const SHOOT_VOLUME = 0.85;
const SHOOT_PITCH  = 1.95;

// Timeline ataque 2
const TICKS_SHOOT = 14;   // 0.70 s
const TICKS_END   = 26;   // 1.30 s  (delta disparo→fin = 12 ticks)

// Offset frontal al spawnear la bala (evita colisión consigo mismo)
const BULLET_FORWARD = 0.7;
const BULLET_SPEED   = 1.6;

// Partícula de humo de fogata al disparar
const SMOKE_PARTICLE = "minecraft:campfire_smoke_particle";

// Causas de daño que pueden ser bloqueadas.
// Whitelist explícita: solo cancelar ataques directos y proyectiles.
// Todo lo demás (override de /kill, fuego, void, caída, etc.) pasa sin cancelar.
const BLOCKABLE = new Set(["entityAttack", "projectile", "entityExplosion"]);

// ─── Estado global ────────────────────────────────────────────────────────────

// Map<id, { runId: number }>
const blockingZombies  = new Map();
// Set<id>
const attackingZombies = new Set();
const stunnedZombies   = new Set();
const dashAttackZombies = new Map();

// ─── Utilidad ─────────────────────────────────────────────────────────────────

/** isValid es getter en esta versión del API — nunca llamar con () */
function alive(e) {
    return e != null && e.isValid;
}

// ─── Limpieza al morir ────────────────────────────────────────────────────────

world.afterEvents.entityDie.subscribe((ev) => {
    if (ev.deadEntity.typeId !== ZOMBIE_ID) return;
    const id = ev.deadEntity.id;
    _cleanBlock(id);
    attackingZombies.delete(id);
    if (dashAttackZombies.has(id)) {
        _cleanDashAttack(id);
    }
});

// ─── Negación de daño ────────────────────────────────────────────────────────
// WHITELIST: solo cancelar causas de combate directo.
// /kill, daño de void, caída, fuego, magia, starve → pasan siempre.

world.beforeEvents.entityHurt.subscribe((ev) => {
    if (ev.hurtEntity.typeId !== ZOMBIE_ID) return;
    if (!BLOCKABLE.has(ev.damageSource.cause)) return;

    const id = ev.hurtEntity.id;
    const projectile = ev.damageSource?.damagingEntity;

    if (
        blockingZombies.has(id) ||
        attackingZombies.has(id) ||
        (
            ev.damageSource.cause === "projectile" &&
            projectile?.typeId &&
            STUN_PROJECTILES.has(projectile.typeId)
        )
    ) {
        ev.cancel = true;
    }
});

// ─── Listener principal ───────────────────────────────────────────────────────

world.afterEvents.entityHurt.subscribe((ev) => {
    const entity = ev.hurtEntity;
    if (entity.typeId !== ZOMBIE_ID) return;

    const id = entity.id;
    if (blockingZombies.has(id) || attackingZombies.has(id)) return;

    const projectile = ev.damageSource?.damagingEntity;
    if (
        ev.damageSource?.cause === "projectile" &&
        projectile?.typeId &&
        STUN_PROJECTILES.has(projectile.typeId)
    ) {
        _applyStun(entity, id);
        return;
    }

    const roll     = Math.random();
    const attacker = ev.damageSource?.damagingEntity ?? null;

    if (roll < BLOCK_CHANCE) {
        _activateBlock(entity, id);
    } else if (roll < DASH_THRESHOLD) {
        _activateDash(entity, id, attacker);
    } else if (roll < ATK2_THRESHOLD) {
        _activateAttack2(entity, id, attacker);
    }
});

// ─── Modo bloqueo ─────────────────────────────────────────────────────────────

function _activateBlock(entity, id) {
    entity.playAnimation(ANIM_BLOCK);

    const runId = system.runTimeout(() => {
        _deactivateBlock(id);
    }, BLOCK_DURATION);

    blockingZombies.set(id, { runId });
}

/**
 * Detiene el bloqueo. NO llama a playAnimation con stopExpression porque
 * eso puede dejar estado corrupto que interfiere con la siguiente activación.
 * Simplemente se para el interval y el controller de la entidad retoma el control.
 */
function _deactivateBlock(id) {
    _cleanBlock(id);
    // Sin llamada a playAnimation aquí — el engine retoma idle/walk naturalmente
}

function _cleanBlock(id) {
    const data = blockingZombies.get(id);
    if (!data) return;
    system.clearRun(data.runId);
    blockingZombies.delete(id);
}

// ─── Secuencia de ataque especial 2 ──────────────────────────────────────────
//
//   t = 0.00 s → efectos + animación
//   t = 0.70 s → disparo de udaw:bullet + sonido + partículas
//   t = 1.30 s → quitar efectos, liberar estado

function _activateDash(entity, id, attacker) {
    attackingZombies.add(id);
    entity.playAnimation(ANIM_DASH);

    const fwd = entity.getViewDirection();
    const impulse = {
        x: -fwd.x * DASH_SPEED,
        y: 0.15,
        z: -fwd.z * DASH_SPEED
    };

    try {
        entity.applyImpulse(impulse);
    } catch (_) {}

    system.runTimeout(() => {
        _startDashAttackState(entity, id, attacker);
    }, DASH_DURATION);
}

function _startDashAttackState(entity, id, attacker) {
    if (!alive(entity)) {
        attackingZombies.delete(id);
        return;
    }

    entity.addEffect("minecraft:slowness", DASH_ATTACK_INITIAL, {
        amplifier: 255,
        showParticles: false
    });
    entity.playAnimation("animation.zombiecui.roar");

    const speedRunId = system.runTimeout(() => {
        if (!alive(entity) || !dashAttackZombies.has(id)) return;
        entity.addEffect("minecraft:speed", DASH_ATTACK_SECOND, {
            amplifier: 3,
            showParticles: false
        });
        entity.addEffect("minecraft:strength", DASH_ATTACK_SECOND, {
            amplifier: 0,
            showParticles: false
        });
    }, DASH_ATTACK_INITIAL);

    const endRunId = system.runTimeout(() => {
        if (!dashAttackZombies.has(id)) return;
        _finishDashAttackState(id);
    }, DASH_ATTACK_INITIAL + DASH_ATTACK_SECOND);

    dashAttackZombies.set(id, {
        entity,
        attacker,
        speedRunId,
        endRunId
    });
}

function _finishDashAttackState(id) {
    const data = dashAttackZombies.get(id);
    if (!data) return;

    _cleanDashAttack(id);
    attackingZombies.delete(id);
}

function _cancelDashAttackState(id, victim) {
    const data = dashAttackZombies.get(id);
    if (!data) return;

    const { entity } = data;

    _cleanDashAttack(id);
    attackingZombies.delete(id);

    _applyDashFloorEffect(entity);
    _applyDashVictimHitEffect(victim);
}

function _cleanDashAttack(id) {
    const data = dashAttackZombies.get(id);
    if (!data) return;

    system.clearRun(data.speedRunId);
    system.clearRun(data.endRunId);
    dashAttackZombies.delete(id);
}

function _applyPillagerStun(target) {
    try {
        if (target.typeId === "minecraft:player") {
            target.addEffect("weakness", 100, {
                amplifier: 255,
                showParticles: false
            });
            target.runCommand("inputpermission set @s movement disabled");
            system.runTimeout(() => {
                try {
                    target.runCommand("inputpermission set @s movement enabled");
                } catch (_) {}
            }, 100);
        } else {
            target.addEffect("slowness", 100, {
                amplifier: 255,
                showParticles: false
            });
            target.addEffect("weakness", 100, {
                amplifier: 255,
                showParticles: false
            });
        }
    } catch (_) {}
}

function _activateAttack2(entity, id, target) {
    attackingZombies.add(id);

    entity.addEffect("minecraft:slowness",   200, { amplifier: 10, showParticles: false });
    entity.addEffect("minecraft:resistance", 200, { amplifier: 3,  showParticles: false });
    entity.playAnimation(ANIM_ATK2);

    // t = 0.70 s
    system.runTimeout(() => {

        // Programar limpieza PRIMERO — garantiza ejecución aunque _shootBullet falle
        system.runTimeout(() => {
            if (alive(entity)) {
                entity.removeEffect("minecraft:slowness");
                entity.removeEffect("minecraft:resistance");
            }
            attackingZombies.delete(id);
        }, TICKS_END - TICKS_SHOOT);   // 12 ticks → t = 1.30 s

        if (!alive(entity)) return;

        if (alive(target)) {
            _shootBullet(entity, target);
        }

    }, TICKS_SHOOT);
}

function _applyStun(entity, id) {
    if (stunnedZombies.has(id)) return;

    stunnedZombies.add(id);
    entity.addEffect("minecraft:slowness", STUN_DURATION, { amplifier: 10, showParticles: false });
    entity.addEffect("minecraft:weakness", STUN_DURATION, { amplifier: 2, showParticles: false });

    system.runTimeout(() => {
        if (alive(entity)) {
            entity.removeEffect("minecraft:slowness");
            entity.removeEffect("minecraft:weakness");
        }
        stunnedZombies.delete(id);
    }, STUN_DURATION);
}

world.afterEvents.entityHitEntity.subscribe((ev) => {
    const attacker = ev.damagingEntity;
    const victim = ev.hitEntity;

    if (!attacker || attacker.typeId !== ZOMBIE_ID) return;
    if (!victim || !alive(victim)) return;
    if (victim === attacker) return;
    if (!victim.hasComponent || !victim.hasComponent("minecraft:health")) return;

    const id = attacker.id;
    const data = dashAttackZombies.get(id);
    if (!data) return;

    _cancelDashAttackState(id, victim);
});

function _applyDashFloorEffect(entity) {
    if (!alive(entity)) return;

    try {
        entity.removeEffect("minecraft:slowness");
        entity.removeEffect("minecraft:speed");
        entity.playAnimation("animation.zombiecui.floor");
        entity.addEffect("minecraft:slowness", ZOMBIE_FLOOR_SLOWNESS_DURATION, {
            amplifier: ZOMBIE_FLOOR_SLOWNESS_AMPLIFIER,
            showParticles: false
        });
    } catch (_) {}
}

function _applyDashVictimHitEffect(victim) {
    if (!alive(victim)) return;

    try {
        if (victim.typeId === "minecraft:player") {
            victim.addEffect("weakness", 100, {
                amplifier: 255,
                showParticles: false
            });
            victim.runCommand("inputpermission set @s movement disabled");
            system.runTimeout(() => {
                try {
                    victim.runCommand("inputpermission set @s movement enabled");
                } catch (_) {}
            }, 100);
        } else {
            victim.addEffect("slowness", 100, {
                amplifier: 255,
                showParticles: false
            });
            victim.addEffect("weakness", 100, {
                amplifier: 255,
                showParticles: false
            });
        }

        victim.playAnimation("animation.humanoid.tackled", {
            blendOutTime: 0.2
        });
    } catch (_) {}
}

// ─── Disparo del proyectil ────────────────────────────────────────────────────

function _shootBullet(shooter, target) {
    const dim  = shooter.dimension;
    const sLoc = shooter.location;

    // Vector de visión normalizado del zombie
    const fwd = shooter.getViewDirection();

    // Origen: frente del zombie (evita colisión inmediata con su propio hitbox)
    const origin = {
        x: sLoc.x + fwd.x * BULLET_FORWARD,
        y: sLoc.y + 1.3,
        z: sLoc.z + fwd.z * BULLET_FORWARD,
    };

    // Vector hacia el torso del objetivo
    const tLoc = target.location;
    const dx = tLoc.x - origin.x;
    const dy = (tLoc.y + 1.0) - origin.y;
    const dz = tLoc.z - origin.z;

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return;

    const inv = BULLET_SPEED / len;
    const vel = { x: dx * inv, y: dy * inv, z: dz * inv };

    // Spawnear la bala y aplicar impulso en el mismo tick.
    // applyImpulse síncrono (sin timeout) es lo que funciona con udaw:bullet —
    // setVelocity + timeout resulta en el proyectil sin impulso.
    const bullet = dim.spawnEntity(BULLET_ID, origin);
    bullet.applyImpulse(vel);

    // Partículas de humo de fogata en el punto de disparo
    dim.spawnParticle(SMOKE_PARTICLE, origin);

    // Sonido en la posición de disparo
    dim.playSound(SHOOT_SOUND, origin, {
        volume: SHOOT_VOLUME,
        pitch:  SHOOT_PITCH,
    });
}
