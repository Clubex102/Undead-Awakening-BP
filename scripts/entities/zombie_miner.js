import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME = 20; // ticks (~1s)
const MAX_DISTANCE = 4;
const STEP = 0.2;

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
  const dimension = entity.dimension;

  // Distancia fija: justo delante del mob
  const DISTANCE = 1;

  const pos = {
    x: Math.floor(origin.x + dir.x * DISTANCE),
    y: Math.floor(origin.y + dir.y * DISTANCE),
    z: Math.floor(origin.z + dir.z * DISTANCE)
  };

  const block = dimension.getBlock(pos);
  if (!block || block.typeId === "minecraft:air") {
    return null;
  }

  return { block, pos };
}


/* ================= 2×2 OFFSETS ================= */

function get2x2Offsets(entity) {
  const dir = entity.getViewDirection();

  // Eje dominante de la mirada
  if (Math.abs(dir.x) > Math.abs(dir.z)) {
    // Mirando principalmente en X → plano Y/Z
    return [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 }
    ];
  } else {
    // Mirando principalmente en Z → plano X/Y
    return [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ];
  }
}

/* ================= DETECCIÓN 2×2 ================= */

function getMineable2x2(dimension, basePos, offsets) {
  const blocks = [];

  for (const o of offsets) {
    const pos = {
      x: basePos.x + o.x,
      y: basePos.y + o.y,
      z: basePos.z + o.z
    };

    const block = dimension.getBlock(pos);
    if (!block || !BREAKABLE.has(block.typeId)) {
      return null; // si falla uno, no se mina nada
    }

    blocks.push(pos);
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

      if (!target || !BREAKABLE.has(target.block.typeId)) {
        zombie.setDynamicProperty("mineStart", null);
        zombie.setDynamicProperty("minePos", null);
        continue;
      }
      const tick = system.currentTick;

      if (!zombie.getDynamicProperty("mineStart")) {
        zombie.setDynamicProperty("mineStart", tick);
        zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
        continue;
      }

      const start = zombie.getDynamicProperty("mineStart");
      const saved = JSON.parse(zombie.getDynamicProperty("minePos"));

      // Si cambió el bloque base → reiniciar
      if (
        saved.x !== target.pos.x ||
        saved.y !== target.pos.y ||
        saved.z !== target.pos.z
      ) {
        zombie.setDynamicProperty("mineStart", tick);
        zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
        continue;
      }

      // Aún no termina el tiempo
      if (tick - start < BREAK_TIME) continue;

      /* ===== MINADO 2×2 ===== */

      const offsets = get2x2Offsets(zombie);
      const blocks = getMineable2x2(
        dimension,
        target.pos,
        offsets
      );

      // Si el 2×2 no es válido, no rompe nada
      if (!blocks) {
        zombie.setDynamicProperty("mineStart", null);
        zombie.setDynamicProperty("minePos", null);
        continue;
      }

      // Romper los 4 bloques
      for (const p of blocks) {
        dimension.setBlockType(p, "minecraft:air");
      }

      zombie.setDynamicProperty("mineStart", null);
      zombie.setDynamicProperty("minePos", null);
    }
  }
}, 2);
