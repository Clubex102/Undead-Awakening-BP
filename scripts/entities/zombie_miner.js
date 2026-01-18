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
      miner.triggerEvent("udaw:break");
    }
  }
}, INTERVAL);
