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

/* ================= EVOCATOR ================= */

const EVOCATOR_ID          = "udaw:evocatorzombie";
const EVOCATOR_SUMMON      = "udaw:zombiecomun";
const EVOCATOR_COOLDOWN    = 300;
const EVOCATOR_ANIM1_TICKS = 80;
const EVOCATOR_ANIM2_TICKS = 40;

const BLUE_FLAME           = "minecraft:blue_flame_particle";
const RED_FLAME            = "minecraft:basic_flame_particle";

/* ================= ESTADO ================= */

const cooldownMap       = new Map();
const tacklingNow       = new Set();
const knockdownMap      = new Map();
const knockedDown       = new Set();

const berserkActive     = new Set();
const particleLoops     = new Map();

const evocatorCooldowns = new Map();
const evocatorTracked   = new Set();
const evocatorNextAttack = new Map();

/* ================= UTILIDADES ================= */

function dist3D(a, b) {

    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isCreativePlayer(entity) {

    if (entity.typeId !== "minecraft:player")
        return false;

    try {
        return entity.getGameMode() === "creative";
    } catch (_) {
        return false;
    }
}

function isNeutralMob(typeId) {

    return (
        typeId === "minecraft:cow" ||
        typeId === "minecraft:pig" ||
        typeId === "minecraft:sheep" ||
        typeId === "minecraft:chicken" ||
        typeId === "minecraft:horse" ||
        typeId === "minecraft:donkey" ||
        typeId === "minecraft:mule" ||
        typeId === "minecraft:cat" ||
        typeId === "minecraft:wolf" ||
        typeId === "minecraft:fox" ||
        typeId === "minecraft:rabbit" ||
        typeId === "minecraft:goat" ||
        typeId === "minecraft:camel" ||
        typeId === "minecraft:bee" ||
        typeId === "minecraft:turtle"
    );
}

function findTarget(entity) {

    const candidates = entity.dimension.getEntities({
        location: entity.location,
        maxDistance: TACKLE_RANGE,

        excludeTypes: [
            ENTITY_ID,
            VIND_ID,
            EVOCATOR_ID,
            "minecraft:item",
            "minecraft:xp_orb"
        ]
    });

    let best = null;
    let bestDist = Infinity;

    for (const e of candidates) {

        if (e === entity)
            continue;

        if (isCreativePlayer(e))
            continue;

        if (![
            "minecraft:player",
            "minecraft:villager",
            "minecraft:villager_v2",
            "minecraft:iron_golem",
            "minecraft:wandering_trader"
        ].includes(e.typeId))
            continue;

        const d = dist3D(entity.location, e.location);

        if (d < bestDist) {
            best = e;
            bestDist = d;
        }
    }

    return best;
}

function findEvocatorTarget(entity) {

    const candidates = entity.dimension.getEntities({
        location: entity.location,
        maxDistance: 20,

        excludeTypes: [
            ENTITY_ID,
            VIND_ID,
            EVOCATOR_ID,
            "minecraft:item",
            "minecraft:xp_orb"
        ]
    });

    let best = null;
    let bestDist = Infinity;

    for (const e of candidates) {

        if (e === entity)
            continue;

        if (isCreativePlayer(e))
            continue;

        if (![
            "minecraft:player",
            "minecraft:villager",
            "minecraft:villager_v2",
            "minecraft:iron_golem",
            "minecraft:wandering_trader"
        ].includes(e.typeId))
            continue;

        const d = dist3D(entity.location, e.location);

        if (d < bestDist) {
            best = e;
            bestDist = d;
        }
    }

    return best;
}

function applySlowness(entity) {
    try {
        entity.addEffect("slowness", 60, {
            amplifier: 255,
            showParticles: false
        });
    } catch (_) {}
}

function removeSlowness(entity) {
    try {
        entity.removeEffect("slowness");
    } catch (_) {}
}

/* ================= KNOCKDOWN ================= */
function applyKnockdown(victim) {

    const id   = victim.id;
    const tick = system.currentTick;

    const readyAt = knockdownMap.get(id) ?? 0;

    if (tick < readyAt)
        return;

    knockdownMap.set(id, tick + KNOCKDOWN_COOLDOWN);

    knockedDown.add(id);

    system.runTimeout(() => {
        knockedDown.delete(id);
    }, KNOCKDOWN_DURATION);

    try {

        if (victim.typeId === "minecraft:player") {

            victim.addEffect("weakness", KNOCKDOWN_DURATION, {
                amplifier: 255,
                showParticles: false
            });

            victim.runCommand(
                "inputpermission set @s movement disabled"
            );

            system.runTimeout(() => {

                try {

                    victim.runCommand(
                        "inputpermission set @s movement enabled"
                    );

                } catch (_) {}

            }, KNOCKDOWN_DURATION);

        } else {

            victim.addEffect("slowness", KNOCKDOWN_DURATION, {
                amplifier: 255,
                showParticles: false
            });

            victim.addEffect("weakness", KNOCKDOWN_DURATION, {
                amplifier: 255,
                showParticles: false
            });

        }

    } catch (_) {}

    try {

        let tackleAnim = KNOCKDOWN_ANIM;

        if (victim.typeId === "minecraft:iron_golem") {

            tackleAnim = "animation.irongolem.tackled";

        } else if (victim.typeId === "minecraft:evocation_illager") {

            tackleAnim = "animation.evokador.tackle";

        } else if (
            [
                "minecraft:pillager",
                "minecraft:witch",
                "minecraft:villager",
                "minecraft:villager_v2"
            ].includes(victim.typeId)
        ) {

            tackleAnim = "animation.pillager.tackle";

        } else if (victim.typeId === "minecraft:vindicator") {

            tackleAnim = "animation.illager.tackle";
        }

        victim.playAnimation(tackleAnim, {
            blendOutTime: 0.2
        });

    } catch (_) {}
}
/* ================= TACKLE ================= */

function executeTackle(entity) {

    applySlowness(entity);

    try {
        entity.playAnimation("animation.pillagerzombie.tackle");
    } catch (_) {}

    system.runTimeout(() => {

        try {

            removeSlowness(entity);

            const target = findTarget(entity);

            let dirX = 0;
            let dirZ = 1;

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

            system.runTimeout(() => {
                tacklingNow.delete(entity.id);
            }, 15);

        } catch (_) {}

    }, 14);

    system.runTimeout(() => {
        try {
            applySlowness(entity);
        } catch (_) {}
    }, 15);

    system.runTimeout(() => {
        try {
            removeSlowness(entity);
        } catch (_) {}
    }, 35);
}


/* ================= DAÑO SIN KNOCKBACK ================= */

world.afterEvents.entityHurt.subscribe((event) => {

    const victim = event.hurtEntity;

    if (!knockedDown.has(victim.id))
        return;

    if (event.damageSource.cause === "fall")
        return;

    try {

        victim.clearVelocity();

        victim.applyKnockback(
            { x: 0, z: 0 },
            0
        );

    } catch (_) {}

});

/* ================= GOLPE TACKLE ================= */

world.afterEvents.entityHitEntity.subscribe((event) => {

    const attacker = event.damagingEntity;
    const victim   = event.hitEntity;

    if (!attacker)
        return;

    if (attacker.typeId !== ENTITY_ID)
        return;

    if (!tacklingNow.has(attacker.id))
        return;

    applyKnockdown(victim);
});


/* ================= SPAWN EVOCATOR ================= */

world.afterEvents.entitySpawn.subscribe((event) => {

    const entity = event.entity;

    if (entity.typeId !== EVOCATOR_ID)
        return;

    evocatorTracked.add(entity);

    evocatorNextAttack.set(entity.id, 1);
});

/* ================= LIMPIAR ================= */

world.afterEvents.entityDie.subscribe((event) => {

    const entity = event.deadEntity;

    const id = entity.id;

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

/* ================= MAIN LOOP PILLAGER ================= */

system.runInterval(() => {

    const tick = system.currentTick;

    for (const dimId of DIMENSIONS) {

        let dimension;

        try {

            dimension = world.getDimension(dimId);

        } catch (_) {
            continue;
        }

        let entities;

        try {

            entities = dimension.getEntities({
                type: ENTITY_ID
            });

        } catch (_) {
            continue;
        }

        for (const entity of entities) {

            try {

                const id = entity.id;

                const readyAt = cooldownMap.get(id) ?? 0;

                if (tick < readyAt)
                    continue;

                const target = findTarget(entity);

                if (!target)
                    continue;

                cooldownMap.set(
                    id,
                    tick + TACKLE_COOLDOWN
                );

                executeTackle(entity);

            } catch (_) {}
        }

    }

}, 10);
