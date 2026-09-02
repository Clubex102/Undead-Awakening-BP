import { world, system } from "@minecraft/server";

const BULLET_IDS = new Set(["udaw:bullet", "udaw:bullet2", "udaw:bullet3", "udaw:cannonbullet", "udaw:pillagerbullet", "udaw:pillagercannonbullet"]);
const TRAIL_INTERVAL = 10;
const SMOKE_PARTICLE = "udaw:gun_smoke";
const FIRE_PARTICLE = "udaw:fire";

const bullets = new Map();

world.afterEvents.entitySpawn.subscribe((ev) => {
    if (!BULLET_IDS.has(ev.entity.typeId)) return;
    bullets.set(ev.entity.id, ev.entity);
});

system.runInterval(() => {
    for (const [id, entity] of bullets) {
        if (!entity.isValid) {
            bullets.delete(id);
            continue;
        }
        try {
            const particle = entity.typeId === "udaw:bullet3" ? FIRE_PARTICLE : SMOKE_PARTICLE;
            entity.dimension.spawnParticle(particle, entity.location);
        } catch (_) {}
    }
}, TRAIL_INTERVAL);
