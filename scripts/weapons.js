import { EntityEquippableComponent, EntityHealthComponent, EntityInventoryComponent, EquipmentSlot, GameMode, ItemDurabilityComponent, ItemEnchantableComponent, ItemStack, system, world } from "@minecraft/server";
import { shootCommon, hasHeavyChestplate } from "./globalVar/u.js";

const AMMO_ITEM      = "minecraft:iron_nugget";
const HAND_CANNON_NUGGET = "minecraft:iron_nugget";
const HAND_CANNON_POWDER = "minecraft:gunpowder";
const HAND_CANNON_NUGGET_COUNT = 9;
const HAND_CANNON_POWDER_COUNT = 1;
const HAND_CANNON_OIL      = "udaw:oil_bottle";
const HAND_CANNON_OIL_COUNT = 1;
const reloadingNow   = new Set();
const reloadWatchers = new Map(); // playerId -> loopId
const handCannonNormalTimers = new Map(); // playerId -> timeoutId para 9s early complete (legacy, no usado)
const handCannonSneakPrev = new Map(); // playerId -> bool isSneaking prev

/* ================= REDUCCIÓN DE DAÑO DE PROYECTILES ================= */

const PROJECTILE_DAMAGE_MULTIPLIER = 0.5;

world.afterEvents.entityHurt.subscribe((event) => {
    try {
        if (event.damageSource.cause !== "projectile") return;
        if (!hasHeavyChestplate(event.hurtEntity)) return;

        const health = event.hurtEntity.getComponent(EntityHealthComponent.componentId);
        if (!health) return;

        const healed = Math.round(event.damage * (1 - PROJECTILE_DAMAGE_MULTIPLIER));
        health.setCurrentValue(health.currentValue + healed);
    } catch (_) {}
});

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

function getItemCount(player, itemId) {
    if (player.getGameMode() === GameMode.Creative) return 999;
    let total = 0;
    const equippable = player.getComponent(EntityEquippableComponent.componentId);
    if (equippable) {
        for (const id in EquipmentSlot) {
            const item = equippable.getEquipmentSlot(id).getItem();
            if (item?.typeId === itemId) total += item.amount;
        }
    }
    const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
    if (inv) {
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (item?.typeId === itemId) total += item.amount;
        }
    }
    return total;
}

function hasItemCount(player, itemId, count) {
    if (player.getGameMode() === GameMode.Creative) return true;
    return getItemCount(player, itemId) >= count;
}

function removeItemCount(player, itemId, count) {
    if (player.getGameMode() === GameMode.Creative) return true;
    let remaining = count;
    const equippable = player.getComponent(EntityEquippableComponent.componentId);
    if (equippable) {
        for (const id in EquipmentSlot) {
            if (remaining <= 0) break;
            const slot = equippable.getEquipmentSlot(id);
            const item = slot.getItem();
            if (!item || item.typeId !== itemId) continue;
            if (item.amount > remaining) {
                item.amount -= remaining;
                slot.setItem(item);
                remaining = 0;
            } else {
                remaining -= item.amount;
                slot.setItem(undefined);
            }
        }
    }
    const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
    if (inv && remaining > 0) {
        for (let i = 0; i < inv.size && remaining > 0; i++) {
            const item = inv.getItem(i);
            if (!item || item.typeId !== itemId) continue;
            if (item.amount > remaining) {
                item.amount -= remaining;
                inv.setItem(i, item);
                remaining = 0;
            } else {
                remaining -= item.amount;
                inv.setItem(i, undefined);
            }
        }
    }
    return remaining === 0;
}

function hasHandCannonAmmo(player) {
    return hasItemCount(player, HAND_CANNON_NUGGET, HAND_CANNON_NUGGET_COUNT)
        && hasItemCount(player, HAND_CANNON_POWDER, HAND_CANNON_POWDER_COUNT);
}

function removeHandCannonAmmo(player) {
    if (player.getGameMode() === GameMode.Creative) return true;
    if (!hasHandCannonAmmo(player)) return false;
    // consumir pólvora primero para rollback más simple
    if (!removeItemCount(player, HAND_CANNON_POWDER, HAND_CANNON_POWDER_COUNT)) return false;
    if (!removeItemCount(player, HAND_CANNON_NUGGET, HAND_CANNON_NUGGET_COUNT)) {
        // rollback pólvora si pepitas fallan (muy raro, pero por consistencia)
        try {
            const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
            if (inv) inv.addItem(new ItemStack(HAND_CANNON_POWDER, HAND_CANNON_POWDER_COUNT));
            else player.runCommand(`give @s ${HAND_CANNON_POWDER} ${HAND_CANNON_POWDER_COUNT}`);
        } catch (_) {}
        return false;
    }
    return true;
}

function hasOilInOffhand(player) {
    try {
        const off = player.getComponent(EntityEquippableComponent.componentId)
                         ?.getEquipmentSlot(EquipmentSlot.Offhand)?.getItem();
        return off?.typeId === HAND_CANNON_OIL;
    } catch (_) { return false; }
}

function hasOilModeAmmo(player) {
    return hasItemCount(player, HAND_CANNON_OIL, HAND_CANNON_OIL_COUNT)
        && hasItemCount(player, HAND_CANNON_POWDER, HAND_CANNON_POWDER_COUNT);
}

function removeOilModeAmmo(player) {
    if (player.getGameMode() === GameMode.Creative) return true;
    if (!hasOilModeAmmo(player)) return false;
    // quitar 1 oil bottle prefiriendo offhand
    let oilRemoved = false;
    try {
        const eq = player.getComponent(EntityEquippableComponent.componentId);
        const offSlot = eq?.getEquipmentSlot(EquipmentSlot.Offhand);
        const offItem = offSlot?.getItem();
        if (offItem?.typeId === HAND_CANNON_OIL) {
            if (offItem.amount > 1) { offItem.amount--; offSlot.setItem(offItem); }
            else offSlot.setItem(undefined);
            oilRemoved = true;
        }
    } catch (_) {}
    if (!oilRemoved) {
        if (!removeItemCount(player, HAND_CANNON_OIL, HAND_CANNON_OIL_COUNT)) return false;
    }
    if (!removeItemCount(player, HAND_CANNON_POWDER, HAND_CANNON_POWDER_COUNT)) {
        // rollback oil si pólvora falla
        try {
            const inv = player.getComponent(EntityInventoryComponent.componentId)?.container;
            if (inv) inv.addItem(new ItemStack(HAND_CANNON_OIL, 1));
            else player.runCommand(`give @s ${HAND_CANNON_OIL} 1`);
        } catch (_) {}
        return false;
    }
    return true;
}

function updateHandCannonOilTag(player) {
    try {
        const main = player.getComponent(EntityEquippableComponent.componentId)
                          ?.getEquipmentSlot(EquipmentSlot.Mainhand)?.getItem();
        if (!main || main.typeId !== "udaw:hand_cannon") {
            if (player.hasTag("hand_cannon_oil")) player.removeTag("hand_cannon_oil");
            return;
        }
        if (hasOilInOffhand(player)) {
            if (!player.hasTag("hand_cannon_oil")) player.addTag("hand_cannon_oil");
        } else {
            if (player.hasTag("hand_cannon_oil")) player.removeTag("hand_cannon_oil");
        }
    } catch (_) {}
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
                player.runCommand(`stopsound @a ${soundId}`);
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
    try { player.runCommand(`stopsound @a ${soundId}`); } catch (_) {}
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
    dim.spawnParticle("udaw:gun_smoke", muzzle);
    dim.spawnParticle("udaw:gun_smoke", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
    dim.spawnParticle("minecraft:evaporation_manual", muzzle);
}

/* ================= ESTADO ================= */

const loadedPlayers = {};

// Detección offhand sin loops: si dropeas/mueves la botella de aceite estando en modo secundario, revierte al primario al instante (evento inventario, no polling)
try {
    world.afterEvents.playerInventoryItemChange.subscribe((ev) => {
        const p = ev.player;
        if (!p || !p.isValid) return;
        try {
            const eq = p.getComponent(EntityEquippableComponent.componentId);
            if (!eq) return;
            const main = eq.getEquipmentSlot(EquipmentSlot.Mainhand).getItem();
            if (!main) return;
            if ((main.typeId === "udaw:hand_cannon_oil" || main.typeId === "udaw:hand_cannon_oil_unusable" || main.typeId === "udaw:hand_cannon_loaded_oil") && !hasOilInOffhand(p)) {
                // Si no hay botella en offhand (aunque tengas en inventario, es obligatorio offhand) -> revert
                let target = "udaw:hand_cannon";
                if (main.typeId === "udaw:hand_cannon_oil_unusable") target = "udaw:hand_cannon_unusable";
                if (main.typeId === "udaw:hand_cannon_loaded_oil") target = "udaw:hand_cannon_loaded"; // revert loaded también si mueves antes de disparar
                const swapped = convertItem(main, target);
                eq.getEquipmentSlot(EquipmentSlot.Mainhand).setItem(swapped);
                try { p.onScreenDisplay.setActionBar("§aModo: Perdigones §7| Sin botella en secundaria -> revert"); } catch (_) {}
            }
        } catch (_) {}
    });
} catch (_) {}

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

    /* ---------- HAND CANNON (descargado) - PRIMARIO: 9 pepitas+polvora reload1 9s, 5x bullet 5° ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon", {
        onCompleteUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon") return;
            if (!hasHandCannonAmmo(source)) return;
            if (!removeHandCannonAmmo(source)) return;
            stopReloadSound(source, "reload1");
            try { source.runCommand(`stopsound @a reload1`); } catch (_) {}
            try { source.runCommand(`stopsound @a reload2`); } catch (_) {}
            const loaded = convertItem(item, "udaw:hand_cannon_loaded");
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
            if (item.typeId !== "udaw:hand_cannon") return;
            // Toggle a secundario si estás agachado + oil en offhand (reactivo, sin loops)
            if (source.isSneaking) {
                if (hasOilInOffhand(source)) {
                    const swapped = convertItem(item, "udaw:hand_cannon_oil");
                    mainhand.setItem(swapped);
                    try { source.onScreenDisplay.setActionBar("§6Modo: Oil Bottle §7| 1 Oil + 1 Polvora -> 5x bullet3 fuego"); } catch (_) {}
                    try { source.playSound("random.orb"); } catch (_) {}
                    return;
                } else {
                    try { source.onScreenDisplay.setActionBar("§aModo: Perdigones §7| 9 Pepitas + 1 Polvora -> 5x bullet"); } catch (_) {}
                }
            }
            if (!hasHandCannonAmmo(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon_unusable"));
                try { source.onScreenDisplay.setActionBar("§cSin municion §7| 9 Pepitas + 1 Polvora"); } catch (_) {}
                return;
            }
            try { source.onScreenDisplay.setActionBar("§aModo: Perdigones §7| Recargando..."); } catch (_) {}
            startReloadSound(source, "reload1", "udaw:hand_cannon");
            try { source.playAnimation("animation.humanoid.crossbow_hold", { blendOutTime: 0.2, stopExpression: "1" }); } catch (_) {}
        }
    });

    /* ---------- HAND CANNON OIL (descargado) - SECUNDARIO: 1 oil+1 polvo reload2 10.6s, 5x bullet3 5° ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon_oil", {
        onCompleteUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon_oil") return;
            if (!hasOilModeAmmo(source)) return;
            if (!removeOilModeAmmo(source)) return;
            stopReloadSound(source, "reload1");
            try { source.runCommand(`stopsound @a reload1`); } catch (_) {}
            try { source.runCommand(`stopsound @a reload2`); } catch (_) {}
            const loaded = convertItem(item, "udaw:hand_cannon_loaded_oil");
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
            if (item.typeId !== "udaw:hand_cannon_oil") return;
            // Toggle a primario si estás agachado (reactivo)
            if (source.isSneaking) {
                const swapped = convertItem(item, "udaw:hand_cannon");
                mainhand.setItem(swapped);
                try { source.onScreenDisplay.setActionBar("§aModo: Perdigones §7| 9 Pepitas + 1 Polvora"); } catch (_) {}
                try { source.playSound("random.orb"); } catch (_) {}
                return;
            }
            if (!hasOilModeAmmo(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon_oil_unusable"));
                try { source.onScreenDisplay.setActionBar("§cSin aceite/polvo §7| 1 Oil + 1 Polvora"); } catch (_) {}
                return;
            }
            try { source.onScreenDisplay.setActionBar("§6Modo: Oil Bottle §7| Recargando..."); } catch (_) {}
            startReloadSound(source, "reload1", "udaw:hand_cannon_oil");
            try { source.playAnimation("animation.humanoid.crossbow_hold", { blendOutTime: 0.2, stopExpression: "1" }); } catch (_) {}
        }
    });

    /* ---------- HAND CANNON CARGADO - DISPARA 5 bullet con 5° dispersion ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon_loaded", {
        onUse(event) {
            const { source } = event;
            if (loadedPlayers[source.id]) return;

            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon_loaded") return;

            spawnMuzzleEffects(source, "arquebusshot");
            source.runCommand("camerashake add @s 0.9 0.2 rotational");
            // 5 proyectiles udaw:bullet con 5 grados de dispersion
            shootCommon(source, "udaw:bullet", 5, 5);

            const degraded = decreaseItemDurability(source, item);
            mainhand.setItem(degraded ? convertItem(degraded, "udaw:hand_cannon") : undefined);
        }
    });

    /* ---------- HAND CANNON CARGADO OIL - DISPARA 5 bullet3 con 5° y trail fire ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon_loaded_oil", {
        onUse(event) {
            const { source } = event;
            if (loadedPlayers[source.id]) return;

            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon_loaded_oil") return;

            spawnMuzzleEffects(source, "arquebusshot");
            // extra flame en boca para modo aceite
            try { source.dimension.spawnParticle("udaw:fire", {
                x: source.location.x,
                y: source.location.y + 1.4,
                z: source.location.z
            }); } catch (_) {}
            source.runCommand("camerashake add @s 0.9 0.25 rotational");
            // 5 proyectiles udaw:bullet3 con 5 grados, catch_fire true, trail udaw:fire via bullet_trail.js
            shootCommon(source, "udaw:bullet3", 5, 5);

            const degraded = decreaseItemDurability(source, item);
            mainhand.setItem(degraded ? convertItem(degraded, "udaw:hand_cannon_oil") : undefined);
        }
    });

    /* ---------- HAND CANNON UNUSABLE ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon_unusable", {
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon_unusable") return;
            if (source.isSneaking && hasOilInOffhand(source) && hasOilModeAmmo(source)) {
                const swapped = convertItem(item, "udaw:hand_cannon_oil_unusable");
                mainhand.setItem(swapped);
                try { source.onScreenDisplay.setActionBar("§6Modo: Oil Bottle"); } catch (_) {}
                return;
            }
            if (hasHandCannonAmmo(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon"));
                try { source.onScreenDisplay.setActionBar("§aModo: Perdigones"); } catch (_) {}
            } else if (hasOilModeAmmo(source) && hasOilInOffhand(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon_oil"));
                try { source.onScreenDisplay.setActionBar("§6Modo: Oil Bottle"); } catch (_) {}
            }
        }
    });

    /* ---------- HAND CANNON OIL UNUSABLE ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:hand_cannon_oil_unusable", {
        onUse(event) {
            const { source } = event;
            const mainhand = source.getComponent(EntityEquippableComponent.componentId)
                                   ?.getEquipmentSlot(EquipmentSlot.Mainhand);
            const item = mainhand?.getItem();
            if (!mainhand || !item) return;
            if (item.typeId !== "udaw:hand_cannon_oil_unusable") return;
            if (source.isSneaking) {
                const swapped = convertItem(item, "udaw:hand_cannon_unusable");
                mainhand.setItem(swapped);
                try { source.onScreenDisplay.setActionBar("§aModo: Perdigones"); } catch (_) {}
                return;
            }
            if (hasOilModeAmmo(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon_oil"));
                try { source.onScreenDisplay.setActionBar("§6Modo: Oil Bottle"); } catch (_) {}
            } else if (hasHandCannonAmmo(source)) {
                mainhand.setItem(convertItem(item, "udaw:hand_cannon"));
                try { source.onScreenDisplay.setActionBar("§aModo: Perdigones"); } catch (_) {}
            }
        }
    });

    /* ---------- SABLES ---------- */
    startupEvent.itemComponentRegistry.registerCustomComponent("udaw:sable", {
        onUse(event) {
            const { source, itemStack } = event;
            if (source.typeId !== "minecraft:player" || !itemStack) return;

            source.playAnimation("animation.humanoid.sable_tpp");
            source.dimension.playSound("item.trident.riptide_1", source.location);

            const damage = itemStack.typeId === "udaw:diamond_sable" ? 8
                         : itemStack.typeId === "udaw:iron_sable" ? 7
                         : 6;

            const pos = source.location;
            const rot = source.getRotation();
            const yaw = (rot.y * Math.PI) / 180;
            const dirX = -Math.sin(yaw);
            const dirZ = Math.cos(yaw);

            system.runTimeout(() => {
                const entities = source.dimension.getEntities({
                    location: pos,
                    maxDistance: 4,
                    excludeFamilies: ["player"],
                });

                for (const entity of entities) {
                    if (entity === source) continue;

                    const dx = entity.location.x - pos.x;
                    const dz = entity.location.z - pos.z;

                    const dot = dx * dirX + dz * dirZ;
                    if (dot <= 0 || dot > 3) continue;

                    const perp = Math.abs(dx * (-dirZ) + dz * dirX);
                    if (perp > 1.5) continue;

                    const dy = entity.location.y - pos.y;
                    if (Math.abs(dy) > 1.5) continue;

                    entity.applyDamage(damage);
                }
            }, 7);
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
    } else if (typeId === "udaw:hand_cannon" || typeId === "udaw:hand_cannon_oil") {
        stopReloadSound(player, "reload1");
        try { player.runCommand(`stopsound @a reload2`); } catch (_) {}
        if (handCannonNormalTimers.has(player.id)) {
            try { system.clearRun(handCannonNormalTimers.get(player.id)); } catch (_) {}
            handCannonNormalTimers.delete(player.id);
        }
        try { updateHandCannonOilTag(player); } catch (_) {}
    }

    if (typeId === "udaw:arcabuz_loaded" || typeId === "udaw:flintlockgun_loaded" || typeId === "udaw:hand_cannon_loaded" || typeId === "udaw:hand_cannon_loaded_oil" || typeId === "udaw:hand_cannon_oil_loaded") {
        delete loadedPlayers[player.id];
    }
});