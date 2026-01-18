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
  "stone",
  "dirt",
  "log",
  "wood",
  "metal",
  "diamond_pick_diggable",
  "iron_pick_diggable",
  "stone_pick_diggable"
];

const BLOCK_DROPS = {
  "minecraft:stone": { item: "minecraft:cobblestone", min: 1, max: 1 },
  "minecraft:dirt": { item: "minecraft:dirt", min: 1, max: 1 },
  "minecraft:grass_block": { item: "minecraft:dirt", min: 1, max: 1 },
  "minecraft:oak_log": { item: "minecraft:oak_log", min: 1, max: 1 },
  "minecraft:spruce_log": { item: "minecraft:spruce_log", min: 1, max: 1 },
  "minecraft:birch_log": { item: "minecraft:birch_log", min: 1, max: 1 }
};

const MAX_DISTANCE = 6;
const TARGET_RANGE = 10;
const BREAK_TIME = 20; // ticks (~1s)
const INTERVAL = 1;   // ticks

const DIMENSIONS = ["overworld", "nether", "the_end"];

/* ================= MAIN LOOP ================= */

system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    const dimension = world.getDimension(dimId);

    const miners = dimension.getEntities({
      families: ["miner"]
    });

    for (const miner of miners) {
      const target = getTarget(miner);
      if (!target) {
        miner.setDynamicProperty("mining", 0);
        continue;
      }

      tryMineBlock(miner, dimension);
    }
  }
}, INTERVAL);

/* ================= TARGET ================= */

function getTarget(entity) {
  const targets = entity.dimension.getEntities({
    location: entity.location,
    maxDistance: TARGET_RANGE,
    families: ["player", "villager"],
    closest: 1
  });

  return targets.length ? targets[0] : null;
}

/* ================= MINING ================= */

function tryMineBlock(miner, dimension) {
  const hit = dimension.getBlockFromRay(
    miner.location,
    miner.getViewDirection(),
    { maxDistance: MAX_DISTANCE }
  );

  if (!hit || !hit.block) {
    miner.setDynamicProperty("mining", 0);
    return;
  }

  const block = hit.block;
  if (block.isAir) {
    miner.setDynamicProperty("mining", 0);
    return;
  }

  const canBreak =
    BREAKABLE_BLOCKS.includes(block.typeId) ||
    BREAKABLE_TAGS.some(tag => block.hasTag(tag));

  if (!canBreak) {
    miner.setDynamicProperty("mining", 0);
    return;
  }

  let progress = miner.getDynamicProperty("mining") ?? 0;
  progress++;

  if (progress >= BREAK_TIME) {
    spawnBlockDrop(block, dimension);
    block.setType("minecraft:air");
    miner.setDynamicProperty("mining", 0);
  } else {
    miner.setDynamicProperty("mining", progress);
  }
}

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
