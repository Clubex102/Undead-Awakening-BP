import {
    system,
} from "@minecraft/server";
import { shootCommon, shootRepeat } from "./globalVar/u.js";

system.beforeEvents.startup.subscribe((udaw) => {
    udaw.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(ev) {
            const { itemStack, source } = ev;
            if (!source.isSneaking) {
                shootCommon(source, "minecraft:arrow", 1, 1);
            }
        } 
    })
});