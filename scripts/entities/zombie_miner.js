import { world, system, BlockPermutation } from "@minecraft/server";

const BREAK_DELAY = 40; // ticks (2 segundos)
const BREAKABLE_BLOCKS = [
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:sand",
  "minecraft:gravel",
  "minecraft:planks"
];

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const dimension = player.dimension;

    for (const entity of dimension.getEntities({ type: "minecraft:zombie" })) {
      const view = entity.getViewDirection();
      const pos = entity.location;

      const blockPos = {
        x: Math.floor(pos.x + view.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z + view.z),
      };

      const block = dimension.getBlock(blockPos);
      if (!block) continue;

      if (!BREAKABLE_BLOCKS.includes(block.typeId)) continue;

      if (!entity.getDynamicProperty("mining")) {
        entity.setDynamicProperty("mining", system.currentTick);
      }

      const startTick = entity.getDynamicProperty("mining");

      if (system.currentTick - startTick >= BREAK_DELAY) {
        dimension.setBlock(
          blockPos,
          BlockPermutation.resolve("minecraft:air")
        );

        entity.setDynamicProperty("mining", null);
      }
    }
  }
}, 5);
