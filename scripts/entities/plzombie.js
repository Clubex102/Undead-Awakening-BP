import { world, system } from "@minecraft/server";

const ENTITY_ID     = "udaw:plzombie";
const STUN_DURATION = 60;  // 3 segundos en ticks
const STUN_COOLDOWN = 100; // 5 segundos en ticks

const AXES = new Set([
    "minecraft:wooden_axe", "minecraft:stone_axe", "minecraft:iron_axe",
    "minecraft:golden_axe", "minecraft:diamond_axe", "minecraft:netherite_axe"
]);

const MELEE_STUNNERS = new Set([
    "minecraft:ravager", "minecraft:iron_golem", "minecraft:vindicator"
]);

const stunnedEntities = new Set();
const stunnCooldowns  = new Map();
const stunLoops       = new Map(); // id -> loopId del teleport

function applyStun(entity) {
    const id   = entity.id;
    const tick = system.currentTick;

    const readyAt = stunnCooldowns.get(id) ?? 0;
    if (tick < readyAt) return;

    stunnedEntities.add(id);
    stunnCooldowns.set(id, tick + STUN_DURATION + STUN_COOLDOWN);

    try { entity.playAnimation("animation.zombieplayer.stunned"); } catch (_) {}

    // Sonidos de stun
    try {
        const pos = entity.location;
        entity.dimension.runCommand(`playsound mob.zombie.hurt @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.6`);
    } catch (_) {}

    try {
        entity.addEffect("slowness", STUN_DURATION, { amplifier: 255, showParticles: false });
        entity.addEffect("weakness", STUN_DURATION, { amplifier: 255, showParticles: false });
    } catch (_) {}

    // Teleport anti-knockback durante el stun
    const stunPos = { ...entity.location };
    const loopId  = system.runInterval(() => {
        try {
            const cur = entity.location;
            if (Math.abs(cur.x - stunPos.x) > 0.05 || Math.abs(cur.z - stunPos.z) > 0.05) {
                entity.teleport(stunPos, { rotation: entity.getRotation() });
            }
        } catch (_) {
            system.clearRun(stunLoops.get(id));
            stunLoops.delete(id);
        }
    }, 1);
    stunLoops.set(id, loopId);

    // Quitar stun al terminar
    system.runTimeout(() => {
        stunnedEntities.delete(id);
        if (stunLoops.has(id)) {
            system.clearRun(stunLoops.get(id));
            stunLoops.delete(id);
        }
    }, STUN_DURATION);
}

/* ================= DAÑO ================= */

world.beforeEvents.entityHurt.subscribe((event) => {
    const victim = event.hurtEntity;
    if (victim.typeId !== ENTITY_ID) return;

    // Permitir daño por comandos (kill, damage) — no tienen damagingEntity
    const cause = event.damageSource?.cause;
    if (cause === "override" || cause === "void" || cause === "suicide" || !event.damageSource?.damagingEntity && cause !== "entityAttack") return;

    const attacker = event.damageSource?.damagingEntity;

    // Si esta stunneado — puede recibir cualquier daño
    if (stunnedEntities.has(victim.id)) return;

    // No stunneado — verificar si puede stunnearlo
    let canStun = false;

    if (attacker) {
        if (MELEE_STUNNERS.has(attacker.typeId)) {
            canStun = true;
        } else if (attacker.typeId === "minecraft:player") {
            try {
                const held = attacker.getComponent("equippable")?.getEquipment("Mainhand");
                if (held && AXES.has(held.typeId)) canStun = true;
            } catch (_) {}
        }
    }

    if (canStun) {
        event.cancel = true;
        system.run(() => applyStun(victim));
        return;
    }

    // Cualquier otro — inmune, sonido de bloqueo
    event.cancel = true;
    try {
        system.run(() => {
            const pos = victim.location;
            victim.dimension.runCommand(`playsound random.orb @a[r=16] ${pos.x} ${pos.y} ${pos.z} 1.0 0.5`);
        });
    } catch (_) {}
});

/* ================= SPAWN AL MORIR JUGADOR ================= */

world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;

    // Limpiar plzombie muerto
    if (entity.typeId === ENTITY_ID) {
        const id = entity.id;
        stunnedEntities.delete(id);
        stunnCooldowns.delete(id);
        if (stunLoops.has(id)) {
            system.clearRun(stunLoops.get(id));
            stunLoops.delete(id);
        }
        return;
    }

    // Spawn al morir jugador por zombie
    if (entity.typeId !== "minecraft:player") return;
    if (Math.random() > 0.5) return;

    const attacker = event.damageSource?.damagingEntity;
    if (!attacker) return;

    // Verificar que el atacante es de familia zombie
    const isZombie = attacker.hasComponent("minecraft:type_family")
        ? (() => {
            try {
                return attacker.runCommand("testfor @s[family=zombie]"), true;
            } catch (_) { return false; }
          })()
        : false;

    // Alternativa mas confiable — verificar typeId
    const zombieTypes = [
        "minecraft:zombie", "minecraft:zombie_villager",
        "minecraft:husk", "minecraft:drowned",
        "minecraft:zombie_pigman", "minecraft:zombified_piglin",
        "udaw:zombiecomun", "udaw:zombieminer", "udaw:zombiewc",
        "udaw:zombie_lance", "udaw:zombietnt", "udaw:zombierange",
        "udaw:pillagerzombie", "udaw:vindicatorzombie",
        "udaw:evocatorzombie", "udaw:zombie_shovel", "udaw:plzombie"
    ];

    if (!zombieTypes.includes(attacker.typeId)) return;

    system.run(() => {
        try {
            const pos  = entity.location;
            const dim  = entity.dimension;
            const name = entity.name ?? entity.nameTag ?? "Unknown";

            const plzombie = dim.spawnEntity(ENTITY_ID, pos);
            plzombie.nameTag = `Fallen: ${name}`;
        } catch (_) {}
    });
});