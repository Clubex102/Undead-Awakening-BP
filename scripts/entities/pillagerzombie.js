import { world, system } from "@minecraft/server";

/* ================= CONFIG PILLAGERZOMBIE ================= */

const ENTITY_ID          = "udaw:pillagerzombie";
const DIMENSIONS         = ["overworld", "nether", "the end"];
const TACKLE_COOLDOWN    = 200;
const TACKLE_RANGE       = 12;
const IMPULSE_POWER      = 1.8;
const IMPULSE_Y          = 0.4;
const KNOCKDOWN_COOLDOWN = 1200;
const KNOCKDOWN_DURATION = 100;
const KNOCKDOWN_ANIM     = "animation.humanoid.tackled";

/* ================= CONFIG VINDICATORZOMBIE ================= */

const VIND_ID   = "udaw:vindicatorzombie";
const PARTICLE  = "minecraft:critical_hit_emitter";

/* ================= ESTADO ================= */

const cooldownMap     = new Map();
const tacklingNow     = new Set();
const knockdownMap    = new Map();
const knockedDown     = new Set();
const berserkActive   = new Set();
const particleLoops   = new Map();

/* ================= UTILIDADES ================= */

function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function findTarget(entity) {
    const candidates = entity.dimension.getEntities({
        location: entity.location,
        maxDistance: TACKLE_RANGE
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

function applySlowness(entity) {
    try { entity.addEffect("slowness", 60, { amplifier: 255, showParticles: false }); } catch (_) {}
}

function removeSlowness(entity) {
    try { entity.removeEffect("slowness"); } catch (_) {}
}

/* ================= KNOCKDOWN ================= */

function applyKnockdown(victim) {
    const id   = victim.id;
    const tick = system.currentTick;

    const readyAt = knockdownMap.get(id) ?? 0;
    if (tick < readyAt) return;

    knockdownMap.set(id, tick + KNOCKDOWN_COOLDOWN);
    knockedDown.add(id);
    system.runTimeout(() => knockedDown.delete(id), KNOCKDOWN_DURATION);

    try {
        victim.addEffect("slowness", KNOCKDOWN_DURATION, { amplifier: 255, showParticles: false });
        victim.addEffect("weakness", KNOCKDOWN_DURATION, { amplifier: 255, showParticles: false });
    } catch (_) {}

    try {
        let tackleAnim = KNOCKDOWN_ANIM; // por defecto para llantines
        
        if (victim.typeId === "minecraft:iron_golem") {
            tackleAnim = "animation.irongolem.tackled";
        } else if (victim.typeId === "minecraft:evocation_illager") {
            tackleAnim = "animation.evokador.tackle";
        } else if (["minecraft:pillager", "minecraft:witch", "minecraft:villager", "minecraft:villager_v2"].includes(victim.typeId)) {
            tackleAnim = "animation.pillager.tackle";
        } else if (victim.typeId === "minecraft:vindicator") {
            tackleAnim = "animation.illager.tackle";
        }
        
        victim.playAnimation(tackleAnim, { blendOutTime: 0.2 });
    } catch (_) {}
}

/* ================= TACKLEADA ================= */

function executeTackle(entity) {
    applySlowness(entity);
    try { entity.playAnimation("animation.pillagerzombie.tackle"); } catch (_) {}

    system.runTimeout(() => {
        try {
            removeSlowness(entity);
            const target = findTarget(entity);
            let dirX = 0, dirZ = 1;
            if (target) {
                const dx = target.location.x - entity.location.x;
                const dz = target.location.z - entity.location.z;
                const len = Math.sqrt(dx * dx + dz * dz) || 1;
                dirX = dx / len;
                dirZ = dz / len;
            }
            entity.applyImpulse({
                x: dirX * IMPULSE_POWER,
                y: IMPULSE_Y,
                z: dirZ * IMPULSE_POWER
            });
            tacklingNow.add(entity.id);
            system.runTimeout(() => tacklingNow.delete(entity.id), 15);
        } catch (_) {}
    }, 14);

    system.runTimeout(() => {
        try { applySlowness(entity); } catch (_) {}
    }, 15);

    system.runTimeout(() => {
        try { removeSlowness(entity); } catch (_) {}
    }, 35);
}

/* ================= BERSERK ================= */

function enterBerserk(entity) {
    const id  = entity.id;
    const pos = entity.location;
    const dim = entity.dimension;

    try {
        entity.addEffect("slowness", 20, { amplifier: 255, showParticles: false });
    } catch (_) {}

    try { entity.playAnimation("animation.vindicatorzombie.berserk"); } catch (_) {}

    try {
        dim.playSound("mob.ravager.roar", pos, { volume: 1.0, pitch: 1.0 });
    } catch (_) {}

    system.runTimeout(() => {
        try {
            entity.addEffect("speed",      600, { amplifier: 1, showParticles: false });
            entity.addEffect("resistance", 600, { amplifier: 1, showParticles: false });
            entity.addEffect("strength",   600, { amplifier: 1, showParticles: false });
        } catch (_) {}
    }, 20);

    const loopId = system.runInterval(() => {
        try {
            const p = entity.location;
            entity.dimension.spawnParticle("minecraft:villager_angry", { x: p.x, y: p.y + 2.0, z: p.z });
        } catch (_) {
            system.clearRun(particleLoops.get(id));
            particleLoops.delete(id);
        }
    }, 10);

    particleLoops.set(id, loopId);
}

/* ================= BERSERK TRIGGER ================= */

world.afterEvents.entityHurt.subscribe((event) => {
    const entity = event.hurtEntity;
    if (entity.typeId !== VIND_ID) return;
    if (berserkActive.has(entity.id)) return;

    const health  = entity.getComponent("minecraft:health");
    const current = health?.currentValue ?? 0;
    const max     = health?.effectiveMax ?? 1;

    if (current <= max / 2) {
        berserkActive.add(entity.id);
        enterBerserk(entity);
    }
});

/* ================= DAÑO SIN KNOCKBACK ================= */

world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    if (!knockedDown.has(victim.id)) return;
    if (event.cause === "fall") return;

    const damage = event.damage;
    event.cancel = true;

    system.run(() => {
        try { victim.applyDamage(damage, { cause: "none" }); } catch (_) {}
    });
});

/* ================= GOLPE DE TACKLEADA ================= */

world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const victim   = event.hitEntity;

    if (!attacker || attacker.typeId !== ENTITY_ID) return;
    if (!tacklingNow.has(attacker.id)) return;

    applyKnockdown(victim);
});

/* ================= LIMPIAR AL MORIR ================= */

world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    const id     = entity.id;

    if (entity.typeId === ENTITY_ID) {
        cooldownMap.delete(id);
        knockdownMap.delete(id);
        tacklingNow.delete(id);
        knockedDown.delete(id);
    }

    if (entity.typeId === VIND_ID) {
        berserkActive.delete(id);
        if (particleLoops.has(id)) {
            system.clearRun(particleLoops.get(id));
            particleLoops.delete(id);
        }
    }

    if (entity.typeId === EVOCATOR_ID) {
        evocatorTracked.delete(entity);
        evocatorCooldowns.delete(id);
        evocatorNextAttack.delete(id);
    }
});

/* ================= MAIN LOOP PILLAGERZOMBIE ================= */

system.runInterval(() => {
    const tick = system.currentTick;

    for (const dimId of DIMENSIONS) {
        let dimension;
        try { dimension = world.getDimension(dimId); } catch (_) { continue; }

        let entities;
        try { entities = dimension.getEntities({ type: ENTITY_ID }); } catch (_) { continue; }

        for (const entity of entities) {
            try {
                const id = entity.id;
                const readyAt = cooldownMap.get(id) ?? 0;
                if (tick < readyAt) continue;

                const target = findTarget(entity);
                if (!target) continue;

                cooldownMap.set(id, tick + TACKLE_COOLDOWN);
                executeTackle(entity);
            } catch (_) {}
        }
    }
}, 10);

/* ================= EVOCATORZOMBIE ================= */

const EVOCATOR_ID         = "udaw:evocatorzombie";
const EVOCATOR_SUMMON     = "udaw:zombiecomun";
const EVOCATOR_COOLDOWN   = 300; // 15 segundos
const EVOCATOR_ANIM1_TICKS = 80; // 4 segundos
const EVOCATOR_ANIM2_TICKS = 40; // 2 segundos
const BLUE_FLAME          = "minecraft:blue_flame_particle";
const RED_FLAME           = "minecraft:basic_flame_particle";

const evocatorCooldowns  = new Map(); // id -> tick listo
const evocatorTracked    = new Set();
const evocatorNextAttack = new Map(); // id -> 1 o 2 (cual ataque toca)

function findEvocatorTarget(entity) {
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

/* ================= ATAQUE 1 — INVOCACION ================= */

function executeEvocatorAttack1(entity) {
    const dim = entity.dimension;

    try {
        entity.addEffect("slowness", EVOCATOR_ANIM1_TICKS, { amplifier: 255, showParticles: false });
    } catch (_) {}

    try { entity.playAnimation("animation.evokerzombie.attack1"); } catch (_) {}

    try {
        const p = entity.location;
        dim.playSound("mob.ravager.roar", p, { volume: 1.0, pitch: 1.0 });
    } catch (_) {}

    const flameLoop = system.runInterval(() => {
        try {
            const p = entity.location;
            const angle  = Math.random() * Math.PI * 2;
            const radius = Math.random() * 1.5;
            dim.spawnParticle(BLUE_FLAME, {
                x: p.x + Math.cos(angle) * radius,
                y: p.y + Math.random() * 2.0,
                z: p.z + Math.sin(angle) * radius
            });
        } catch (_) {}
    }, 4);

    system.runTimeout(() => {
        try {
            const p = entity.location;
            dim.playSound("mob.evocation_illager.prepare_summon", p, { volume: 1.0, pitch: 1.0 });
        } catch (_) {}
    }, 40);

    system.runTimeout(() => {
        try {
            const p = entity.location;
            dim.playSound("mob.ravager.roar", p, { volume: 1.0, pitch: 1.2 });
        } catch (_) {}
    }, 70);

    system.runTimeout(() => {
        try {
            system.clearRun(flameLoop);
            const p = entity.location;
            for (let i = 0; i < 4; i++) {
                const angle  = (Math.PI / 2) * i;
                const radius = 1.5 + Math.random() * 1.5;
                dim.spawnEntity(EVOCATOR_SUMMON, {
                    x: p.x + Math.cos(angle) * radius,
                    y: p.y,
                    z: p.z + Math.sin(angle) * radius
                });
            }
        } catch (_) {}
    }, 75);
}

/* ================= ATAQUE 2 — RAYO ELECTRICO ================= */

function executeEvocatorAttack2(entity) {
    const dim = entity.dimension;

    try {
        entity.addEffect("slowness", EVOCATOR_ANIM2_TICKS, { amplifier: 255, showParticles: false });
    } catch (_) {}

    try { entity.playAnimation("animation.evokerzombie.attack2"); } catch (_) {}

    // Sonido inicial — roar
    try {
        const p = entity.location;
        dim.playSound("mob.ravager.roar", p, { volume: 1.0, pitch: 1.0 });
    } catch (_) {}

    // Sonido de hechizo
    try {
        const p = entity.location;
        dim.playSound("mob.evocation_illager.prepare_wololo", p, { volume: 1.0, pitch: 1.0 });
    } catch (_) {}

    // Particulas electricas/de rayo durante la carga
    const particleLoopId = system.runInterval(() => {
        try {
            const p = entity.location;
            const headY = p.y + 2.0; // altura de la cabeza
            
            // Particulas electricas alrededor del mob
            for (let i = 0; i < 5; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 1.5;
                dim.spawnParticle("minecraft:electric_spark_particle", {
                    x: p.x + Math.cos(angle) * radius,
                    y: headY + Math.random() * 0.8,
                    z: p.z + Math.sin(angle) * radius
                });
            }
        } catch (_) {}
    }, 4);

    // Segundo 2 — invocar rayos en la posición de todos los jugadores en radio de 20 bloques
    system.runTimeout(() => {
        try {
            system.clearRun(particleLoopId);
            const p = entity.location;

            // Buscar todos los jugadores en 20 bloques
            const candidates = dim.getEntities({
                location: p,
                maxDistance: 20
            });

            for (const target of candidates) {
                try {
                    if (target.typeId !== "minecraft:player") continue;
                    
                    const tPos = target.location;
                    // Invocar rayo en la posición del jugador
                    dim.runCommand(`summon lightning_bolt ${Math.floor(tPos.x)} ${Math.floor(tPos.y)} ${Math.floor(tPos.z)}`);
                } catch (_) {}
            }
        } catch (_) {}
    }, 40);
}

/* ================= SPAWN Y MUERTE ================= */

world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== EVOCATOR_ID) return;
    evocatorTracked.add(entity);
    evocatorNextAttack.set(entity.id, 1); // siempre empieza con ataque 1
});

/* ================= LOOP EVOCATORZOMBIE ================= */

system.runInterval(() => {
    if (evocatorTracked.size === 0) return;
    const tick = system.currentTick;

    for (const entity of evocatorTracked) {
        try {
            const id = entity.id;

            const readyAt = evocatorCooldowns.get(id) ?? 0;
            if (tick < readyAt) continue;

            const target = findEvocatorTarget(entity);
            if (!target) continue;

            const nextAttack = evocatorNextAttack.get(id) ?? 1;

            evocatorCooldowns.set(id, tick + EVOCATOR_COOLDOWN);

            if (nextAttack === 1) {
                evocatorNextAttack.set(id, 2);
                executeEvocatorAttack1(entity);
            } else {
                evocatorNextAttack.set(id, 1);
                executeEvocatorAttack2(entity);
            }
        } catch (_) {
            evocatorTracked.delete(entity);
        }
    }
}, 10);