import { world, system } from "@minecraft/server";

const CANNON_ID        = "udaw:cannon";
const AMMO_ITEM        = "minecraft:iron_nugget";
const AMMO_COST        = 10;
const BULLET_ID        = "udaw:cannonbullet";
const FLINT_STEEL      = "minecraft:flint_and_steel";
const FIRE_CHARGE      = "minecraft:fire_charge";
const ACTIONBAR_RADIUS = 2;

const cannonStates  = new Map();
const interactLock  = new Set(); // evita ejecucion doble por tick

function posKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

function getState(pos) {
    return cannonStates.get(posKey(pos)) ?? "unloaded";
}

function setState(pos, state) {
    cannonStates.set(posKey(pos), state);
}

/* ================= DIRECCION ================= */

function getMuzzleDirection(facing) {
    switch (facing) {
        case "north": return { x: 0, z: -1 };
        case "south": return { x: 0, z: 1 };
        case "east":  return { x: 1, z: 0 };
        case "west":  return { x: -1, z: 0 };
        default:      return { x: 0, z: -1 };
    }
}

function getMuzzlePos(blockPos, facing) {
    const dir = getMuzzleDirection(facing);
    // 0.8 bloques base + 4 pixeles (0.25 bloques) mas adelante
    const dist = 0.8 + 0.25;
    return {
        x: blockPos.x + 0.5 + dir.x * dist,
        y: blockPos.y + 0.7,
        z: blockPos.z + 0.5 + dir.z * dist
    };
}

/* ================= DISPARO ================= */

// Patron abanico horizontal: 10 balas en angulos fijos en el plano XZ
function getFanOffsets(dir) {
    // Angulos en grados desde el centro: -20, -15, -10, -5, 0, 0, 5, 10, 15, 20
    const angles = [-20, -15, -10, -5, 0, 0, 5, 10, 15, 20];
    return angles.map(deg => {
        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        // Rotar el vector de direccion en el plano XZ
        return {
            x: dir.x * cos - dir.z * sin,
            z: dir.x * sin + dir.z * cos
        };
    });
}

function fireCannon(player, blockPos, facing) {
    const dim    = player.dimension;
    const muzzle = getMuzzlePos(blockPos, facing);
    const dir    = getMuzzleDirection(facing);
    const power  = 2.5;
    const offsets = getFanOffsets(dir);

    try {
        dim.runCommand(`playsound cannonshoot @a ${muzzle.x} ${muzzle.y} ${muzzle.z} 2.0 1.0`);
    } catch (_) {}

    try {
        // Explosion base
        for (let i = 0; i < 4; i++) dim.spawnParticle("minecraft:large_explosion", muzzle);
        // Humo denso de fuego artificiale gris
        dim.spawnParticle("minecraft:huge_explosion_emitter", muzzle);
        for (let i = 0; i < 3; i++) dim.spawnParticle("minecraft:campfire_smoke_particle", muzzle);
        // Chispa de fuego artificial
        for (let i = 0; i < 4; i++) dim.spawnParticle("minecraft:fireworks_spark_emitter", muzzle);
        // Llama y destello
        for (let i = 0; i < 3; i++) dim.spawnParticle("minecraft:basic_flame_particle", muzzle);
        dim.spawnParticle("minecraft:evaporation_manual", muzzle);
    } catch (_) {}

    try {
        player.runCommand("camerashake add @s 1.0 0.4 rotational");
    } catch (_) {}

    // Todas las balas en el mismo tick — el abanico ya las separa
    for (let i = 0; i < 10; i++) {
        const offset = offsets[i];
        try {
            const bullet = dim.spawnEntity(BULLET_ID, {
                x: muzzle.x,
                y: muzzle.y,
                z: muzzle.z
            });
            bullet.applyImpulse({
                x: offset.x * power,
                y: 0.05,
                z: offset.z * power
            });
        } catch (_) {}
    }
}

/* ================= CONSUMIR AMMO ================= */

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

/* ================= INTERACCION ================= */

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack } = event;
    if (block.typeId !== CANNON_ID) return;

    const lockKey = `${player.id}_${posKey(block.location)}`;
    if (interactLock.has(lockKey)) return;
    interactLock.add(lockKey);
    system.run(() => interactLock.delete(lockKey));

    event.cancel = true;

    const pos    = block.location;
    const facing = block.permutation.getState("minecraft:cardinal_direction");

    system.run(() => {
        const state = getState(pos);

        // Mechero o fire charge — disparar
        if (itemStack && (itemStack.typeId === FLINT_STEEL || itemStack.typeId === FIRE_CHARGE)) {
            if (state !== "loaded") {
                player.onScreenDisplay.setActionBar("§cCannon — Unloaded");
                return;
            }
            setState(pos, "unloaded");
            fireCannon(player, pos, facing);
            return;
        }

        // Pepitas de hierro — cargar
        if (itemStack && itemStack.typeId === AMMO_ITEM) {
            if (state === "loaded") {
                player.onScreenDisplay.setActionBar("§eCannon — Already loaded");
                return;
            }
            const total = countAmmo(player);
            if (total < AMMO_COST) {
                player.onScreenDisplay.setActionBar(`§cNot enough ammo — ${total}/${AMMO_COST} iron nuggets`);
                return;
            }
            consumeAmmo(player);
            setState(pos, "loaded");
            player.onScreenDisplay.setActionBar("§aCannon — Loaded and ready! §7(use flint & steel to fire)");
            return;
        }

        // Sin item relevante — mostrar estado
        if (state === "loaded") {
            player.onScreenDisplay.setActionBar("§aCannon — Loaded §7(use flint & steel to fire)");
        } else {
            player.onScreenDisplay.setActionBar(`§cCannon — Unloaded §7(give ${AMMO_COST} iron nuggets to load)`);
        }
    });
});

/* ================= ACTIONBAR CERCANO ================= */

system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        try {
            const pPos = player.location;
            const dim  = player.dimension;

            for (let x = -ACTIONBAR_RADIUS; x <= ACTIONBAR_RADIUS; x++) {
                for (let z = -ACTIONBAR_RADIUS; z <= ACTIONBAR_RADIUS; z++) {
                    for (let y = -2; y <= 2; y++) {
                        try {
                            const checkPos = {
                                x: Math.floor(pPos.x) + x,
                                y: Math.floor(pPos.y) + y,
                                z: Math.floor(pPos.z) + z
                            };
                            const b = dim.getBlock(checkPos);
                            if (!b || b.typeId !== CANNON_ID) continue;
                            const state = getState(checkPos);
                            if (state === "loaded") {
                                player.onScreenDisplay.setActionBar("§aCannon — Loaded §7(use flint & steel to fire)");
                            } else {
                                player.onScreenDisplay.setActionBar(`§cCannon — Unloaded §7(give ${AMMO_COST} iron nuggets to load)`);
                            }
                            return;
                        } catch (_) {}
                    }
                }
            }
        } catch (_) {}
    }
}, 20);

/* ================= LIMPIAR AL ROMPER ================= */

world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (event.brokenBlockPermutation.type.id !== CANNON_ID) return;
    cannonStates.delete(posKey(event.block.location));
});