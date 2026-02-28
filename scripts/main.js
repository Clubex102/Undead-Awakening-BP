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

const AMMO_ITEM = "minecraft:iron_nugget"; // ID de pepitas de hierro
const FIRE_COOLDOWN_TICKS = 20; // Debe coincidir con el cooldown del item en su JSON

// Set de jugadores que están en cooldown — evita el loop al mantener presionado
const firingCooldown = new Set();

system.beforeEvents.startup.subscribe((startupEvent) => {
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(event) {
            const { itemStack, source } = event;

            // Salir si este jugador ya disparó y sigue en cooldown
            if (firingCooldown.has(source.id)) return;

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

            // 10% de probabilidad de atasco — antes de consumir munición o disparar
            if (Math.random() < 0.10) {
                source.sendMessage("§eThe weapon is jammed.");
                return;
            }

            // Consumir 1 pepita de hierro
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
            // Nube de humo densa — efecto de pólvora quemada
            source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
            source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
            source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
             source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
             source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
             source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
             source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
                source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
            // Chispa/llama — fogonazo del cañón
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
            source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
            // Humo blanco que sube y se disipa — vapor de pólvora residual
            source.dimension.spawnParticle("minecraft:evaporation_manual", muzzlePos);
            
            

            // Camera shake ligero para simular retroceso
            source.runCommand("camerashake add @s 0.5 0.15 rotational");

            // Registrar cooldown manual — se limpia automáticamente tras FIRE_COOLDOWN_TICKS
            firingCooldown.add(source.id);
            system.runTimeout(() => firingCooldown.delete(source.id), FIRE_COOLDOWN_TICKS);

            // Disparo normal
            shootCommon(source, "udaw:bullet", 1, 1);
            itemStack.getComponent("cooldown").startCooldown(source);
        }
    });
});