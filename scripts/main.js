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

const AMMO_ITEM = "minecraft:iron_nugget"; // ID de pepitas de hierro

system.beforeEvents.startup.subscribe((startupEvent) => {
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(event) {
            const { itemStack, source } = event;

            // Buscar pepitas de hierro en cualquier slot del inventario
            const inventory = source.getComponent("inventory").container;
            let hasAmmo = false;

            for (let i = 0; i < inventory.size; i++) {
                const slot = inventory.getItem(i);
                if (slot && slot.typeId === AMMO_ITEM) {
                    hasAmmo = true;
                    break;
                }
            }

            // Sin munición: mensaje solo visible para ese jugador, nada más
            if (!hasAmmo) {
                source.sendMessage("§cI haven't ammo.");
                return;
            }

            // Con munición: consumir 1 pepita y disparar
            for (let i = 0; i < inventory.size; i++) {
                const slot = inventory.getItem(i);
                if (slot && slot.typeId === AMMO_ITEM) {
                    if (slot.amount > 1) {
                        slot.amount -= 1;
                        inventory.setItem(i, slot);
                    } else {
                        inventory.setItem(i, undefined); // Eliminar el stack vacío
                    }
                    break;
                }
            }

            // Restar 1 de durabilidad al arma
            const durability = itemStack.getComponent("durability");
            if (durability) {
                durability.damage = Math.min(durability.damage + 1, durability.maxDurability);
                // Actualizar el item en la mano del jugador
                const heldSlot = source.getComponent("equippable");
                heldSlot.setEquipment("Mainhand", itemStack);
            }

            // Partículas de disparo en la boca del cañón
            const rot = source.getRotation();
            const rad = (rot.y * Math.PI) / 180;
            const muzzlePos = {
                x: source.location.x + (-Math.sin(rad) * 0.8),
                y: source.location.y + 1.4,
                z: source.location.z + (Math.cos(rad) * 0.8),
            };
            // Nube de humo grande — efecto de pólvora quemada
            source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
            // Chispa de fuego encima del humo — simula el fogonazo del disparo
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);

            // Disparo normal
            shootCommon(source, "udaw:bullet", 1, 1);
            itemStack.getComponent("cooldown").startCooldown(source);
        }
    });
});
