import { world, system } from "@minecraft/server";

const SPAWNER_ID  = "udaw:spawner2";
const DIMENSIONS  = ["overworld", "nether", "the end"];

const SPAWN_TABLE = [
    { id: "udaw:pillagerzombie",  weight: 50 },
    { id: "udaw:evocatorzombie",  weight: 25 },
    { id: "udaw:vindicatorzombie",weight: 25 }
];

function pickRandom() {
    const roll = Math.random() * 100;
    let acc = 0;
    for (const entry of SPAWN_TABLE) {
        acc += entry.weight;
        if (roll < acc) return entry.id;
    }
    return SPAWN_TABLE[0].id;
}

function startSpawnerLoop(spawner) {
    const loopId = system.runInterval(() => {
        try {
            // Verificar que el spawner sigue vivo
            const pos = spawner.location;
            const dim = spawner.dimension;
            const entityId = pickRandom();
            dim.spawnEntity(entityId, pos);
        } catch (_) {
            // Si falla es que el spawner ya no es valido — limpiar
            system.clearRun(loopId);
        }
    }, 400); // 20 segundos
}

world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== SPAWNER_ID) return;
    system.run(() => {
        try {
            startSpawnerLoop(entity);
        } catch (_) {}
    });
});