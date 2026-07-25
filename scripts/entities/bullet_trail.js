import { world, system } from "@minecraft/server";

const BULLET_IDS = new Set(["udaw:bullet", "udaw:bullet2", "udaw:cannonbullet"]);
const TRAIL_INTERVAL = 10;
const SMOKE_PARTICLE = "udaw:gun_smoke";

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
            entity.dimension.spawnParticle(SMOKE_PARTICLE, entity.location);
        } catch (_) {}
    }
}, TRAIL_INTERVAL);
