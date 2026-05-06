import { EntityEquippableComponent, EntityInventoryComponent, EquipmentSlot, GameMode, ItemDurabilityComponent, ItemEnchantableComponent, ItemStack, system, world } from "@minecraft/server";
import { shootCommon } from "./globalVar/u.js";

const AMMO_ITEM      = "minecraft:iron_nugget";
const reloadingNow   = new Set();
const reloadWatchers = new Map(); // playerId -> loopId

/* ================= UTILIDADES ================= */

function removeItem(player, itemId) {
    if (player.getGameMode() !== GameMode.Creative) {
        let found = false;
        const equippable = player.getComponent(EntityEquippableComponent.componentId);
        if (!equippable) return false;
        for (const id in EquipmentSlot) {
            if (found) continue;
            const slot = equippable.getEquipmentSlot(id);
            const item = slot.getItem();
            if (item?.typeId !== itemId) continue;
            found = true;
            if (item.amount - 1 > 0) { item.amount--; slot.setItem(item); }
            else slot.setItem(undefined);
        }
        if (!found) {
            const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
            if (!inv) return false;
            for (let i = 0; i < inv.size; i++) {
                if (found) continue;
                const item = inv.getItem(i);
                if (!item || item.typeId !== itemId) continue;
                found = true;
                if (item.amount - 1 > 0) { item.amount--; inv.setItem(i, item); }
                else inv.setItem(i, undefined);
            }
        }
        return found;
    }
    return true;
}

function hasItem(player, itemId) {
    if (player.getGameMode() !== GameMode.Creative) {
        let found = false;
        const equippable = player.getComponent(EntityEquippableComponent.componentId);
        if (!equippable) return false;
        for (const id in EquipmentSlot) {
            if (found) continue;
            const slot = equippable.getEquipmentSlot(id);
            if (slot.getItem()?.typeId === itemId) found = true;
        }
        if (!found) {
            const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
            if (!inv) return false;
            for (let i = 0; i < inv.size; i++) {
                if (found) continue;
                const item = inv.getItem(i);
                if (item?.typeId === itemId) found = true;
            }
        }
        return found;
    }
    return true;
}

function decreaseItemDurability(player, item) {
    const gamemode = player.getGameMode();
    if (gamemode !== GameMode.Survival && gamemode !== GameMode.Adventure) return item;
    const comp = item.getComponent(ItemDurabilityComponent.componentId);
    if (!comp) return item;
    const unbreaking = item.getComponent(ItemEnchantableComponent.componentId)?.getEnchantment("unbreaking");
    const chance = unbreaking ? unbreaking.level * 0.25 : 0;
    if (chance > Math.random()) return item;
    if (comp.damage + 1 > comp.maxDurability) {
        player.playSound("random.break");
        return undefined;
    }
    comp.damage += 1;
    return item;
}

function convertItem(from, toId) {
    const newItem = new ItemStack(toId, from.amount);
    const durComp = from.getComponent(ItemDurabilityComponent.componentId);
    if (durComp) {
        const newDur = newItem.getComponent(ItemDurabilityComponent.componentId);
        if (newDur) newDur.damage = durComp.damage;
    }
    const enchants = from.getComponent(ItemEnchantableComponent.componentId)?.getEnchantments();
    if (enchants) newItem.getComponent(ItemEnchantableComponent.componentId)?.addEnchantments(enchants);
    if (from.nameTag) newItem.nameTag = from.nameTag;
    const lore = from.getLore();
    if (lore?.length) newItem.setLore(lore);
    return newItem;
}

/* ================= SONIDO DE RECARGA ================= */

function startReloadSound(player, soundId, watchItemId) {
    const pid = player.id;
    if (reloadingNow.has(pid)) return;
    reloadingNow.add(pid);
    player.dimension.playSound(soundId, player.location);

    const watchId = system.runInterval(() => {
        try {
            const held = player.getComponent(EntityEquippableComponent.componentId)
                               ?.getEquipmentSlot(EquipmentSlot.Mainhand)?.getItem();
            if (!held || held.typeId !== watchItemId) {
                player.runCommand(`stopsound @s ${soundId}`);
                reloadingNow.delete(pid);
                system.clearRun(reloadWatchers.get(pid));
                reloadWatchers.delete(pid);
            }
        } catch (_) {
            system.clearRun(reloadWatchers.get(pid));
            reloadWatchers.delete(pid);
        }
    }, 5);
    reloadWatchers.set(pid, watchId);
}

function stopReloadSound(player, soundId) {
    const pid = player.id;
    try { player.runCommand(`stopsound @s ${soundId}`); } catch (_) {}
    reloadingNow.delete(pid);
    if (reloadWatchers.has(pid)) {
        system.clearRun(reloadWatchers.get(pid));
        reloadWatchers.delete(pid);
    }
}

/* ================= PARTICULAS Y SHAKE ================= */

function spawnMuzzleEffects(player, shootSound) {
    const rot = player.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    const muzzle = {
        x: player.location.x + (-Math.sin(rad) * 0.8),
        y: player.location.y + 1.4,
        z: player.location.z + (Math.cos(rad) * 0.8),
    };
    const dim = player.dimension;
    if (shootSound !== "flintlockshoot") {
        dim.playSound(shootSound, player.location, { volume: 5, maxDistance: 1000 });
    }
    dim.spawnParticle("minecraft:large_explosion", muzzle);
    dim.spawnParticle("minecraft:large_explosion", muzzle);
    dim.spawnParticle("minecraft:large_explosion", muzzle);
    dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
    dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
    dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
    dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
    dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:evaporation_manual", muzzle);
}

/* ================= ESTADO ================= */

const loadedPlayers = {};

/* ================= COMPONENTES ================= */

system.beforeEvents.startup.subscribe((startupEvent) => {

    /* ---------- ARQUEBUS (descargado) ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:arquebus", {
        onCompleteUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:arcabuz") return;

            if (!removeItem(source, AMMO_ITEM)) return;

            stopReloadSound(source, "reload1");

            const loaded = convertItem(item, "udaw:arcabuz_loaded");
            mainhand.setItem(loaded);

            const id = source.id;
            loadedPlayers[id] = true;
            system.runTimeout(() => { delete loadedPlayers[id]; }, 7);
        },
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:arcabuz") return;

            if (!hasItem(source, AMMO_ITEM)) {
                mainhand.setItem(convertItem(item, "udaw:arcabuz_unusable"));
            } else {
                startReloadSound(source, "reload1", "udaw:arcabuz");
                try { source.playAnimation("animation.humanoid.crossbow_hold", { blendOutTime: 0.2, stopExpression: "1" }); } catch (_) {}
            }
        }
    });

    /* ---------- ARQUEBUS CARGADO ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:arquebus_loaded", {
        onUse(event) {
            const { source } = event;
            if (loadedPlayers[source.id]) return;

            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:arcabuz_loaded") return;

            spawnMuzzleEffects(source, "arquebusshot");
            source.runCommand("camerashake add @s 0.9 0.15 rotational");
            shootCommon(source, "udaw:bullet2", 1, 1);

            const degraded = decreaseItemDurability(source, item);
            mainhand.setItem(degraded ? convertItem(degraded, "udaw:arcabuz") : undefined);
        }
    });

    /* ---------- ARQUEBUS UNUSABLE ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:arquebus_unusable", {
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:arcabuz_unusable") return;

            if (hasItem(source, AMMO_ITEM)) {
                mainhand.setItem(convertItem(item, "udaw:arcabuz"));
            }
        }
    });

    /* ---------- FLINTLOCK (descargado) ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon", {
        onCompleteUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:flintlockgun") return;

            if (!removeItem(source, AMMO_ITEM)) return;

            stopReloadSound(source, "reload2");

            const loaded = convertItem(item, "udaw:flintlockgun_loaded");
            mainhand.setItem(loaded);

            const id = source.id;
            loadedPlayers[id] = true;
            system.runTimeout(() => { delete loadedPlayers[id]; }, 7);
        },
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:flintlockgun") return;

            if (!hasItem(source, AMMO_ITEM)) {
                mainhand.setItem(convertItem(item, "udaw:flintlockgun_unusable"));
            } else {
                startReloadSound(source, "reload2", "udaw:flintlockgun");
                try { source.playAnimation("animation.humanoid.crossbow_hold", { blendOutTime: 0.2, stopExpression: "1" }); } catch (_) {}
            }
        }
    });

    /* ---------- FLINTLOCK CARGADO ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon_loaded", {
        onUse(event) {
            const { source } = event;
            if (loadedPlayers[source.id]) return;

            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:flintlockgun_loaded") return;

            spawnMuzzleEffects(source, "flintlockshoot");
            source.dimension.playSound("flintlockshoot", source.location, { volume: 5, maxDistance: 1000 });
            source.runCommand("camerashake add @s 0.5 0.15 rotational");
            shootCommon(source, "udaw:bullet", 1, 1);

            const degraded = decreaseItemDurability(source, item);
            mainhand.setItem(degraded ? convertItem(degraded, "udaw:flintlockgun") : undefined);
        }
    });

    /* ---------- FLINTLOCK UNUSABLE ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:weapon_unusable", {
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:flintlockgun_unusable") return;

            if (hasItem(source, AMMO_ITEM)) {
                mainhand.setItem(convertItem(item, "udaw:flintlockgun"));
            }
        }
    });
});

/* ================= SOLTAR BOTON ================= */

world.afterEvents.itemReleaseUse.subscribe((event) => {
    const item   = event.itemStack;
    const player = event.source;
    if (!item) return;

    const typeId = item.typeId;

    if (typeId === "udaw:arcabuz") {
        stopReloadSound(player, "reload1");
    } else if (typeId === "udaw:flintlockgun") {
        stopReloadSound(player, "reload2");
    }

    if (typeId === "udaw:arcabuz_loaded" || typeId === "udaw:flintlockgun_loaded") {
        delete loadedPlayers[player.id];
    }
});