import {
  world,
  system,
  BlockPermutation
} from "@minecraft/server";

const BREAK_TIME = 60; // ticks (3 segundos)
const MAX_DISTANCE = 3;
const STEP = 0.5;

const BREAKABLE = new Set([
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:sand",
  "minecraft:gravel",
  "minecraft:planks",
  "minecraft:stone"
]);
const DIMENSIONS = ["overworld", "nether", "the_end"];
function getLookBlock(entity) {
  const dir = entity.getViewDirection();
  const origin = entity.getHeadLocation();
  const dimension = entity.dimension;

  for (let d = STEP; d <= MAX_DISTANCE; d += STEP) {
    const pos = {
      x: Math.floor(origin.x + dir.x * d),
      y: Math.floor(origin.y + dir.y * d),
      z: Math.floor(origin.z + dir.z * d)
    };

    const block = dimension.getBlock(pos);
    if (!block) continue;

    if (block.typeId !== "minecraft:air") {
      return { block, pos };
    }
  }
  return null;
}

system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    const dimension = world.getDimension(dimId);
    const zombies = dimension.getEntities({ type: "udaw:zombieminer" });

    for (const zombie of zombies) {
      const target = getLookBlock(zombie);
      if (!target) {
        zombie.setDynamicProperty("mining", false);
        continue;
      }

      if (!BREAKABLE.has(target.block.typeId)) continue;

      // Mantener quieto
      zombie.teleport(zombie.location, {
        dimension: zombie.dimension,
        rotation: zombie.getRotation()
      });
      zombie.getComponent("movement").setCurrentValue(0)

      const tick = system.currentTick;

      if (!zombie.getDynamicProperty("startMine")) {
        zombie.setDynamicProperty("startMine", tick);
        zombie.setDynamicProperty("miningPos", JSON.stringify(target.pos));
        continue;
      }

      const start = zombie.getDynamicProperty("startMine");
      const savedPos = JSON.parse(
        zombie.getDynamicProperty("miningPos")
      );

      // Si cambió de bloque, reiniciar
      if (
        savedPos.x !== target.pos.x ||
        savedPos.y !== target.pos.y ||
        savedPos.z !== target.pos.z
      ) {
        zombie.setDynamicProperty("startMine", tick);
        zombie.setDynamicProperty("miningPos", JSON.stringify(target.pos));
        continue;
      }

      if (tick - start >= BREAK_TIME) {
        zombie.dimension.setBlockType(
          target.pos,
          "minecraft:air"
        );

        zombie.setDynamicProperty("startMine", null);
        zombie.setDynamicProperty("miningPos", null);
        zombie.getComponent("movement").resetToDefaultValue();
      }
    }
  }
}, 2);
