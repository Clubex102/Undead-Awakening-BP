import { world, system } from "@minecraft/server";

const FLINTLOCK_DEFAULT  = "udaw:flintlockgun";
const ARQUEBUS_DEFAULT   = "udaw:arcabuz";
const FLINTLOCK_LOADED   = "udaw:flintlockgun_loaded";
const ARQUEBUS_LOADED    = "udaw:arcabuz_loaded";

const reloadingNow = new Set();

/* ================= INICIO DE RECARGA ================= */

world.afterEvents.itemStartUse.subscribe((event) => {
    const item   = event.itemStack;
    const player = event.source;
    if (!item) return;

    const typeId = item.typeId;
    const id     = player.id;

    if (typeId === FLINTLOCK_DEFAULT && !reloadingNow.has(id)) {
        reloadingNow.add(id);
        player.dimension.playSound("reload2", player.location);
    } else if (typeId === ARQUEBUS_DEFAULT && !reloadingNow.has(id)) {
        reloadingNow.add(id);
        player.dimension.playSound("reload1", player.location);
    }
});

/* ================= CANCELAR SONIDO AL SOLTAR ================= */

world.afterEvents.itemReleaseUse.subscribe((event) => {
    const item   = event.itemStack;
    const player = event.source;
    if (!item) return;

    const typeId = item.typeId;
    const id     = player.id;

    if (typeId === FLINTLOCK_DEFAULT && reloadingNow.has(id)) {
        reloadingNow.delete(id);
        try { player.runCommand("stopsound @s reload2"); } catch (_) {}
    } else if (typeId === ARQUEBUS_DEFAULT && reloadingNow.has(id)) {
        reloadingNow.delete(id);
        try { player.runCommand("stopsound @s reload1"); } catch (_) {}
    }

    // Limpiar al completar recarga (cambia a loaded)
    if (typeId === FLINTLOCK_LOADED || typeId === ARQUEBUS_LOADED) {
        reloadingNow.delete(id);
    }
});