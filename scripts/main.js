import { world } from "@minecraft/server";
import { shootCommon, shootRepeat } from "./globalVar/u.js";

// Escuchar cuando un jugador usa cualquier ítem
world.afterEvents.itemUse.subscribe(ev => {

    const { itemStack, source } = ev;

    if (!itemStack || !source) return;

    // Revisar si el ítem tiene el componente "udaw:weapon"
    const comp = itemStack.getComponent("minecraft:custom_components");

    if (!comp || !comp.has("udaw:weapon")) return;

    // Si no está agachado → disparar
    if (!source.isSneaking) {
        shootCommon(source, "minecraft:arrow", 1, 1);
    }
});
