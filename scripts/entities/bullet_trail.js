import { world, system } from "@minecraft/server";

const BULLET_IDS = new Set(["udaw:bullet", "udaw:bullet2", "udaw:bullet3", "udaw:cannonbullet", "udaw:pillagerbullet", "udaw:pillagercannonbullet"]);
const TRAIL_INTERVAL = 4;
const SMOKE_PARTICLE = "udaw:gun_smoke";
const FIRE_PARTICLE = "udaw:fire";

// id -> {entity, x, y, z, still}. Solo echan humo en movimiento;
// quietas se olvidan para no apilar humo en el suelo.
const bullets = new Map();

world.afterEvents.entitySpawn.subscribe((ev) => {
    if (!BULLET_IDS.has(ev.entity.typeId)) return;
    try {
        const l = ev.entity.location;
        bullets.set(ev.entity.id, { entity: ev.entity, x: l.x, y: l.y, z: l.z, still: 0 });
    } catch (_) {}
});

system.runInterval(() => {
    for (const [id, rec] of bullets) {
        let loc = null;
        try {
            if (!rec.entity.isValid) { bullets.delete(id); continue; }
            loc = rec.entity.location;
        } catch (_) { bullets.delete(id); continue; }

        const dx = loc.x - rec.x;
        const dy = loc.y - rec.y;
        const dz = loc.z - rec.z;

        if (dx * dx + dy * dy + dz * dz < 0.02) {
            rec.still++;
            if (rec.still > 5) bullets.delete(id);
            continue;
        }

        rec.x = loc.x;
        rec.y = loc.y;
        rec.z = loc.z;
        rec.still = 0;

        try {
            let fiery = false;
            try { fiery = rec.entity.typeId === "udaw:bullet3" || rec.entity.hasTag("udaw:inc"); } catch (_) {}
            rec.entity.dimension.spawnParticle(fiery ? FIRE_PARTICLE : SMOKE_PARTICLE, loc);
        } catch (_) {}
    }
}, TRAIL_INTERVAL);
