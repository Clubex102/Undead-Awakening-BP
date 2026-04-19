import { world, system, ItemStack } from "@minecraft/server";

const CANNON_ID      = "udaw:cannon";
const BULLET_ID      = "udaw:cannonbullet";
const AMMO_ITEM      = "minecraft:iron_nugget";
const FLINT_STEEL    = "minecraft:flint_and_steel";
const SPAWN_EGG      = "udaw:cannon_spawn_egg";
const AMMO_COST      = 20;
const SHOOT_COOLDOWN = 300; // 15 segundos
const BULLET_COUNT   = 10;
const FAN_ANGLES     = [-10, -7.5, -5, -2.5, 0, 0, 2.5, 5, 7.5, 10];

const cannonCooldowns = new Map();
const mountedPlayers  = new Map();

/* ================= UTILIDADES ================= */

function countAmmo(player) {
    const inventory = player.getComponent("inventory").container;
    let total = 0;
    for (let i = 0; i < inventory.size; i++) {
        const slot = inventory.getItem(i);
        if (slot && slot.typeId === AMMO_ITEM) total += slot.amount;
    }
    return total;
}

function consumeAmmo(player) {
    const inventory = player.getComponent("inventory").container;
    let toConsume = AMMO_COST;
    for (let i = 0; i < inventory.size && toConsume > 0; i++) {
        const slot = inventory.getItem(i);
        if (!slot || slot.typeId !== AMMO_ITEM) continue;
        if (slot.amount <= toConsume) {
            toConsume -= slot.amount;
            inventory.setItem(i, undefined);
        } else {
            slot.amount -= toConsume;
            inventory.setItem(i, slot);
            toConsume = 0;
        }
    }
}

function getMuzzlePos(cannon) {
    const pos = cannon.location;
    const rot = cannon.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    return {
        x: pos.x + (-Math.sin(rad) * 2.0), // 2 bloques adelante para evitar autodaño
        y: pos.y + 0.7,
        z: pos.z + (Math.cos(rad) * 2.0)
    };
}

function getFanOffsets(cannon) {
    const rot     = cannon.getRotation();
    const baseRad = (rot.y * Math.PI) / 180;
    const dirX    = -Math.sin(baseRad);
    const dirZ    =  Math.cos(baseRad);

    return FAN_ANGLES.map(deg => {
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            x: dirX * cos - dirZ * sin,
            z: dirX * sin + dirZ * cos
        };
    });
}

/* ================= ACTIONBAR ================= */

function updateActionBar(player, cannon) {
    try {
        const ammo      = countAmmo(player);
        const tick      = system.currentTick;
        const readyAt   = cannonCooldowns.get(cannon.id) ?? 0;
        const remaining = readyAt - tick;

        if (remaining > 0) {
            const seconds = (remaining / 20).toFixed(1);
            player.onScreenDisplay.setActionBar(`§e${AMMO_COST}/${ammo} §7| §cCooldown: ${seconds}s`);
        } else if (ammo < AMMO_COST) {
            player.onScreenDisplay.setActionBar(`§c${AMMO_COST}/${ammo} §cMunicion insuficiente`);
        } else {
            player.onScreenDisplay.setActionBar(`§a${AMMO_COST}/${ammo} §7| §eSNEAK AND USE FLINT AND STEEL`);
        }
    } catch (_) {}
}

/* ================= DISPARO ================= */

function fireCannon(player, cannon) {
    const id   = cannon.id;
    const tick = system.currentTick;

    const readyAt = cannonCooldowns.get(id) ?? 0;
    if (tick < readyAt) return;

    const ammo = countAmmo(player);
    if (ammo < AMMO_COST) return;

    consumeAmmo(player);
    cannonCooldowns.set(id, tick + SHOOT_COOLDOWN);

    const muzzle  = getMuzzlePos(cannon);
    const offsets = getFanOffsets(cannon);
    const dim     = cannon.dimension;

    try {
        dim.runCommand(`playsound cannonshoot @a[r=50] ${muzzle.x} ${muzzle.y} ${muzzle.z} 2.0 1.0`);
    } catch (_) {}

    try { cannon.playAnimation("animation.cannon.shoot"); } catch (_) {}

    try {
        for (let i = 0; i < 5; i++) dim.spawnParticle("minecraft:large_explosion", muzzle);
        for (let i = 0; i < 6; i++) dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
        for (let i = 0; i < 3; i++) dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
        dim.spawnParticle("minecraft:huge_explosion_emitter", muzzle);
    } catch (_) {}

    try { player.runCommand("camerashake add @s 1.2 0.5 rotational"); } catch (_) {}

    for (let i = 0; i < BULLET_COUNT; i++) {
        const offset = offsets[i];
        try {
            const bullet = dim.spawnEntity(BULLET_ID, muzzle);
            bullet.applyImpulse({
                x: offset.x * 2.5,
                y: 0.05,
                z: offset.z * 2.5
            });
        } catch (_) {}
    }
}

/* ================= MONTAR ================= */

function startCannonLoops(player, cannon) {
    if (mountedPlayers.has(player.id)) return;

    const cannonPos = { ...cannon.location };

    const loopId = system.runInterval(() => {
        try {
            // Desmontar si se agacha o salta (espacio)
            if (!cannon.isValid || player.isSneaking || player.isJumping) {
                cleanupDismount(player);
                return;
            }
            // Anti-WASD
            const cur = cannon.location;
            if (Math.abs(cur.x - cannonPos.x) > 0.05 ||
                Math.abs(cur.z - cannonPos.z) > 0.05) {
                cannon.teleport(cannonPos, { rotation: cannon.getRotation() });
            }
        } catch (_) {
            cleanupDismount(player);
        }
    }, 1);

    const barLoopId = system.runInterval(() => {
        try {
            updateActionBar(player, cannon);
        } catch (_) {
            system.clearRun(barLoopId);
        }
    }, 5);

    mountedPlayers.set(player.id, { cannon, loopId, barLoopId });
}

function cleanupDismount(player) {
    const data = mountedPlayers.get(player.id);
    if (!data) return;
    system.clearRun(data.loopId);
    system.clearRun(data.barLoopId);
    mountedPlayers.delete(player.id);
    try { player.onScreenDisplay.setActionBar(""); } catch (_) {}
}

/* ================= INTERACCION ================= */

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target, itemStack } = event;
    if (target.typeId !== CANNON_ID) return;

    // Agachado sin flint and steel — recoger cañón
    if (player.isSneaking && (!itemStack || itemStack.typeId !== FLINT_STEEL)) {
        event.cancel = true;
        system.run(() => {
            try {
                const pos = target.location;
                const dim = target.dimension;
                target.remove();
                dim.spawnItem(new ItemStack(SPAWN_EGG, 1), pos);
            } catch (_) {}
        });
        return;
    }

    // Flint and steel DESMONTADO — disparar
    if (itemStack && itemStack.typeId === FLINT_STEEL) {
        if (!mountedPlayers.has(player.id)) {
            event.cancel = true;
            system.run(() => fireCannon(player, target));
        }
        return;
    }

    // Clic normal sin item — montar
    system.runTimeout(() => {
        try {
            startCannonLoops(player, target);
        } catch (e) { console.warn(`[Cannon] error: ${e}`); }
    }, 20);
});

/* ================= LIMPIAR AL MORIR ================= */

world.afterEvents.entityDie.subscribe((event) => {
    const entity = event.deadEntity;
    if (entity.typeId !== CANNON_ID) return;
    cannonCooldowns.delete(entity.id);
});