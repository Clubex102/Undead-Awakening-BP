import { world, system, ItemStack } from "@minecraft/server";

const CANNON_ID      = "udaw:cannon";
const BULLET_ID      = "udaw:cannonbullet";
const NUGGET_ITEM    = "minecraft:iron_nugget";
const INGOT_ITEM     = "minecraft:iron_ingot";
const OIL_ITEM       = "udaw:oil_bottle";
const FLINT_STEEL    = "minecraft:flint_and_steel";
const SPAWN_EGG      = "udaw:cannon_spawn_egg";

const SHOOT_COOLDOWN = 300;

// Cargas: objeto en mano -> tipo, coste y etiqueta
const LOADS = {
    [OIL_ITEM]:    { load: "incendiary", cost: 1,  label: "Incendiaria" },
    [INGOT_ITEM]:  { load: "solid",      cost: 2,  label: "Bala rasa" },
    [NUGGET_ITEM]: { load: "shrapnel",   cost: 20, label: "Metralla" }
};
const LOAD_ITEM = {
    incendiary: OIL_ITEM,
    solid: INGOT_ITEM,
    shrapnel: NUGGET_ITEM
};
const LOAD_COST = {
    incendiary: 1,
    solid: 2,
    shrapnel: 20
};
const LOAD_LABEL = {
    incendiary: "Incendiaria",
    solid: "Bala rasa",
    shrapnel: "Metralla"
};

const cannonCooldowns = new Map();
const mountedPlayers  = new Map();
const cannonLoads     = new Map(); // cannonId -> "shrapnel" | "solid" | "incendiary"

/* ================= UTILIDADES ================= */

function countItem(player, typeId) {
    let inv = null;
    try { inv = player.getComponent("inventory").container; } catch (_) { return 0; }
    if (!inv) return 0;

    let total = 0;

    for (let i = 0; i < inv.size; i++) {
        const slot = inv.getItem(i);

        if (slot && slot.typeId === typeId) {
            total += slot.amount;
        }
    }

    return total;
}

function consumeItems(player, typeId, count) {
    let inv = null;
    try { inv = player.getComponent("inventory").container; } catch (_) { return false; }
    if (!inv) return false;

    let toConsume = count;

    for (let i = 0; i < inv.size && toConsume > 0; i++) {
        const slot = inv.getItem(i);

        if (!slot || slot.typeId !== typeId) continue;

        if (slot.amount <= toConsume) {
            toConsume -= slot.amount;
            inv.setItem(i, undefined);
        } else {
            slot.amount -= toConsume;
            inv.setItem(i, slot);
            toConsume = 0;
        }
    }

    return toConsume <= 0;
}

function refundLoad(player, load) {
    const itemId = LOAD_ITEM[load];
    const count = LOAD_COST[load];
    if (!itemId || !count) return;
    try {
        const inv = player.getComponent("inventory").container;
        if (inv && inv.emptySlotsCount > 0) {
            inv.addItem(new ItemStack(itemId, count));
            return;
        }
    } catch (_) {}
    try { player.dimension.spawnItem(new ItemStack(itemId, count), player.location); } catch (_) {}
}

function cannonBar(player, text) {
    // Estado del canon a la hotbar (no al chat)
    try { player.onScreenDisplay.setActionBar(text); } catch (_) {}
}

const FAN_ANGLES = [-10, -7.5, -5, -2.5, 0, 0, 2.5, 5, 7.5, 10];
const FAN_COUNT = 10;
const INC_COUNT = 6;
const SOLID_SPEED = 4.5;
const SHOT_SPEED = 2.5;

function getMuzzlePos(cannon) {
    const pos = cannon.location;
    const rot = cannon.getRotation();

    const rad = (rot.y * Math.PI) / 180;

    return {
        x: pos.x + (-Math.sin(rad) * 2.0),
        y: pos.y + 0.7,
        z: pos.z + (Math.cos(rad) * 2.0)
    };
}

/* ================= HOTBAR ================= */

function loadLabel(cannon) {
    const load = cannonLoads.get(cannon.id);
    return load ? LOAD_LABEL[load] : null;
}

function updateActionBar(player, cannon) {
    const tick = system.currentTick;

    const readyAt = cannonCooldowns.get(cannon.id) ?? 0;

    const remaining = readyAt - tick;

    const loaded = loadLabel(cannon);

    if (remaining > 0) {
        const seconds = (remaining / 20).toFixed(1);

        cannonBar(player, `§e${loaded ?? "SIN CARGAR"} §7| §cCooldown: ${seconds}s`);

    } else if (!loaded) {

        cannonBar(player, `§cSIN CARGAR §7| click con municion`);

    } else {

        cannonBar(player, `§a${loaded} §7| §eUSE FLINT AND STEEL`);
    }
}

function tryLoadCannon(player, cannon, typeId) {
    const spec = LOADS[typeId];
    if (!spec) return false;

    if (cannonLoads.has(cannon.id)) {
        cannonBar(player, `§cYA CARGADO: ${loadLabel(cannon)} §7| dispara primero`);
        return true;
    }

    if (countItem(player, typeId) < spec.cost) {
        cannonBar(player, `§cFALTA: ${spec.cost}x ${typeId}`);
        return true;
    }

    if (!consumeItems(player, typeId, spec.cost)) {
        cannonBar(player, `§cNo se pudo cargar`);
        return true;
    }

    cannonLoads.set(cannon.id, spec.load);
    cannonBar(player, `§aCARGADO: ${spec.label}`);
    try { player.playSound("random.orb"); } catch (_) {}
    return true;
}

/* ================= DISPARO ================= */

function fireCannon(player, cannon) {
    const id = cannon.id;

    const tick = system.currentTick;

    const readyAt = cannonCooldowns.get(id) ?? 0;

    if (tick < readyAt) return;

    const load = cannonLoads.get(id);

    if (!load) {
        cannonBar(player, `§cSIN CARGAR §7| click con municion`);
        return;
    }

    cannonLoads.delete(id);
    cannonCooldowns.set(id, tick + SHOOT_COOLDOWN);

    // Punteria real: si el que dispara va montado, el tiro sale hacia su
    // vista (3D). La curena ya viene girada del loop de montado.
    // Sin jinete: recto al frente.
    let aim = null;
    try {
        const mount = mountedPlayers.get(player.id);
        if (mount && mount.cannon && mount.cannon.id === id && mount.cannon.isValid) {
            try { aim = player.getViewDirection(); } catch (_) { aim = null; }
        }
    } catch (_) { aim = null; }

    let yawDeg = 0;
    let pitchY = 0.05;
    if (aim) {
        yawDeg = Math.atan2(-aim.x, aim.z) * 180 / Math.PI;
        pitchY = aim.y;
    } else {
        try { yawDeg = cannon.getRotation().y; } catch (_) {}
    }

    const baseRad = (yawDeg * Math.PI) / 180;
    const dirX = -Math.sin(baseRad);
    const dirZ =  Math.cos(baseRad);

    const muzzle  = getMuzzlePos(cannon);
    const dim = cannon.dimension;

    const isSolid = load === "solid";
    const isIncendiary = load === "incendiary";
    const count = isSolid ? 1 : (isIncendiary ? INC_COUNT : FAN_COUNT);
    const speed = isSolid ? SOLID_SPEED : SHOT_SPEED;

    // Animacion
    try {
        cannon.playAnimation("animation.cannon.shoot");
    } catch {}

    // Recoil
    try {
        cannon.applyImpulse({ x: -dirX * 0.2, y: 0, z: -dirZ * 0.2 });
    } catch {}

    // Disparo retrasado (mecha)
    system.runTimeout(() => {

        // Sonido
        try {
            dim.playSound("cannonshoot", muzzle, {
                volume: isSolid ? 2.5 : 2.0,
                pitch: isSolid ? 0.7 : 1.0
            });
        } catch {}

        // Particulas
        try {
            if (isIncendiary) {
                dim.spawnParticle("udaw:fire", muzzle);
                dim.spawnParticle("udaw:fire", muzzle);
            }
            dim.spawnParticle("minecraft:huge_explosion_emitter", muzzle);
            dim.spawnParticle("udaw:gun_smoke", muzzle);
            dim.spawnParticle("udaw:gun_smoke", muzzle);
        } catch {}

        // Shake
        try {
            player.runCommand(isSolid ? "camerashake add @s 1.6 0.6 rotational" : "camerashake add @s 1.2 0.5 rotational");
        } catch {}

        // Balas
        for (let i = 0; i < count; i++) {
            let ox = dirX;
            let oz = dirZ;
            let oy = pitchY;

            if (!isSolid) {
                const deg = FAN_ANGLES[i % FAN_ANGLES.length];
                const rad = (deg * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                ox = dirX * cos - dirZ * sin;
                oz = dirX * sin + dirZ * cos;
                oy = pitchY + (Math.random() - 0.5) * 0.12;
            }

            try {
                const bullet = dim.spawnEntity(BULLET_ID, muzzle);

                bullet.applyImpulse({ x: ox * speed, y: oy * speed, z: oz * speed });
                if (isIncendiary) { try { bullet.addTag("udaw:inc"); } catch (_) {} }

            } catch {}
        }

    }, 5);
}

/* ================= PARABOLA ================= */

function previewTrajectory(player, cannon, load) {
    // Puntos de humo con la MISMA matematica del disparo (v0 + gravedad 0.05).
    // La bala central del abanico cae justo sobre esta curva.
    let aim = null;
    try { aim = player.getViewDirection(); } catch (_) { return; }
    if (!aim) return;

    const yawDeg = Math.atan2(-aim.x, aim.z) * 180 / Math.PI;
    const baseRad = (yawDeg * Math.PI) / 180;
    const dirX = -Math.sin(baseRad);
    const dirZ =  Math.cos(baseRad);

    const speed = load === "solid" ? SOLID_SPEED : SHOT_SPEED;
    const dim = cannon.dimension;

    let px = cannon.location.x + dirX * 2.0;
    let py = cannon.location.y + 0.7;
    let pz = cannon.location.z + dirZ * 2.0;
    let vx = aim.x * speed;
    let vy = aim.y * speed;
    let vz = aim.z * speed;

    for (let t = 0; t < 60; t += 4) {
        for (let k = 0; k < 4; k++) {
            px += vx;
            py += vy;
            pz += vz;
            vy -= 0.05;
        }

        const at = { x: px, y: py, z: pz };
        let blk = null;
        try {
            blk = dim.getBlock({ x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz) });
        } catch (_) {}

        try { dim.spawnParticle("udaw:aim_dot", at); } catch (_) {}

        const id = blk ? blk.typeId : "minecraft:air";
        const blocksFlight = id !== "minecraft:air" && id !== "minecraft:water" &&
            id !== "minecraft:flowing_water";

        if (blocksFlight) {
            try {
                dim.spawnParticle("udaw:aim_dot", at);
                dim.spawnParticle("udaw:aim_dot", at);
            } catch (_) {}
            break;
        }
    }
}

/* ================= MONTAR ================= */

function startCannonLoops(player, cannon) {

    if (mountedPlayers.has(player.id)) return;

    const barLoopId = system.runInterval(() => {

        try {

            const playerPos = player.location;
            const cannonPos = cannon.location;

            const dx = Math.abs(playerPos.x - cannonPos.x);
            const dz = Math.abs(playerPos.z - cannonPos.z);
            const dy = Math.abs(playerPos.y - cannonPos.y);

            if (dx > 3 || dz > 3 || dy > 4) {
                cleanupDismount(player);
                return;
            }

            updateActionBar(player, cannon);

            // Punteria visual: la pieza gira al yaw del jinete (suave) y la
            // boca se eleva a su vista via propiedad udaw:elev
            // DEBUG temporal: canta errores y valores al log
            try {
                const pr = player.getRotation();
                const cr = cannon.getRotation();
                const diff = ((pr.y - cr.y + 540) % 360) - 180;
                const step = Math.max(-30, Math.min(30, diff * 0.5));
                try { cannon.setRotation({ x: 0, y: cr.y + step }); } catch (e) { console.warn("[Cannon] setRotation FAIL " + e); }
                let elev = 0;
                try {
                    const vd = player.getViewDirection();
                    const p = Math.asin(Math.max(-1, Math.min(1, vd.y))) * 180 / Math.PI;
                    elev = Math.max(-45, Math.min(15, -p));
                } catch (e) { console.warn("[Cannon] view FAIL " + e); }
                try { cannon.setProperty("udaw:elev", elev); } catch (e) { console.warn("[Cannon] setProperty FAIL " + e); }
                if (system.currentTick % 100 === 0) {
                    console.warn("[Cannon] aim yaw=" + cr.y.toFixed(1) + " step=" + step.toFixed(1) + " elev=" + elev.toFixed(1));
                }
            } catch (e) { console.warn("[Cannon] aim FAIL " + e); }

            try {
                const load = cannonLoads.get(cannon.id);
                if (load) previewTrajectory(player, cannon, load);
            } catch {}

        } catch {
            cleanupDismount(player);
        }

    }, 10);

    mountedPlayers.set(player.id, {
        cannon,
        barLoopId
    });
}

function cleanupDismount(player) {

    const data = mountedPlayers.get(player.id);

    if (!data) return;

    system.clearRun(data.barLoopId);

    mountedPlayers.delete(player.id);

    try {
        player.onScreenDisplay.setActionBar("");
    } catch {}
}

/* ================= INTERACCION ================= */

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {

    const { player, target, itemStack } = event;

    if (target.typeId !== CANNON_ID) return;

    // Sneak recoger (+ reembolso de la carga si llevaba)
    if (player.isSneaking && (!itemStack || itemStack.typeId !== FLINT_STEEL)) {

        event.cancel = true;

        system.run(() => {

            try {

                const pos = target.location;
                const dim = target.dimension;

                const load = cannonLoads.get(target.id);
                if (load) {
                    refundLoad(player, load);
                    cannonLoads.delete(target.id);
                }
                cannonCooldowns.delete(target.id);

                target.remove();

                dim.spawnItem(
                    new ItemStack(SPAWN_EGG, 1),
                    pos
                );

            } catch {}

        });

        return;
    }

    // Cargar con municion en mano (aceite / lingotes / pepitas)
    if (!player.isSneaking && itemStack && LOADS[itemStack.typeId]) {

        event.cancel = true;

        system.run(() => {
            tryLoadCannon(player, target, itemStack.typeId);
        });

        return;
    }

    // Flint and steel disparo
    if (itemStack && itemStack.typeId === FLINT_STEEL) {

        event.cancel = true;

        system.run(() => {
            fireCannon(player, target);
        });

        return;
    }

    // Montar
    if (!itemStack && !mountedPlayers.has(player.id)) {

        system.runTimeout(() => {

            try {
                startCannonLoops(player, target);
            } catch (e) {
                console.warn(`[Cannon] ${e}`);
            }

        }, 20);
    }
});

/* ================= DISPARAR MONTADO ================= */

world.afterEvents.itemUse.subscribe((event) => {

    const player = event.source;
    const item = event.itemStack;

    if (!player || item.typeId !== FLINT_STEEL) return;

    const mountedData = mountedPlayers.get(player.id);

    if (!mountedData) return;

    fireCannon(player, mountedData.cannon);
});

/* ================= LIMPIEZA ================= */

world.afterEvents.entityDie.subscribe((event) => {

    const entity = event.deadEntity;

    if (entity.typeId !== CANNON_ID) return;

    cannonCooldowns.delete(entity.id);
    cannonLoads.delete(entity.id);
});