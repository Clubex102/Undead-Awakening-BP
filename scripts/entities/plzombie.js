import { world, system } from "@minecraft/server";

const ENTITY_ID     = "udaw:plzombie";
const STUN_DURATION = 60;
const STUN_COOLDOWN = 100;
const MAX_HITS      = 3;

const AXES = new Set([
    "minecraft:wooden_axe",
    "minecraft:stone_axe",
    "minecraft:iron_axe",
    "minecraft:golden_axe",
    "minecraft:diamond_axe",
    "minecraft:netherite_axe"
]);

const MELEE_STUNNERS = new Set([
    "minecraft:ravager",
    "minecraft:iron_golem",
    "minecraft:vindicator"
]);

const stunnedEntities = new Set();
const stunnCooldowns  = new Map();
const stunLoops       = new Map();
const hitCounters     = new Map();

/* ================= STUN ================= */

function applyStun(entity) {

    const id   = entity.id;
    const tick = system.currentTick;

    const readyAt =
        stunnCooldowns.get(id) ?? 0;

    // Inmune al stun
    if (tick < readyAt) {
        return;
    }

    // Resetear contador
    hitCounters.delete(id);

    stunnedEntities.add(id);

    stunnCooldowns.set(
        id,
        tick + STUN_DURATION + STUN_COOLDOWN
    );

    try {

        entity.playAnimation(
            "animation.zombieplayer.stunned"
        );

    } catch (_) {}

    try {

        const pos = entity.location;

        entity.dimension.runCommand(
            `playsound mob.zombie.hurt @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.6`
        );

    } catch (_) {}

    try {

        entity.addEffect(
            "slowness",
            STUN_DURATION,
            {
                amplifier: 255,
                showParticles: false
            }
        );

        entity.addEffect(
            "weakness",
            STUN_DURATION,
            {
                amplifier: 255,
                showParticles: false
            }
        );

    } catch (_) {}

    const stunPos = {
        ...entity.location
    };

    const loopId = system.runInterval(() => {

        try {

            const cur = entity.location;

            if (
                Math.abs(cur.x - stunPos.x) > 0.05 ||
                Math.abs(cur.z - stunPos.z) > 0.05
            ) {

                entity.teleport(
                    stunPos,
                    {
                        rotation: entity.getRotation()
                    }
                );
            }

        } catch (_) {

            system.clearRun(
                stunLoops.get(id)
            );

            stunLoops.delete(id);
        }

    }, 1);

    stunLoops.set(id, loopId);

    system.runTimeout(() => {

        stunnedEntities.delete(id);

        if (stunLoops.has(id)) {

            system.clearRun(
                stunLoops.get(id)
            );

            stunLoops.delete(id);
        }

    }, STUN_DURATION);
}

/* ================= DAÑO ================= */

world.beforeEvents.entityHurt.subscribe((event) => {

    const victim = event.hurtEntity;

    if (victim.typeId !== ENTITY_ID) {
        return;
    }

    const cause =
        event.damageSource?.cause;

    if (
        cause === "override" ||
        cause === "void" ||
        cause === "suicide" ||
        (
            !event.damageSource?.damagingEntity &&
            cause !== "entityAttack"
        )
    ) {
        return;
    }

    const attacker =
        event.damageSource?.damagingEntity;

    // Mientras está stunned recibe daño normal
    if (stunnedEntities.has(victim.id)) {
        return;
    }

    const id   = victim.id;
    const tick = system.currentTick;

    // Cooldown/inmunidad
    const readyAt =
        stunnCooldowns.get(id) ?? 0;

    const currentlyOnCD =
        tick < readyAt;

    /* ================= STUN DIRECTO ================= */

    let canStun = false;

    if (attacker) {

        if (
            MELEE_STUNNERS.has(
                attacker.typeId
            )
        ) {

            canStun = true;

        } else if (
            attacker.typeId === "minecraft:player"
        ) {

            try {

                const held =
                    attacker
                    .getComponent("equippable")
                    ?.getEquipment("Mainhand");

                if (
                    held &&
                    AXES.has(held.typeId)
                ) {

                    canStun = true;
                }

            } catch (_) {}
        }
    }

    // Hacha o enemigo especial
    if (canStun) {

        // Durante inmunidad:
        // bloquear totalmente
        if (currentlyOnCD) {

            event.cancel = true;

            // Resetear combo
            hitCounters.delete(id);

            try {

                system.run(() => {

                    const pos =
                        victim.location;

                    victim.dimension.runCommand(
                        `playsound item.shield.block @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.9`
                    );
                });

            } catch (_) {}

            return;
        }

        // Aplicar stun
        event.cancel = true;

        system.run(() => {
            applyStun(victim);
        });

        return;
    }

    /* ================= SISTEMA DE GOLPES ================= */

    // Durante inmunidad:
    // NO acumular golpes
    // NO recibir daño
    if (currentlyOnCD) {

        event.cancel = true;

        // Resetear combo
        hitCounters.delete(id);

        try {

            system.run(() => {

                const pos =
                    victim.location;

                victim.dimension.runCommand(
                    `playsound item.shield.block @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.9`
                );
            });

        } catch (_) {}

        return;
    }

    // Contador normal
    const hits =
        (hitCounters.get(id) ?? 0) + 1;

    // Tercer golpe:
    // stun + daño
    if (hits >= MAX_HITS) {

        hitCounters.delete(id);

        system.run(() => {
            applyStun(victim);
        });

        // NO cancelar:
        // entra daño
        return;
    }

    // Bloquear golpe normal
    hitCounters.set(id, hits);

    event.cancel = true;

    try {

        system.run(() => {

            const pos =
                victim.location;

            victim.dimension.runCommand(
                `playsound item.shield.block @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.9`
            );
        });

    } catch (_) {}
});

/* ================= LIMPIAR AL MORIR ================= */

world.afterEvents.entityDie.subscribe((event) => {

    const entity = event.deadEntity;

    if (entity.typeId !== ENTITY_ID) {
        return;
    }

    const id = entity.id;

    stunnedEntities.delete(id);

    stunnCooldowns.delete(id);

    hitCounters.delete(id);

    if (stunLoops.has(id)) {

        system.clearRun(
            stunLoops.get(id)
        );

        stunLoops.delete(id);
    }
});