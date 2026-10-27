import { system, world } from "@minecraft/server";

const SNAIL_ITEM = "udaw:snail_block_placer";
const SNAIL_FACTS = [
    "udaw.snail.lore.1", "udaw.snail.lore.2", "udaw.snail.lore.3", "udaw.snail.lore.4", "udaw.snail.lore.5",
    "udaw.snail.humor.1", "udaw.snail.humor.2", "udaw.snail.humor.3", "udaw.snail.humor.4", "udaw.snail.humor.5",
    "udaw.snail.ref.1", "udaw.snail.ref.2", "udaw.snail.ref.3", "udaw.snail.ref.4", "udaw.snail.ref.5"
];

const snailCooldowns = new Map();

function useSnail(player) {
    if (player.typeId !== "minecraft:player") return;

    const currentTick = system.currentTick;
    const lastInteract = snailCooldowns.get(player.id);
    if (lastInteract !== undefined && currentTick - lastInteract < 40) return;
    snailCooldowns.set(player.id, currentTick);

    const randomKey = SNAIL_FACTS[Math.floor(Math.random() * SNAIL_FACTS.length)];
    player.sendMessage({ translate: randomKey });

    const center = {
        x: player.location.x,
        y: player.location.y + 1,
        z: player.location.z,
    };

    try {
        player.dimension.spawnParticle("minecraft:enchanting_table_particle", center);
    } catch (error) {
        console.warn(`[snail] Could not spawn enchanting particle: ${error}`);
    }

    try {
        player.dimension.spawnParticle("minecraft:bubble_pop_particle", center);
    } catch (error) {
        console.warn(`[snail] Could not spawn bubble particle: ${error}`);
    }

    try {
        player.dimension.playSound("random.orb", center, { volume: 1.0, pitch: 0.8 });
    } catch (error) {
        console.warn(`[snail] Could not play interaction sound: ${error}`);
    }
}

system.beforeEvents.startup.subscribe((event) => {
    event.itemComponentRegistry.registerCustomComponent(SNAIL_ITEM, {
        onUse(useEvent) {
            useSnail(useEvent.source);
        },
        onUseOn(useEvent) {
            useSnail(useEvent.source);
        },
    });
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => snailCooldowns.delete(playerId));
