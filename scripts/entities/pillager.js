import { world, system } from "@minecraft/server";

const VANILLA_PILLAGER = "minecraft:pillager";
const CUSTOM_PILLAGER  = "udaw:pillager";
const BULLET_ID        = "udaw:bullet";
const SPAWN_CHANCE     = 0.10; // 10%

/* ================= REEMPLAZO ALEATORIO ================= */

world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;

    /* --- Reemplazar pillager vanilla --- */
    if (entity.typeId === VANILLA_PILLAGER) {
        if (Math.random() > SPAWN_CHANCE) return;

        const loc = entity.location;
        const dim = entity.dimension;

        system.run(() => {
            try {
                const rot = entity.getRotation();
                entity.remove();
                const custom = dim.spawnEntity(CUSTOM_PILLAGER, loc);
                custom.setRotation(rot);
            } catch (_) {}
        });
        return;
    }

    /* --- Bala disparada por pillager custom --- */
    if (entity.typeId === BULLET_ID) {
        system.run(() => {
            try {
                const projectile = entity.getComponent("minecraft:projectile");
                if (!projectile) return;
                const owner = projectile.owner;
                if (!owner || owner.typeId !== CUSTOM_PILLAGER) return;

                const pos = owner.location;
                const dim = owner.dimension;
                const rot = owner.getRotation();
                const rad = (rot.y * Math.PI) / 180;

                const muzzlePos = {
                    x: pos.x + (-Math.sin(rad) * 0.8),
                    y: pos.y + 1.4,
                    z: pos.z + (Math.cos(rad) * 0.8)
                };

                // Sonido
                owner.runCommand(`playsound flintlockshoot @a[r=60] ${muzzlePos.x} ${muzzlePos.y} ${muzzlePos.z} 1.0 1.0`);

                // Particulas — mismas que la pistola del jugador
                dim.spawnParticle("minecraft:large_explosion", muzzlePos);
                dim.spawnParticle("minecraft:large_explosion", muzzlePos);
                dim.spawnParticle("minecraft:large_explosion", muzzlePos);
                dim.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                dim.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                dim.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                dim.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                dim.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                dim.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
                dim.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
                dim.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
                dim.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
                dim.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
                dim.spawnParticle("minecraft:evaporation_manual", muzzlePos);
            } catch (_) {}
        });
    }
});