import {
    system,
    CustomComponentParameters,
    ItemComponentBeforeDurabilityDamageEvent,
    ItemComponentCompleteUseEvent,
    ItemComponentConsumeEvent,
    ItemComponentHitEntityEvent,
    ItemComponentMineBlockEvent,
    ItemComponentUseEvent,
    ItemComponentUseOnEvent,
} from "@minecraft/server";
import { shootCommon, shootRepeat } from "./globalVar/u.js";
import "./entities/zombie_miner.js";
import "./entities/zombiewc.js";
import "./entities/zombielance.js";

system.beforeEvents.startup.subscribe((startupEvent) => {
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(event) {
            const { itemStack, source } = event;
            shootCommon(source, "udaw:bullet", 1, 1);
            itemStack.getComponent("cooldown").startCooldown(source);
            
            // Restar 5 puntos de durabilidad
            const durabilityComponent = itemStack.getComponent("durability");
            if (durabilityComponent) {
                durabilityComponent.damage(5, source);
            }
        },
    });
});
