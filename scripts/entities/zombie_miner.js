import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME = 20; // ticks (3 segundos)
const MAX_DISTANCE = 3;
const STEP = 0.5;

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

/* ================= OFFSETS ================= */

function get2x2Offsets(entity) {
  const dir = entity.getViewDirection();

  // Plano según dirección dominante
  if (Math.abs(dir.x) > Math.abs(dir.z)) {
    // Mirando X → plano Z/Y
    return [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 }
    ];
  } else {
    // Mirando Z → plano X/Y
    return [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ];
  }
}

/* ================= DETECCIÓN ================= */

function getMineableArea(dimension, basePos, offsets) {
  const blocks = [];

  for (const o of offsets) {
    const pos = {
      x: basePos.x + o.x,
      y: basePos.y + o.y,
      z: basePos.z + o.z
    };

    const block = dimension.getBlock(pos);
    if (!block || !BREAKABLE.has(block.typeId)) return null;

    blocks.push(pos);
  }

  return blocks;
}

function getVerticalBlocks(dimension, pos) {
  const result = [pos];

  const up = dimension.getBlock({ x: pos.x, y: pos.y + 1, z: pos.z });
  if (up && BREAKABLE.has(up.typeId)) {
    result.push({ x: pos.x, y: pos.y + 1, z: pos.z });
  }

  const down = dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });
  if (down && BREAKABLE.has(down.typeId)) {
    result.push({ x: pos.x, y: pos.y - 1, z: pos.z });
  }

  return result;
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

      // Detener movimiento (efecto minado)
      zombie.teleport(zombie.location, {
        dimension: zombie.dimension,
        rotation: zombie.getRotation()
      });

      const tick = system.currentTick;

      if (!zombie.getDynamicProperty("mineStart")) {
        zombie.setDynamicProperty("mineStart", tick);
        zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
        continue;
      }

      const start = zombie.getDynamicProperty("mineStart");
      const saved = JSON.parse(zombie.getDynamicProperty("minePos"));

      // Cambió de bloque → reiniciar
      if (
        saved.x !== target.pos.x ||
        saved.y !== target.pos.y ||
        saved.z !== target.pos.z
      ) {
        zombie.setDynamicProperty("mineStart", tick);
        zombie.setDynamicProperty("minePos", JSON.stringify(target.pos));
        continue;
      }

      // ¿Ya terminó?
      if (tick - start < BREAK_TIME) continue;

      /* ===== DECISIÓN DE ÁREA ===== */

      // 2×2
      const offsets = get2x2Offsets(zombie);
      let blocks = getMineableArea(dimension, target.pos, offsets);

      // Si no es 2×2 → intentar vertical
      if (!blocks) {
        blocks = getVerticalBlocks(dimension, target.pos);
      }

      // Romper
      for (const p of blocks) {
        dimension.setBlockType(p, "minecraft:air");
      }

      zombie.setDynamicProperty("mineStart", null);
      zombie.setDynamicProperty("minePos", null);
    }
  }
}, 2);
