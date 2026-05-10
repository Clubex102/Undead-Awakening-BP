import { world, system } from "@minecraft/server";

const SPAWNER_ID = "udaw:spawner2";

const CHECK_INTERVAL = 100; // 5 segundos
const SPAWN_INTERVAL = 400; // 30 segundos
const PLAYER_RANGE = 40;

const CLEANUP_INTERVAL = 12000; // 10 minutos

const spawnerTimers = new Map();

system.runInterval(() => {
    try {

        const dimensions = [
            world.getDimension("overworld"),
            world.getDimension("nether"),
            world.getDimension("the_end")
        ];

        for (const dimension of dimensions) {

            const spawners = dimension.getEntities({
                type: SPAWNER_ID
            });

            for (const spawner of spawners) {

                if (!spawner.isValid) continue;

                const location = spawner.location;

                // Solo jugadores cerca
                const nearbyPlayers = dimension.getPlayers({
                    location: location,
                    maxDistance: PLAYER_RANGE
                });

                if (nearbyPlayers.length === 0) continue;

                let timer = spawnerTimers.get(spawner.id) ?? 0;

                timer += CHECK_INTERVAL;

                if (timer >= SPAWN_INTERVAL) {

                    const random = Math.random();
                    let entityToSpawn;

                    // 10%
                    if (random < 0.10) {
                        entityToSpawn = "udaw:evocatorzombie";

                    // 25%
                    } else if (random < 0.20) {
                        entityToSpawn = "udaw:vindicatorzombie";

                    // 50%
                    } else {random < 0.50
                        entityToSpawn = "udaw:pillagerzombie";
                    }

                    dimension.spawnEntity(entityToSpawn, {
                        x: location.x + 1,
                        y: location.y,
                        z: location.z + 1
                    });

                    timer = 0;
                }

                spawnerTimers.set(spawner.id, timer);
            }
        }

    } catch (e) {
        console.warn(`Spawner Error: ${e}`);
    }

}, CHECK_INTERVAL);


// Limpieza lenta del Map
system.runInterval(() => {

    try {

        const validIds = new Set();

        const dimensions = [
            world.getDimension("overworld"),
            world.getDimension("nether"),
            world.getDimension("the_end")
        ];

        // Recolecta IDs válidos actuales
        for (const dimension of dimensions) {

            const spawners = dimension.getEntities({
                type: SPAWNER_ID
            });

            for (const spawner of spawners) {

                if (spawner.isValid) {
                    validIds.add(spawner.id);
                }
            }
        }

        // Elimina IDs muertos
        for (const id of spawnerTimers.keys()) {

            if (!validIds.has(id)) {
                spawnerTimers.delete(id);
            }
        }

    } catch (e) {
        console.warn(`Cleanup Error: ${e}`);
    }

}, CLEANUP_INTERVAL);