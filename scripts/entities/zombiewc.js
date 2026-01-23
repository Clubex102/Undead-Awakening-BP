import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME = 40;
const MAX_DISTANCE = 4.0;
const MAX_MINE_DISTANCE = 1.4;
const STEP = 0.15;

const DIMENSIONS = ["overworld", "nether", "the_end"];

const BREAKABLE = new Set([
  "minecraft:dirt",
  "minecraft:grass_block",
 "minecraft:oak_log", "minecraft:oak_wood", "minecraft:stripped_oak_log", "minecraft:stripped_oak_wood",
 "minecraft:spruce_log", "minecraft:spruce_wood", "minecraft:stripped_spruce_log", "minecraft:stripped_spruce_wood",
 "minecraft:birch_log", "minecraft:birch_wood", "minecraft:stripped_birch_log", "minecraft:stripped_birch_wood",
 "minecraft:jungle_log", "minecraft:jungle_wood", "minecraft:stripped_jungle_log", "minecraft:stripped_jungle_wood",
 "minecraft:acacia_log", "minecraft:acacia_wood", "minecraft:stripped_acacia_log", "minecraft:stripped_acacia_wood",
 "minecraft:dark_oak_log", "minecraft:dark_oak_wood", "minecraft:stripped_dark_oak_log", "minecraft:stripped_dark_oak_wood",
 "minecraft:mangrove_log", "minecraft:mangrove_wood", "minecraft:stripped_mangrove_log", "minecraft:stripped_mangrove_wood",
 "minecraft:cherry_log", "minecraft:cherry_wood", "minecraft:stripped_cherry_log", "minecraft:stripped_cherry_wood",
 "minecraft:bamboo_block", "minecraft:stripped_bamboo_block",
 "minecraft:crimson_stem", "minecraft:crimson_hyphae", "minecraft:stripped_crimson_stem", "minecraft:stripped_crimson_hyphae",
 "minecraft:warped_stem", "minecraft:warped_hyphae", "minecraft:stripped_warped_stem", "minecraft:stripped_warped_hyphae",
 "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves", "minecraft:jungle_leaves", "minecraft:acacia_leaves",
  "minecraft:dark_oak_leaves", "minecraft:mangrove_leaves", "minecraft:cherry_leaves",
  "minecraft:oak_slab", "minecraft:spruce_slab", "minecraft:birch_slab", "minecraft:jungle_slab", "minecraft:acacia_slab", "minecraft:dark_oak_slab", 
  "minecraft:mangrove_slab", "minecraft:cherry_slab", "minecraft:bamboo_slab", "minecraft:crimson_slab", "minecraft:warped_slab",
  "minecraft:oak_stairs", "minecraft:spruce_stairs", "minecraft:birch_stairs", "minecraft:jungle_stairs", "minecraft:acacia_stairs", "minecraft:dark_oak_stairs",
   "minecraft:mangrove_stairs", "minecraft:cherry_stairs", "minecraft:bamboo_stairs", "minecraft:crimson_stairs", "minecraft:warped_stairs",
   "minecraft:oak_fence", "minecraft:spruce_fence", "minecraft:birch_fence", "minecraft:jungle_fence", "minecraft:acacia_fence", "minecraft:dark_oak_fence", "minecraft:mangrove_fence",
    "minecraft:cherry_fence", "minecraft:bamboo_fence", "minecraft:crimson_fence", "minecraft:warped_fence",
    "minecraft:oak_door", "minecraft:spruce_door", "minecraft:birch_door", "minecraft:jungle_door", "minecraft:acacia_door", "minecraft:dark_oak_door", "minecraft:mangrove_door", 
    "minecraft:cherry_door", "minecraft:bamboo_door", "minecraft:crimson_door", "minecraft:warped_door",
"minecraft:oak_trapdoor", "minecraft:spruce_trapdoor", "minecraft:birch_trapdoor", "minecraft:jungle_trapdoor", "minecraft:acacia_trapdoor", "minecraft:dark_oak_trapdoor", 
"minecraft:mangrove_trapdoor", "minecraft:cherry_trapdoor", "minecraft:bamboo_trapdoor", "minecraft:crimson_trapdoor", "minecraft:warped_trapdoor"
]);

/* ================= RAYCAST ================= */

function getLookBlock(entity) {
  const dir = entity.getViewDirection();
  const origin = entity.getHeadLocation();
  const dim = entity.dimension;

  const CHECK_OFFSETS = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 }
  ];

  for (let d = 0.5; d <= MAX_DISTANCE; d += STEP) {
    const basePos = {
      x: Math.floor(origin.x + dir.x * d),
      y: Math.floor(origin.y + dir.y * d),
      z: Math.floor(origin.z + dir.z * d)
    };

    for (const o of CHECK_OFFSETS) {
      const pos = {
        x: basePos.x + o.x,
        y: basePos.y + o.y,
        z: basePos.z + o.z
      };

      const block = dim.getBlock(pos);
      if (block && block.typeId !== "minecraft:air") {
        // ⛔ Si está demasiado lejos, ignorar
        if (d > MAX_MINE_DISTANCE) {
          
          return null;
        }

        return { block, pos };
      }
    }
  }

  return null;
}



/* ================= OFFSETS 2×2 ================= */

function get2x2Offsets(entity) {
  const dir = entity.getViewDirection();

  if (Math.abs(dir.x) > Math.abs(dir.z)) {
    return [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 }
    ];
  } else {
    return [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ];
  }
}

/* ================= 2×2 FLEXIBLE ================= */

function getMineable2x2(dimension, basePos, offsets) {
  const blocks = [];

  for (const o of offsets) {
    const pos = {
      x: basePos.x + o.x,
      y: basePos.y + o.y,
      z: basePos.z + o.z
    };

    const block = dimension.getBlock(pos);
    if (block && BREAKABLE.has(block.typeId)) {
      blocks.push(pos);
    }
  }

  if (blocks.length === 0) {

    return null;
  }


  return blocks;
}

/* ================= MAIN LOOP ================= */

system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    const dimension = world.getDimension(dimId);
    const zombies = dimension.getEntities({ type: "udaw:zombiewc" });

    for (const zombie of zombies) {
      const target = getLookBlock(zombie);
      const tick = system.currentTick;

      if (!target || !BREAKABLE.has(target.block.typeId)) {
        zombie.setDynamicProperty("mineStart", null);
        zombie.setDynamicProperty("minePos", null);
        continue;
      }

      if (!zombie.getDynamicProperty("mineStart")) {
        zombie.setDynamicProperty("mineStart", tick);
        zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
        continue;
      }

      const start = zombie.getDynamicProperty("mineStart");

      if (tick - start < BREAK_TIME) continue;

      const offsets = get2x2Offsets(zombie);
      const blocks = getMineable2x2(dimension, target.pos, offsets);

      if (!blocks) {
        zombie.setDynamicProperty("mineStart", null);
        zombie.setDynamicProperty("minePos", null);
        continue;
      }

      for (const p of blocks) {
        dimension.setBlockType(p, "minecraft:air");
      }



      zombie.setDynamicProperty("mineStart", null);
      zombie.setDynamicProperty("minePos", null);
    }
  }
}, 2);
