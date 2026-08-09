import { EntityEquippableComponent, EquipmentSlot, system } from "@minecraft/server";
import { VECTOR } from "./mathUtils";

const HEAVY_CHESTPLATES = [
    "udaw:heavy_iron_chestplate",
    "udaw:heavy_diamond_chestplate",
    "udaw:heavy_copper_chestplate"
];

/**
 * Comprueba si la entidad es un jugador que lleva puesta una pechera pesada.
 * @param {Entity} entity - Entidad a comprobar.
 * @returns {boolean} true si lleva una pechera pesada equipada.
 */
export function hasHeavyChestplate(entity) {
    try {
        if (!entity || entity.typeId !== "minecraft:player") return false;
        const equippable = entity.getComponent(EntityEquippableComponent.componentId);
        if (!equippable) return false;
        const item = equippable.getEquipmentSlot(EquipmentSlot.Chest).getItem();
        return !!item && HEAVY_CHESTPLATES.includes(item.typeId);
    } catch (_) {
        return false;
    }
}

/**
 * Dispara múltiples proyectiles al mismo tiempo en un patrón de abanico.
 * @param {Player} player - Jugador que dispara.
 * @param {string} bulletID - ID de la entidad proyectil (ej. "minecraft:arrow").
 * @param {number} bulletCount - Número de proyectiles a disparar.
 * @param {number} spreadAngle - Ángulo de dispersión entre proyectiles.
 */
export function shootCommon(player, bulletID, bulletCount = 1, spreadAngle = 5) {
    let bulletId = bulletID;
    let velocity = player.getVelocity();
    let bulletLocation = player.getHeadLocation();
    bulletLocation = VECTOR.addWithVector(bulletLocation, velocity);

    let baseDirection = player.getViewDirection();

    for (let i = 0; i < bulletCount; i++) {
        let angleOffset = (i - (bulletCount - 1) / 2) * spreadAngle;
        let rotatedDirection = VECTOR.rotateXZ(baseDirection, angleOffset);

        let bullet = player.dimension.spawnEntity(bulletId, bulletLocation);
        setUpShoot(bullet, player, rotatedDirection);
    }
}

/**
 * Dispara proyectiles en secuencia con un intervalo de tiempo entre cada uno.
 * @param {Player} player - Jugador que dispara.
 * @param {string} bulletID - ID de la entidad proyectil (ej. "minecraft:arrow").
 * @param {number} bulletCount - Número de proyectiles a disparar.
 * @param {number} delayBetweenShots - Tiempo en ticks entre disparos (1 tick = 50ms).
 */
export function shootRepeat(player, bulletID, bulletCount = 1, delayBetweenShots = 20) {
    let bulletId = bulletID;
    let velocity = player.getVelocity();
    let bulletLocation = player.getHeadLocation();
    bulletLocation = VECTOR.addWithVector(bulletLocation, velocity);

    let baseDirection = player.getViewDirection();

    function shootArrow(index) {
        if (index >= bulletCount) return;

        let bullet = player.dimension.spawnEntity(bulletId, bulletLocation);
        setUpShoot(bullet, player, baseDirection);

        system.runTimeout(() => shootArrow(index + 1), delayBetweenShots);
    }

    shootArrow(0);
}

/**
 * Configura el proyectil con dirección y dueño.
 * @param {Entity} bullet - La entidad proyectil.
 * @param {Player} player - Jugador que dispara.
 * @param {Vector} direction - Dirección en la que se dispara el proyectil.
 */
export function setUpShoot(bullet, player, direction) {
    let power = 3;
    let projectileCompt = bullet.getComponent("projectile");
    projectileCompt.owner = player;
    direction = VECTOR.multiplyByNum(direction, power);
    projectileCompt.shoot(direction);
}
/**
 * Configura el proyectil con dirección y dueño.
 * @param {Entity} entity - Dueño.
 * @param {targetLocation} targetLocation - Target Location.
 * @param {Strenght} strength - Dirección en la que se dispara el proyectil.
 * @param {forceY} forceY -Fuerza en Y
 */
export function applyImpulseTowardsLocation(entity, targetLocation, strength = 1, forceY = 0.1) {
    try {
        const entityLocation = entity.location;
        const directionToTarget = {
            x: targetLocation.x - entityLocation.x,
            y: targetLocation.y - entityLocation.y,
            z: targetLocation.z - entityLocation.z
        };
        const normalize = (vector) => {
            const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
            return {
                x: vector.x / length,
                y: vector.y / length,
                z: vector.z / length
            };
        };
        const normalized = normalize(directionToTarget);
        const impulse = {
            x: normalized.x * strength,
            y: normalized.y * strength,
            z: normalized.z * strength
        };
        if (entity.typeId === "minecraft:player") {
            entity.applyKnockback(normalized.x, normalized.z, strength, forceY || 0.5);
        } else {
            entity.clearVelocity();
            entity.applyImpulse(impulse);
        }
    } catch (e) {}
}