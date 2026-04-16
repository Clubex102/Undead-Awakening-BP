import { world, BlockPermutation } from "@minecraft/server";

function spawnFire(dimension, location) {
    const fire = BlockPermutation.resolve("minecraft:fire");

    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            try {
                const posXZ = { x: location.x + x, z: location.z + z };
                const topBlock = dimension.getTopmostBlock(posXZ);
                if (!topBlock) continue;

                const pos = { x: posXZ.x, y: topBlock.location.y + 1, z: posXZ.z };
                dimension.getBlock(pos)?.setPermutation(fire);
            } catch (e) {}
        }
    }
}

world.afterEvents.projectileHitBlock.subscribe((event) => {
    if (event.projectile.typeId !== "udaw:oil_bottle_v1") return;

    const block = event.getBlockHit().block;
    spawnFire(block.dimension, block.location);
});

world.afterEvents.projectileHitEntity.subscribe((event) => {
    if (event.projectile.typeId !== "udaw:oil_bottle_v1") return;

    const entity = event.getEntityHit().entity;
    if (!entity) return;

    spawnFire(entity.dimension, entity.location);
});
world.afterEvents.projectileHitBlock.subscribe((event) => {
    if (event.projectile.typeId !== "udaw:oil_bottle_v2") return;

    const block = event.getBlockHit().block;
    spawnFire(block.dimension, block.location);
});

world.afterEvents.projectileHitEntity.subscribe((event) => {
    if (event.projectile.typeId !== "udaw:oil_bottle_v2") return;

    const entity = event.getEntityHit().entity;
    if (!entity) return;

    spawnFire(entity.dimension, entity.location);
});