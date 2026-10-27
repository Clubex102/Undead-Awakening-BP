import { world, system } from "@minecraft/server";

const SCARECROW = "udaw:scarecrow";
const HEADLESS_RIDER = "udaw:headless_rider";
const triggeredScarecrows = new Set();

function cackle(dim, loc) {
    [0, 12, 26].forEach((t, i) => system.runTimeout(() => {
        const id = i % 2 ? "udaw.headless_rider.laugh2" : "udaw.headless_rider.laugh1";
        try { dim.runCommand(`playsound ${id} @a ${loc.x} ${loc.y} ${loc.z} 4 ${0.55 + i * 0.12}`); } catch {}
    }, t));
}

function ring(dim, c, r, count, particle, yOff = 0) {
    try {
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            dim.spawnParticle(particle, { x: c.x + Math.cos(a) * r, y: c.y + yOff, z: c.z + Math.sin(a) * r });
        }
    } catch {}
}

world.afterEvents.entityHurt.subscribe((event) => {
    try {
        const { hurtEntity } = event;
        if (!hurtEntity || hurtEntity.typeId !== SCARECROW) return;
        if (triggeredScarecrows.has(hurtEntity.id)) return;
        triggeredScarecrows.add(hurtEntity.id);

        const dim = hurtEntity.dimension;
        const loc = hurtEntity.location;

        // Set state to punched (1)
        try { hurtEntity.setProperty("udaw:state", 1); } catch {}

        cackle(dim, loc);
        for (const p of dim.getPlayers({ location: loc, maxDistance: 40 })) {
            p.sendMessage("§6§oUna risa resuena entre los campos de Sleepy Hollow...");
        }

        let n = 0;
        const swirl = system.runInterval(() => {
            n++;
            ring(dim, loc, 0.8 + n * 0.12, 14, "minecraft:basic_flame_particle", 0.6);
            ring(dim, loc, 1.4, 8, "minecraft:basic_smoke_particle", 1 + (n % 5) * 0.3);
        }, 4);

        // Transition to fallen (2)
        system.runTimeout(() => {
            try {
                if (hurtEntity && hurtEntity.isValid()) {
                    hurtEntity.setProperty("udaw:state", 2);
                }
            } catch {}
        }, 20);

        // Summon rider
        system.runTimeout(() => {
            try {
                system.clearRun(swirl);
                ring(dim, loc, 1.5, 24, "minecraft:large_explosion", 0.8);
                dim.spawnEntity("minecraft:lightning_bolt", loc);
                const boss = dim.spawnEntity(HEADLESS_RIDER, loc);
                if (boss) {
                    try { boss.addEffect("resistance", 100, { amplifier: 4, showParticles: false }); } catch {}
                }
                cackle(dim, loc);
                world.sendMessage("§6§l¡El Jinete sin Cabeza cabalga esta noche!");
                if (hurtEntity && hurtEntity.isValid()) {
                    hurtEntity.remove();
                }
            } catch {}
        }, 35);
    } catch {}
});
