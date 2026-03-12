import { world, system, EntityDamageCause } from "@minecraft/server";

/* ================= CONFIG ================= */

const SWEEP_DAMAGE   = 3;
const SWEEP_RADIUS   = 3.0;
const SWEEP_COOLDOWN = 30;

const SWORDS = new Set([
    "minecraft:wooden_sword",
    "minecraft:stone_sword",
    "minecraft:iron_sword",
    "minecraft:golden_sword",
    "minecraft:diamond_sword",
    "minecraft:netherite_sword"
]);

const sweepCooldown = new Map();
// playerId -> intervalId del actionbar activo
const cooldownDisplays = new Map();

/* ================= ACTIONBAR ================= */

function startCooldownDisplay(player, readyAtTick) {
    const id = player.id;

    // Cancelar display anterior si existe
    if (cooldownDisplays.has(id)) {
        system.clearRun(cooldownDisplays.get(id));
    }

    const loopId = system.runInterval(() => {
        const remaining = readyAtTick - system.currentTick;

        if (remaining <= 0) {
            // Cooldown terminado — mostrar listo y limpiar
            try {
                player.onScreenDisplay.setActionBar("§aSweep §a✦✦✦✦✦ §aListo");
            } catch (_) {}
            system.clearRun(cooldownDisplays.get(id));
            cooldownDisplays.delete(id);
            return;
        }

        // Calcular bloques llenos vs vacíos (5 bloques total)
        const progress  = Math.max(0, remaining / SWEEP_COOLDOWN);
        const filled    = Math.round(progress * 5);
        const empty     = 5 - filled;
        const bar       = "§c" + "✦".repeat(filled) + "§7" + "✦".repeat(empty);
        const seconds   = (remaining / 20).toFixed(1);

        try {
            player.onScreenDisplay.setActionBar(`§eSweep ${bar} §7${seconds}s`);
        } catch (_) {}
    }, 2);

    cooldownDisplays.set(id, loopId);
}

/* ================= PARTÍCULAS Y SONIDO ================= */

function playSweepEffects(player) {
    const pos = player.location;
    const dim = player.dimension;

    try {
        dim.runCommand(`playsound item.trident.throw @a ${pos.x} ${pos.y} ${pos.z} 1.0 0.8`);
    } catch (_) {}

    try {
        const rot = player.getRotation();
        const rad = (rot.y * Math.PI) / 180;

        for (let angle = -60; angle <= 60; angle += 20) {
            const a = rad + (angle * Math.PI / 180);
            const sweepPos = {
                x: pos.x + Math.sin(-a) * 1.5,
                y: pos.y + 1.0,
                z: pos.z + Math.cos(-a) * 1.5
            };
            dim.spawnParticle("minecraft:critical_hit_emitter", sweepPos);
            dim.spawnParticle("minecraft:basic_flame_particle", sweepPos);
        }
    } catch (_) {}
}

/* ================= MAIN ================= */

world.afterEvents.entityHitEntity.subscribe((event) => {
    const attacker = event.damagingEntity;
    const tick     = system.currentTick;

    if (attacker?.typeId !== "minecraft:player") return;

    const readyAt = sweepCooldown.get(attacker.id) ?? 0;
    if (tick < readyAt) return;

    try {
        const held = attacker.getComponent("equippable").getEquipment("Mainhand");
        if (!held || !SWORDS.has(held.typeId)) return;
    } catch (_) { return; }

    const newReadyAt = tick + SWEEP_COOLDOWN;
    sweepCooldown.set(attacker.id, newReadyAt);

    // Iniciar display del cooldown
    startCooldownDisplay(attacker, newReadyAt);

    playSweepEffects(attacker);

    const hitEntity = event.hitEntity;
    const nearby = attacker.dimension.getEntities({
        location: attacker.location,
        maxDistance: SWEEP_RADIUS
    });

    for (const entity of nearby) {
        if (entity === attacker) continue;
        if (entity === hitEntity) continue;

        try {
            entity.applyDamage(SWEEP_DAMAGE, {
                cause: EntityDamageCause.entityAttack,
                damagingEntity: attacker
            });
        } catch (_) {}
    }
});