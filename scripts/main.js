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



const AMMO_ITEM = "minecraft:iron_nugget";
const FIRE_COOLDOWN_TICKS = 20;
const WEAPON_COOLDOWN_DISPLAY = 100;

const firingCooldown = new Set();
const cooldownDisplays = new Map();

/* ================= CONTAR MUNICIÓN ================= */

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

function startCooldownDisplay(player, readyAtTick) {
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
                player.onScreenDisplay.setActionBar(`§aFlintlock §a✦✦✦✦✦ §aListo  ${ammoText}`);
            } catch (_) {}
            system.clearRun(cooldownDisplays.get(id));
            cooldownDisplays.delete(id);
            return;
        }

        const progress = Math.max(0, remaining / WEAPON_COOLDOWN_DISPLAY);
        const filled   = Math.round(progress * 5);
        const empty    = 5 - filled;
        const bar      = "§c" + "✦".repeat(filled) + "§7" + "✦".repeat(empty);
        const seconds  = (remaining / 20).toFixed(1);

        try {
            player.onScreenDisplay.setActionBar(`§eFlintlock ${bar} §7${seconds}s  ${ammoText}`);
        } catch (_) {}
    }, 2);

    cooldownDisplays.set(id, loopId);
}

function showAmmoOnly(player) {
    const ammo     = countAmmo(player);
    const ammoText = ammo > 0 ? `§e⬡ ${ammo}` : `§c⬡ 0`;
    try {
        player.onScreenDisplay.setActionBar(`§aFlintlock §a✦✦✦✦✦ §aListo  ${ammoText}`);
    } catch (_) {}
}

/* ================= COMPONENTE DEL ARMA ================= */

system.beforeEvents.startup.subscribe((startupEvent) => {
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onUse(event) {
            const { itemStack, source } = event;

            if (firingCooldown.has(source.id)) return;

            const inventory = source.getComponent("inventory").container;
            let hasAmmo = false;

            for (let i = 0; i < inventory.size; i++) {
                const slot = inventory.getItem(i);
                if (slot && slot.typeId === AMMO_ITEM) {
                    hasAmmo = true;
                    break;
                }
            }

            if (!hasAmmo) {
                source.sendMessage("§cI haven't ammo.");
                showAmmoOnly(source);
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
                const heldSlot = source.getComponent("equippable");
                heldSlot.setEquipment("Mainhand", itemStack);
            }

            const rot = source.getRotation();
            const rad = (rot.y * Math.PI) / 180;
            const muzzlePos = {
                x: source.location.x + (-Math.sin(rad) * 0.8),
                y: source.location.y + 1.4,
                z: source.location.z + (Math.cos(rad) * 0.8),
            };
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

            source.runCommand("camerashake add @s 0.5 0.15 rotational");

            firingCooldown.add(source.id);
            system.runTimeout(() => firingCooldown.delete(source.id), FIRE_COOLDOWN_TICKS);

            const readyAt = system.currentTick + WEAPON_COOLDOWN_DISPLAY;
            startCooldownDisplay(source, readyAt);

            shootCommon(source, "udaw:bullet", 1, 1);
            itemStack.getComponent("cooldown").startCooldown(source);
        }
    });
});