import { world, system, ItemStack } from "@minecraft/server";

// Bloques por typeId (editable)
const BREAKABLE_BLOCKS = [
    "minecraft:stone",
    "minecraft:dirt",
    "minecraft:grass_block",
    "minecraft:oak_log",
    "minecraft:spruce_log",
    "minecraft:birch_log"
];
const BREAKABLE_TAGS = [
  "acacia",
  "birch",
  "diamond_pick_diggable",
  "dirt",
  "iron_pick_diggable",
  "log",
  "metal",
  "stone",
  "stone_pick_diggable",
  "wood"
];

const BREAK_TIME = 5;        // ticks por bloque
const CHECK_INTERVAL = 5;    // cada cuantos ticks se ejecuta
const MAX_DISTANCE = 1.5;    // bloque frente al zombie
const PLAYER_DETECT_RANGE = 10;

const DIMENSIONS = ["overworld", "nether", "the_end"];

system.runInterval(async () => {
  for (const dimension of DIMENSIONS) {
    world.sendMessage(`Checking dimension: ${dimension}`);
    let dimension;
    try {
      dimension = world.getDimension(dimension);
    } catch {
        
        continue;
    }
    const zombies = dimension.getEntities({
      families: ["miner"],
      maxDistance: PLAYER_DETECT_RANGE
    });

    for (const zombie of zombies) {
      const target = await getTarget(zombie);
      if (!target) { 
          console.warn('no target');
      } else {
        const view = zombie.getViewDirection();
        const pos = zombie.location;

        const blockPos = {
          x: Math.floor(pos.x + view.x * MAX_DISTANCE),
          y: Math.floor(pos.y + 1),
          z: Math.floor(pos.z + view.z * MAX_DISTANCE)
        };

        const block = dimension.getBlock(blockPos);
        if (!block || block.isAir) {
          zombie.setDynamicProperty("mining", 0);
          continue;
        }
        world.sendMessage(`Zombie Miner ${zombie.id} is trying to mine block ${block.typeId} at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})`);
        const canBreak =
          BREAKABLE_BLOCKS.includes(block.typeId) ||
          BREAKABLE_TAGS.some(tag => block.hasTag(tag));

        if (!canBreak) {
          zombie.setDynamicProperty("mining", 0);
          continue;
        }
        let mining = zombie.getDynamicProperty("mining") ?? 0;
        mining++;

        if (mining >= BREAK_TIME) {
          spawnBlockDrop(block, dimension);
          block.setType("minecraft:air");
          zombie.setDynamicProperty("mining", 0);

          dimension.spawnParticle("minecraft:block_break", {
            x: blockPos.x + 0.5,
            y: blockPos.y + 0.5,
            z: blockPos.z + 0.5
          });
        } else {
          zombie.setDynamicProperty("mining", mining);
        }
      }
    }
  }
}, CHECK_INTERVAL);


function spawnBlockDrop(block, dimension) {
  const data = BLOCK_DROPS[block.typeId];
  if (!data) return;

  const amount =
    Math.floor(Math.random() * (data.max - data.min + 1)) + data.min;

  dimension.spawnItem(
    new ItemStack(data.item, amount),
    block.location
  );
}

function getTarget(entity) {
    let resolved = false;
    return new Promise((resolve) => {
        entity.triggerEvent('udaw:get_target');
        const ev = system.afterEvents.scriptEventReceive.subscribe((data) => {
            if (data.id === 'udaw:get_target') {
                resolved = true;
                system.afterEvents.scriptEventReceive.unsubscribe(ev);
                resolve(data.sourceEntity); return;
            }
        });
        system.runTimeout(() => {
            system.afterEvents.scriptEventReceive.unsubscribe(ev);
            if (!resolved) resolve(null);
        }, 20);
    });
}