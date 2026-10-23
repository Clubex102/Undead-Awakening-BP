import { world, system, ItemStack } from "@minecraft/server";

const DESTROYED_ID = "udaw:big_ship_destroyed";
const OWNER_PREFIX = "udaw_owner:";
const REPAIR_PREFIX = "udaw_repair:";
const REPAIR_TOTAL = 10;

function isAlive(entity) {
    try {
        return !!entity && entity.isValid;
    } catch (_) {
        return false;
    }
}

function ownerOf(entity) {
    try {
        const tag = entity.getTags().find((t) => t.startsWith(OWNER_PREFIX));
        return tag ? tag.slice(OWNER_PREFIX.length) : undefined;
    } catch (_) {
        return undefined;
    }
}

function progressOf(entity) {
    try {
        const tag = entity.getTags().find((t) => t.startsWith(REPAIR_PREFIX));
        if (!tag) return 0;
        const value = Number(tag.slice(REPAIR_PREFIX.length));
        return Number.isFinite(value) ? Math.max(0, Math.min(REPAIR_TOTAL, value)) : 0;
    } catch (_) {
        return 0;
    }
}

function setProgress(entity, value) {
    try {
        for (const tag of entity.getTags()) {
            if (tag.startsWith(REPAIR_PREFIX)) entity.removeTag(tag);
        }
    } catch (_) {}
    try { entity.addTag(REPAIR_PREFIX + value); } catch (_) {}
}

function setOwner(entity, player) {
    try {
        for (const tag of entity.getTags()) {
            if (tag.startsWith(OWNER_PREFIX)) entity.removeTag(tag);
        }
        entity.addTag(OWNER_PREFIX + player.id);
    } catch (_) {}
}

function isRepairMaterial(item) {
    const id = item.typeId;
    return id === "minecraft:iron_ingot" || id.endsWith("_planks") || id.endsWith("_wool");
}

function heldItem(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
    } catch (_) {
        return undefined;
    }
}

function consume(player, item) {
    let container;
    try {
        container = player.getComponent("minecraft:inventory")?.container;
    } catch (_) {
        return false;
    }
    if (!container) return false;

    try {
        const slot = player.selectedSlotIndex;
        if (item.amount <= 1) container.setItem(slot, undefined);
        else container.setItem(slot, new ItemStack(item.typeId, item.amount - 1));
        return true;
    } catch (_) {
        return false;
    }
}

function actionBar(player, text) {
    try { player.onScreenDisplay.setActionBar(text); } catch (_) {}
}

function repair(player, target) {
    if (!isAlive(player) || !isAlive(target) || target.typeId !== DESTROYED_ID) return;

    const item = heldItem(player);
    if (!item || !isRepairMaterial(item)) {
        actionBar(player, "§7Trae madera, hierro o lana para reparar el casco.");
        return;
    }

    const owner = ownerOf(target);
    if (owner && owner !== player.id) {
        actionBar(player, "§cEste pecio pertenece a otro jugador.");
        return;
    }

    const progress = progressOf(target);
    if (progress >= REPAIR_TOTAL) return;

    if (!consume(player, item)) return;
    const next = progress + 1;

    if (next >= REPAIR_TOTAL) {
        const dim = target.dimension;
        const pos = target.location;
        let rot = { x: 0, y: 0, z: 0 };
        try { rot = target.getRotation(); } catch (_) {}

        let ship;
        try { ship = dim.spawnEntity("udaw:big_ship", pos); } catch (_) {}
        if (!ship) return;

        try { target.remove(); } catch (_) {}
        try { ship.setRotation(rot); } catch (_) {}
        try { ship.addTag(OWNER_PREFIX + player.id); } catch (_) {}

        actionBar(player, "§a¡Barco reclamado!");
        return;
    }

    if (progress === 0) setOwner(target, player);
    setProgress(target, next);
    actionBar(player, `§eReparación: §f${next}/${REPAIR_TOTAL} §7(madera, hierro o lana)`);
}

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const target = event.target;
    if (!target || target.typeId !== DESTROYED_ID) return;

    event.cancel = true;
    const player = event.player;
    system.run(() => {
        try { repair(player, target); } catch (_) {}
    });
});
