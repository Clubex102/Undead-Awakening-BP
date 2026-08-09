import { world, system } from "@minecraft/server";
import { VECTOR } from "../globalVar/mathUtils";

const CANNON_ID = "udaw:pillager_cannon";
const BULLET_ID = "udaw:pillagercannonbullet";
const CANNON_TURRET_ID = "udaw:cannon";
const CREW_ID = "udaw:pillager_crew";

const SPLIT_TAG = "udaw_split_cannon";
const CREW_TAG = "udaw_crew";
const CREW_OFFSET = 2.2;

const FAN_SHOTS = 10;
const FAN_SPREAD = 5;
const MUZZLE_FORWARD = 2.0;
const MUZZLE_HEIGHT = 1.5;
const TARGET_CENTER_Y = 1.0;
const SHOT_SPEED = 3;

const ANIM_ALL = "animation.pillager_cannon.all";

const handled = new Set();
const splitCannons = new Map();
const crews = new Map();

function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalize(vector) {
    const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
    if (length === 0) return { x: 0, y: 0, z: 1 };
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function fireVolley(cannon) {
    const dim = cannon.dimension;
    const pos = cannon.location;

    let target = null;
    try { target = cannon.getTarget(); } catch (_) {}

    let forward;
        if (target && target.isValid) {
        forward = normalize({ x: target.location.x - pos.x, y: 0, z: target.location.z - pos.z });
    } else {
        const rad = (cannon.getRotation().y * Math.PI) / 180;
        forward = { x: -Math.sin(rad), y: 0, z: Math.cos(rad) };
    }

    const muzzle = {
        x: pos.x + forward.x * MUZZLE_FORWARD,
        y: pos.y + MUZZLE_HEIGHT,
        z: pos.z + forward.z * MUZZLE_FORWARD
    };

    let aimDir;
        if (target && target.isValid) {
        aimDir = normalize({
            x: target.location.x - muzzle.x,
            y: (target.location.y + TARGET_CENTER_Y) - muzzle.y,
            z: target.location.z - muzzle.z
        });
    } else {
        aimDir = { x: forward.x, y: 0, z: forward.z };
    }

    const centerIndex = Math.floor(FAN_SHOTS / 2);
    for (let i = 0; i < FAN_SHOTS; i++) {
        const angleOffset = (i - centerIndex) * FAN_SPREAD;
        const rotated = VECTOR.rotateXZ(aimDir, angleOffset);
        const bullet = dim.spawnEntity(BULLET_ID, muzzle);
        const projectile = bullet.getComponent("minecraft:projectile");
        if (projectile) {
            projectile.shoot({ x: rotated.x * SHOT_SPEED, y: rotated.y * SHOT_SPEED, z: rotated.z * SHOT_SPEED });
        }
    }

    cannon.playAnimation(ANIM_ALL);

    dim.playSound("cannonshoot", muzzle, { volume: 2.0 });
    dim.spawnParticle("minecraft:large_explosion", muzzle);
    dim.spawnParticle("udaw:gun_smoke", muzzle);
    dim.spawnParticle("udaw:gun_smoke", muzzle);
}

world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== BULLET_ID) return;
    if (handled.has(event.entity.id)) return;
    handled.add(event.entity.id);
    if (handled.size > 2000) handled.clear();

    system.run(() => {
        try {
            const projectile = event.entity.getComponent("minecraft:projectile");
            if (!projectile) return;
            const owner = projectile.owner;
            if (!owner || owner.typeId !== CANNON_ID) return;
            try { event.entity.remove(); } catch (_) {}
            fireVolley(owner);
        } catch (_) {}
    });
});

/* ================= DIVISIÓN AL RECIBIR GOLPE MELEE ================= */

function splitCannon(cannon) {
    if (!cannon.isValid || cannon.hasTag(SPLIT_TAG)) return;
    cannon.addTag(SPLIT_TAG);

    const dim = cannon.dimension;
    const pos = cannon.location;
    const yaw = cannon.getRotation().y;
    const rad = (yaw * Math.PI) / 180;
    const forward = { x: -Math.sin(rad), y: 0, z: Math.cos(rad) };
    const left = VECTOR.rotateXZ(forward, -90);
    const right = VECTOR.rotateXZ(forward, 90);
    const leftPos = { x: pos.x + left.x * CREW_OFFSET, y: pos.y, z: pos.z + left.z * CREW_OFFSET };
    const rightPos = { x: pos.x + right.x * CREW_OFFSET, y: pos.y, z: pos.z + right.z * CREW_OFFSET };

    const turret = dim.spawnEntity(CANNON_TURRET_ID, pos);
    turret.addTag(SPLIT_TAG);
    turret.setRotation({ x: 0, y: yaw });
    splitCannons.set(turret.id, { entity: turret });

    const crewLeft = dim.spawnEntity(CREW_ID, leftPos);
    crewLeft.addTag(CREW_TAG);
    crewLeft.setRotation({ x: 0, y: yaw });
    crews.set(crewLeft.id, { entity: crewLeft, cannonId: turret.id });

    const crewRight = dim.spawnEntity(CREW_ID, rightPos);
    crewRight.addTag(CREW_TAG);
    crewRight.setRotation({ x: 0, y: yaw });
    crews.set(crewRight.id, { entity: crewRight, cannonId: turret.id });

    cannon.remove();
}

world.afterEvents.entityHurt.subscribe((event) => {
    const entity = event.hurtEntity;
    if (!entity || entity.typeId !== CANNON_ID) return;
    if (!entity.isValid) return;
    const source = event.damageSource;
    if (!source) return;
    const cause = source.cause;
    if (cause !== "entityAttack" && cause !== "entitySweepAttack") return;
    if (!source.damagingEntity) return;
    if (dist(entity.location, source.damagingEntity.location) > 4) return;
    try {
        splitCannon(entity);
    } catch (e) {
        console.warn("udaw pillager_cannon split error: " + e);
    }
});

world.afterEvents.entityDie.subscribe((event) => {
    const deadId = event.deadEntity.id;

    if (crews.has(deadId)) {
        handleCrewDeath(deadId);
        return;
    }

    if (splitCannons.has(deadId)) {
        splitCannons.delete(deadId);
        for (const [crId, crewRec] of [...crews]) {
            if (crewRec.cannonId === deadId) crews.delete(crId);
        }
    }
});

/* ================= LIMPIEZA (MUERTE DE CREWS) ================= */

function handleCrewDeath(deadId) {
    const rec = crews.get(deadId);
    crews.delete(deadId);
    if (!rec) return;
    const cannonId = rec.cannonId;
    let remaining = 0;
    for (const crewRec of crews.values()) {
        if (crewRec.cannonId === cannonId) remaining++;
    }
    if (remaining === 0) {
        const turretRec = splitCannons.get(cannonId);
        if (turretRec && turretRec.entity) {
            try { turretRec.entity.remove(); } catch (_) {}
        }
        splitCannons.delete(cannonId);
    }
}
