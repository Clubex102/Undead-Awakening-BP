import { world, system } from "@minecraft/server";

system.runInterval(() => {
  for (const dim of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dim);

    const miners = dimension.getEntities({ families: ["miner"] });

    for (const miner of miners) {
      miner.triggerEvent("udaw:start_mining");
    }
  }
}, 200);
