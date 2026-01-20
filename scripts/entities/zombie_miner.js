import { world, system } from "@minecraft/server";

/* ================= CONFIG ================= */

const BREAK_TIME = 20;
const MAX_DISTANCE = 4;
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
    { x: 0, y: 0, z: 0 },   // centro
    { x: 1, y: 0, z: 0 },   // derecha
    { x: -1, y: 0, z: 0 },  // izquierda
    { x: 0, y: 0, z: 1 },   // frente lateral
    { x: 0, y: 0, z: -1 },  // atrás lateral
    { x: 0, y: 1, z: 0 },   // un poco arriba
    { x: 0, y: -1, z: 0 }   // un poco abajo
  ];

  for (let d = 0.5; d <= MAX_DISTANCE; d += STEP) {
    const basePos = {
      x: Math.floor(origin.x + dir.x * d),
      y: Math.floor(origin.y + dir.y * d),
      z: Math.floor(origin.z + dir.z * d)
    };

    // Primero el bloque central
    const center = dim.getBlock(basePos);
    if (center && center.typeId !== "minecraft:air") {
      world.sendMessage(`§7[RAY] Centro: ${center.typeId}`);
      return { block: center, pos: basePos };
    }

    // Si es aire, revisar vecinos cercanos
    for (const o of CHECK_OFFSETS) {
      const pos = {
        x: basePos.x + o.x,
        y: basePos.y + o.y,
        z: basePos.z + o.z
      };

      const block = dim.getBlock(pos);
      if (block && block.typeId !== "minecraft:air") {
        world.sendMessage(
          `§e[RAY+] Bloque lateral detectado: ${block.typeId} (${pos.x}, ${pos.y}, ${pos.z})`
        );
        return { block, pos };
      }
    }
  }

  world.sendMessage("§c[RAY] Nada detectado");
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
    world.sendMessage("§c[FAIL] 2×2 sin bloques rompibles");
    return null;
  }

  world.sendMessage(`§6[MINE] Bloques válidos en 2×2: §f${blocks.length}`);
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

      world.sendMessage(`§a[OK] Minado completado (${blocks.length} bloques)`);

      zombie.setDynamicProperty("mineStart", null);
      zombie.setDynamicProperty("minePos", null);
    }
  }
}, 2);
