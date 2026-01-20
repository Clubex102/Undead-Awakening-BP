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

    for (const entity of dimension.getEntities({ type: "udaw:zombieminer" })) {
      const view = entity.getViewDirection();
      const pos = entity.location;
      world.sendMessage(`Zombie Miner Position: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);
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
      world.sendMessage(`Zombie Miner is mining block: ${block.typeId} at tick ${system.currentTick}`);
      const startTick = entity.getDynamicProperty("mining");

      if (system.currentTick - startTick >= BREAK_DELAY) {
        dimension.setBlockType(blockPos, "minecraft:air");
        world.sendMessage(`§c[UDaw] §fEl Zombie Miner ha minado un bloque de §6${block.typeId}§f.`);
        entity.setDynamicProperty("mining", null);
      }
    }
  }
}, 5);
