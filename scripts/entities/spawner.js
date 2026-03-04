import { world, system } from "@minecraft/server";

const SPAWNER_ID          = "udaw:spawner";
const ZOMBIE_ID           = "udaw:zombiecomun";
const MAX_ZOMBIES_PER_ZONE = 35;  // Límite por zona de jugador
const ZONE_RADIUS          = 128; // Radio en bloques para contar zombies "locales"
const ZOMBIES_PER_SPAWNER  = 5;   // Cuántos zombies intenta spawnear cada spawner

function dist3D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Contar zombies dentro de un radio alrededor de una posición
function countZombiesNear(dimension, pos, radius) {
    try {
        return dimension.getEntities({
            typeId: ZOMBIE_ID,
            location: pos,
            maxDistance: radius,
        }).length;
    } catch (_) {
        return 0;
    }
}

// Encontrar el jugador más cercano al spawner en su misma dimensión
function getNearestPlayer(spawner) {
    const players = spawner.dimension.getPlayers();
    let nearest = null;
    let nearestDist = Infinity;

    for (const player of players) {
        const d = dist3D(spawner.location, player.location);
        if (d < nearestDist) {
            nearest = player;
            nearestDist = d;
        }
    }
    return nearest;
}

world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== SPAWNER_ID) return;

    // Buscar el jugador más cercano para usar su posición como zona de referencia
    const nearestPlayer = getNearestPlayer(entity);

    let localCount;
    if (nearestPlayer) {
        // Contar zombies en la zona del jugador más cercano
        localCount = countZombiesNear(entity.dimension, nearestPlayer.location, ZONE_RADIUS);
    } else {
        // Sin jugadores cerca — no tiene sentido spawnear, despawnear directamente
        try { entity.runCommand("event entity @s startdespawn"); } catch (_) {}
        return;
    }

    if (localCount >= MAX_ZOMBIES_PER_ZONE) {
        // Límite local alcanzado — despawnear sin invocar
        try { entity.runCommand("event entity @s startdespawn"); } catch (_) {}
        return;
    }

    // Calcular cuántos zombies podemos invocar sin pasarnos del límite local
    const slots   = MAX_ZOMBIES_PER_ZONE - localCount;
    const toSpawn = Math.min(ZOMBIES_PER_SPAWNER, slots);

    for (let i = 0; i < toSpawn; i++) {
        try { entity.runCommand(`summon ${ZOMBIE_ID} ~~~`); } catch (_) {}
    }

    try { entity.runCommand("event entity @s startdespawn"); } catch (_) {}
});