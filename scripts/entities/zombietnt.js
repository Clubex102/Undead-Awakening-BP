import { world, system } from "@minecraft/server";

const ENTITY_ID    = "udaw:zombietnt";
const DIMENSIONS   = ["overworld", "nether", "the end"];

const explodingEntities = new Set();

function onStartExploding(entity) {
    const pos = entity.location;
    const dim = entity.dimension;

    // Sonido de creeper
    try {
        dim.runCommand(`playsound mob.creeper.say @a ${pos.x} ${pos.y} ${pos.z} 1.0 0.6`);
    } catch (_) {}

    // Reproducir las partículas varias veces seguidas con pequeño delay entre cada oleada
    for (let i = 0; i < 4; i++) {
        system.runTimeout(() => {
            try {
                // Leer posición actual de la entidad en cada oleada para que siga su movimiento
                const current = entity.location;
                const center  = { x: current.x, y: current.y + 1.0, z: current.z };
                dim.spawnParticle("minecraft:critical_hit_emitter", center);
                dim.spawnParticle("minecraft:critical_hit_emitter", center);
                dim.spawnParticle("minecraft:lava_particle", center);
                dim.spawnParticle("minecraft:lava_particle", center);
            } catch (_) {}
        }, i * 10); // Oleada cada 10 ticks (0.5 segundos)
    }
}

function onStopExploding(entity) {
    const pos = entity.location;
    const dim = entity.dimension;

    try {
        dim.runCommand(`playsound minecraft:extinguish_fire @a ${pos.x} ${pos.y} ${pos.z} 1.0 1.0`);
    } catch (_) {}

    try {
        dim.spawnParticle("minecraft:basic_smoke_particle", { x: pos.x, y: pos.y + 1.0, z: pos.z });
    } catch (_) {}
}

system.runInterval(() => {
    for (const dimName of DIMENSIONS) {
        let dimension;
        try { dimension = world.getDimension(dimName); }
        catch (_) { continue; }

        let entities;
        try { entities = dimension.getEntities({ typeId: ENTITY_ID }); }
        catch (_) { continue; }

        for (const entity of entities) {
            try {
                const id = entity.id;
                const isExploding  = entity.typeId === ENTITY_ID && entity.hasComponent("minecraft:is_baby");
                const wasExploding = explodingEntities.has(id);

                if (isExploding && !wasExploding) {
                    explodingEntities.add(id);
                    onStartExploding(entity);
                } else if (!isExploding && wasExploding) {
                    explodingEntities.delete(id);
                    onStopExploding(entity);
                }
            } catch (_) {}
        }

        const aliveIds = new Set(entities.map(e => e.id));
        for (const id of explodingEntities) {
            if (!aliveIds.has(id)) explodingEntities.delete(id);
        }
    }
}, 2);