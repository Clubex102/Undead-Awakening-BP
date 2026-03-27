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
import "./entities/zombietnt.js";
import "./cannon.js";
import "./entities/pillager.js";



const AMMO_ITEM = "minecraft:iron_nugget";
 
const firingCooldown  = new Set();
const cooldownDisplays = new Map();
 
/* ================= CONTAR MUNICION ================= */
 
function countAmmo(player) {
    const inventory = player.getComponent("inventory").container;
    let total = 0;
    for (let i = 0; i < inventory.size; i++) {
        const slot = inventory.getItem(i);
        if (slot && slot.typeId === AMMO_ITEM) total += slot.amount;
    }
    return total;
}
 
/* ================= ACTIONBAR ================= */
 
function startCooldownDisplay(player, readyAtTick, displayTicks, label) {
    const id = player.id;
 
    if (cooldownDisplays.has(id)) {
        system.clearRun(cooldownDisplays.get(id));
    }
 
    const loopId = system.runInterval(() => {
        const remaining = readyAtTick - system.currentTick;
        const ammo      = countAmmo(player);
        const ammoText  = ammo > 0 ? `§e⬡ ${ammo}` : `§c⬡ 0`;
 
        if (remaining <= 0) {
            try {
                player.onScreenDisplay.setActionBar(`§a${label} §a✦✦✦✦✦ §aListo  ${ammoText}`);
            } catch (_) {}
            system.clearRun(cooldownDisplays.get(id));
            cooldownDisplays.delete(id);
            return;
        }
 
        const progress = Math.max(0, remaining / displayTicks);
        const filled   = Math.round(progress * 5);
        const empty    = 5 - filled;
        const bar      = "§c" + "✦".repeat(filled) + "§7" + "✦".repeat(empty);
        const seconds  = (remaining / 20).toFixed(1);
 
        try {
            player.onScreenDisplay.setActionBar(`§e${label} ${bar} §7${seconds}s  ${ammoText}`);
        } catch (_) {}
    }, 2);
 
    cooldownDisplays.set(id, loopId);
}
 
function showAmmoOnly(player, label) {
    const ammo     = countAmmo(player);
    const ammoText = ammo > 0 ? `§e⬡ ${ammo}` : `§c⬡ 0`;
    try {
        player.onScreenDisplay.setActionBar(`§a${label} §a✦✦✦✦✦ §aListo  ${ammoText}`);
    } catch (_) {}
}
 
/* ================= DISPARO COMUN ================= */
 
function fireWeapon(source, itemStack, bulletId, cooldownDisplayTicks, fireCooldownTicks, label, cameraShakeIntensity, shootSound) {
    if (firingCooldown.has(source.id)) return;
 
    const inventory = source.getComponent("inventory").container;
    let hasAmmo = false;
 
    for (let i = 0; i < inventory.size; i++) {
        const slot = inventory.getItem(i);
        if (slot && slot.typeId === AMMO_ITEM) { hasAmmo = true; break; }
    }
 
    if (!hasAmmo) {
        source.sendMessage("§cI haven't ammo.");
        showAmmoOnly(source, label);
        return;
    }
 
    for (let i = 0; i < inventory.size; i++) {
        const slot = inventory.getItem(i);
        if (slot && slot.typeId === AMMO_ITEM) {
            if (slot.amount > 1) {
                slot.amount -= 1;
                inventory.setItem(i, slot);
            } else {
                inventory.setItem(i, undefined);
            }
            break;
        }
    }
 
    const durability = itemStack.getComponent("durability");
    if (durability) {
        durability.damage = Math.min(durability.damage + 1, durability.maxDurability);
        source.getComponent("equippable").setEquipment("Mainhand", itemStack);
    }
 
    const rot = source.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    const muzzlePos = {
        x: source.location.x + (-Math.sin(rad) * 0.8),
        y: source.location.y + 1.4,
        z: source.location.z + (Math.cos(rad) * 0.8),
    };
 
    source.dimension.runCommand(`playsound ${shootSound} @a ${muzzlePos.x} ${muzzlePos.y} ${muzzlePos.z} 1.0 1.0`);
 
    source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
    source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
    source.dimension.spawnParticle("minecraft:large_explosion", muzzlePos);
    source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:campfire_smoke_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:basic_flame_particle", muzzlePos);
    source.dimension.spawnParticle("minecraft:evaporation_manual", muzzlePos);
 
    source.runCommand(`camerashake add @s ${cameraShakeIntensity} 0.15 rotational`);
 
    firingCooldown.add(source.id);
    system.runTimeout(() => firingCooldown.delete(source.id), fireCooldownTicks);
 
    const readyAt = system.currentTick + cooldownDisplayTicks;
    startCooldownDisplay(source, readyAt, cooldownDisplayTicks, label);
 
    shootCommon(source, bulletId, 1, 1);
    itemStack.getComponent("cooldown").startCooldown(source);
}
 
/* ================= COMPONENTES ================= */
 
system.beforeEvents.startup.subscribe((startupEvent) => {
 
    // --- Flintlock ---
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(event) {
            fireWeapon(
                event.source,
                event.itemStack,
                "udaw:bullet",
                100,
                20,
                "Flintlock",
                0.5,
                "flintlockshoot"
            );
        }
    });
 
    // --- Arcabuz ---
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:arquebus", {
        onUse(event) {
            fireWeapon(
                event.source,
                event.itemStack,
                "udaw:bullet2",
                180,
                20,
                "Arquebus",
                0.9,
                "arcabusshot"
            );
        }
    });
 
});
 