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
  "minecraft:sand",
  "minecraft:gravel",
  "minecraft:stone",
  "minecraft:oak_log",
  "minecraft:spruce_log",
  "minecraft:birch_log"
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
    const zombies = dimension.getEntities({ type: "udaw:zombieminer" });

    for (const zombie of zombies) {
      const target = getLookBlock(zombie);
      const tick = system.currentTick;

      if (!target || !BREAKABLE.has(target.block.typeId)) {
        zombie.setDynamicProperty("mineStart", null);
        zombie.setDynamicProperty("minePos", null);
        continue;
      }

      if (!zombie.getDynamicProperty("mineStart")) {
        world.sendMessage("§6[MINE] Iniciando minado...");
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
