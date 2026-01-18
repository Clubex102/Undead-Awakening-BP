import { world, system, ItemStack } from "@minecraft/server";

/* ================= CONFIG ================= */

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

const BLOCK_DROPS = {
  "minecraft:stone": { item: "minecraft:cobblestone", min: 1, max: 1 },
  "minecraft:dirt": { item: "minecraft:dirt", min: 1, max: 1 },
  "minecraft:grass_block": { item: "minecraft:dirt", min: 1, max: 1 },
  "minecraft:oak_log": { item: "minecraft:oak_log", min: 1, max: 1 },
  "minecraft:spruce_log": { item: "minecraft:spruce_log", min: 1, max: 1 },
  "minecraft:birch_log": { item: "minecraft:birch_log", min: 1, max: 1 }
};

const BREAK_TIME = 1;
const CHECK_INTERVAL = 1;
const MAX_DISTANCE = 1.5;
const PLAYER_DETECT_RANGE = 10;

const DIMENSIONS = ["overworld", "nether", "the_end"];

/* ================= LOOP ================= */

system.runInterval(async () => {
  for (const dimId of DIMENSIONS) {
    const dimension = world.getDimension(dimId);

    const zombies = dimension.getEntities({
      families: ["miner"],
      maxDistance: PLAYER_DETECT_RANGE
    });
    for (const zombie of zombies) {
        zombie.triggerEvent("udaw:get_target");

        const target = getCachedTarget(zombie);
        if (!target) {
          zombie.setDynamicProperty("mining", 0);
        }
      else {
        world.sendMessage(`[Zombie Miner] Zombie miner ${zombie.id} a ${target.typeId}.`);
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
      } else {
        zombie.setDynamicProperty("mining", mining);
      }
      }
      
    }
  }
}, 10);

/* ================= DROPS ================= */

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

const TARGET_CACHE = new Map();

system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (ev.id !== "udaw:get_target") return;

  const target = ev.sourceEntity;
  const sender = ev.initiator; // el zombie

  if (!sender || !target) return;

  TARGET_CACHE.set(sender.id, {
    entity: target,
    tick: system.currentTick
  });
});
function getCachedTarget(zombie) {
  const data = TARGET_CACHE.get(zombie.id);
  if (!data) return null;

  // Expira después de 1 segundo (20 ticks)
  if (system.currentTick - data.tick > 20) {
    TARGET_CACHE.delete(zombie.id);
    return null;
  }

  return data.entity;
}
