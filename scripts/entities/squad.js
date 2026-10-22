import { world, system } from "@minecraft/server";

const MUSKETEER = "udaw:musketeer";
const PIKEMAN = "udaw:pikeman";
const SWORDSMAN = "udaw:swordman";
const BULLET_ID = "udaw:musket_ball";
const DIMENSIONS = ["overworld", "nether", "the_end"];
const SQUAD_TYPES = new Set([MUSKETEER, PIKEMAN, SWORDSMAN]);

const SQUAD_PROPERTY = "udaw:squad";
const CAPTAIN_PROPERTY = "udaw:captain";
const MOUNT_PROPERTY = "udaw:mount_enabled";
const MOUNTED_MOVING_PROPERTY = "udaw:mounted_moving";

const MAX_SQUAD = 5;
const SQUAD_RADIUS = 32;
const SQUAD_KEEP_RADIUS = 48;
const ENEMY_RADIUS = 48;
const COMBAT_RADIUS = 32;
const REMOUNT_CALM_TICKS = 60;
const MOUNT_RETRY_TICKS = 100;

const RETREAT_NEAR = 5;
const RETREAT_ENEMIES = 3;
const RETREAT_TICKS = 60;
const RETREAT_COOLDOWN = 160;
const HIT_DISMOUNT_CHANCE = 0.3;
const HIT_MOUNTED_RETREAT_CHANCE = 0.25;
const HIT_REACTION_COOLDOWN = 40;
const DISMOUNT_REMOUNT_BLOCK_TICKS = 240;
const HIT_CAUSES = new Set(["entityAttack", "projectile", "thrown"]);

const MUSKET_MIN = 4;
const MUSKET_MAX = 20;
const AIM_TICKS = 24;
const SHOT_TICKS = 8;
const CYCLE_TICKS = 140;
const BULLET_SPEED = 2.4;
const BULLET_GRAVITY = 0.01;
const BULLET_FORWARD = 0.9;

const BLOCK_CHANCE = 0.7;
const BLOCKABLE = new Set(["entityAttack", "projectile"]);

const musketReady = new Map();
const retreatEnd = new Map();
const lastRetreat = new Map();
const lastCombat = new Map();
const mountBlockedUntil = new Map();
const lastCaptainLocation = new Map();
const hitReactionAt = new Map();

function isAlive(entity) {
    try {
        return entity.isValid;
    } catch (_) {
        return false;
    }
}

function sq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

function averageLocation(list) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const entity of list) {
        const loc = entity.location;
        x += loc.x;
        y += loc.y;
        z += loc.z;
    }
    const n = list.length || 1;
    return { x: x / n, y: y / n, z: z / n };
}

function entityOrder(entity) {
    const numeric = Number(entity.id);
    return Number.isFinite(numeric) ? numeric : Infinity;
}

function sortGuards(list) {
    return list.slice().sort((a, b) => {
        const na = entityOrder(a);
        const nb = entityOrder(b);
        if (na !== nb) return na - nb;
        return String(a.id).localeCompare(String(b.id));
    });
}

function readString(entity, key) {
    try {
        const value = entity.getDynamicProperty(key);
        return typeof value === "string" ? value : "";
    } catch (_) {
        return "";
    }
}

function readBool(entity, key) {
    try {
        return entity.getDynamicProperty(key) === true;
    } catch (_) {
        return false;
    }
}

function writeString(entity, key, value) {
    try {
        if (entity.getDynamicProperty(key) !== value) {
            entity.setDynamicProperty(key, value);
        }
    } catch (_) {}
}

function writeBool(entity, key, value) {
    try {
        if (entity.getDynamicProperty(key) !== value) {
            entity.setDynamicProperty(key, value);
        }
    } catch (_) {}
}

function clearString(entity, key) {
    try {
        if (entity.getDynamicProperty(key) !== undefined) {
            entity.setDynamicProperty(key, undefined);
        }
    } catch (_) {}
}

function getRideable(entity) {
    try {
        return entity.getComponent("minecraft:rideable");
    } catch (_) {
        return undefined;
    }
}

function getMount(entity) {
    try {
        const riding = entity.getComponent("minecraft:riding");
        if (!riding) return undefined;
        return riding.entityRidingOn;
    } catch (_) {
        return undefined;
    }
}

function isRiding(entity) {
    return getMount(entity) !== undefined;
}

function ejectRider(mount, rider) {
    const rideable = getRideable(mount);
    if (!rideable) return;
    try {
        rideable.ejectRider(rider);
    } catch (_) {}
}

function dismountEntity(entity) {
    const mount = getMount(entity);
    if (!mount) return;
    ejectRider(mount, entity);
}

function ejectRiders(entity) {
    const rideable = getRideable(entity);
    if (!rideable) return;
    try {
        rideable.ejectRiders();
    } catch (_) {}
}

function blockMount(entity, until) {
    if (!isAlive(entity)) return;
    try {
        mountBlockedUntil.set(entity.id, until);
    } catch (_) {}
}

function isMountBlocked(entity, now) {
    try {
        const until = mountBlockedUntil.get(entity.id);
        if (until === undefined) return false;
        if (now >= until) {
            mountBlockedUntil.delete(entity.id);
            return false;
        }
        return true;
    } catch (_) {
        return false;
    }
}

function setMountEnabled(entity, enabled) {
    if (!isAlive(entity)) return;
    let allowed = enabled;
    if (readBool(entity, CAPTAIN_PROPERTY)) allowed = false;
    const current = readBool(entity, MOUNT_PROPERTY);
    if (current === allowed) return;
    try {
        entity.triggerEvent(allowed ? "udaw:enable_mount" : "udaw:disable_mount");
    } catch (_) {}
    writeBool(entity, MOUNT_PROPERTY, allowed);
}

function setMountedMoving(entity, moving) {
    try {
        if (entity.getProperty(MOUNTED_MOVING_PROPERTY) !== moving) {
            entity.setProperty(MOUNTED_MOVING_PROPERTY, moving);
        }
    } catch (_) {}
}

function syncMountedAnimations(members, captain) {
    let moving = false;
    try {
        const loc = captain.location;
        const prev = lastCaptainLocation.get(captain.id);
        if (prev) {
            const dx = loc.x - prev.x;
            const dz = loc.z - prev.z;
            moving = dx * dx + dz * dz > 0.04;
        }
        lastCaptainLocation.set(captain.id, { x: loc.x, y: loc.y, z: loc.z });
    } catch (_) {
        return;
    }
    for (const member of members) {
        if (member.id === captain.id) continue;
        const mount = getMount(member);
        setMountedMoving(member, mount !== undefined && mount.id === captain.id ? moving : false);
    }
}

function promoteCaptain(entity) {
    if (!isAlive(entity)) return;
    dismountEntity(entity);
    writeString(entity, SQUAD_PROPERTY, String(entity.id));
    if (readBool(entity, CAPTAIN_PROPERTY)) {
        setMountEnabled(entity, false);
        return;
    }
    try {
        entity.triggerEvent("udaw:promote_captain");
    } catch (_) {}
    writeBool(entity, CAPTAIN_PROPERTY, true);
    writeBool(entity, MOUNT_PROPERTY, false);
}

function demoteCaptain(entity) {
    if (!isAlive(entity)) return;
    if (!readBool(entity, CAPTAIN_PROPERTY)) return;
    ejectRiders(entity);
    try {
        entity.triggerEvent("udaw:demote_captain");
    } catch (_) {}
    writeBool(entity, CAPTAIN_PROPERTY, false);
    writeBool(entity, MOUNT_PROPERTY, true);
}

function pickCaptain(members) {
    const existing = members.find((member) => readBool(member, CAPTAIN_PROPERTY));
    if (existing) return existing;
    return sortGuards(members)[0];
}

function getEnemies(dim, center) {
    try {
        return dim.getEntities({
            location: center,
            maxDistance: ENEMY_RADIUS,
            families: ["monster"]
        }).filter(isAlive);
    } catch (_) {
        return [];
    }
}

function hasThreat(enemies, members, radius) {
    const radius2 = radius * radius;
    for (const enemy of enemies) {
        for (const member of members) {
            if (sq(enemy.location, member.location) <= radius2) return true;
        }
    }
    return false;
}

function canRetreat(members, now) {
    for (const member of members) {
        const last = lastRetreat.get(member.id);
        if (last !== undefined && now - last < RETREAT_COOLDOWN) return false;
    }
    return true;
}

function markRetreat(member, end) {
    retreatEnd.set(member.id, end);
    try {
        member.setDynamicProperty("udaw:retreat_until", end);
    } catch (_) {}
}

function clearRetreatMark(member) {
    try {
        member.setDynamicProperty("udaw:retreat_until", undefined);
    } catch (_) {}
}

function normalizeRetreatState(member) {
    if (retreatEnd.has(member.id)) return;
    try {
        const stored = member.getDynamicProperty("udaw:retreat_until");
        if (stored === undefined || stored === null) return;
        try {
            member.triggerEvent("udaw:regroup");
        } catch (_) {}
        clearRetreatMark(member);
    } catch (_) {}
}

function startRetreat(members, enemy, now, dismount) {
    const end = now + RETREAT_TICKS;
    const ex = enemy ? enemy.location.x : 0;
    const ez = enemy ? enemy.location.z : 0;
    for (const member of members) {
        markRetreat(member, end);
        lastRetreat.set(member.id, now);
        musketReady.delete(member.id);
        if (dismount) {
            dismountEntity(member);
            setMountEnabled(member, false);
            blockMount(member, now + DISMOUNT_REMOUNT_BLOCK_TICKS);
        }
        try {
            member.triggerEvent("udaw:retreat");
        } catch (_) {}
        if (!enemy) continue;
        const dx = member.location.x - ex;
        const dz = member.location.z - ez;
        try {
            member.lookAt({
                x: member.location.x + dx,
                y: member.location.y + 1.2,
                z: member.location.z + dz
            });
        } catch (_) {}
    }
    if (dismount) {
        for (const member of members) ejectRiders(member);
    }
}

function updateRetreats(members, enemies, now) {
    let groupEnd = 0;
    for (const member of members) {
        normalizeRetreatState(member);
        const end = retreatEnd.get(member.id);
        if (end === undefined) continue;
        if (now >= end) {
            retreatEnd.delete(member.id);
            try {
                member.triggerEvent("udaw:regroup");
            } catch (_) {}
            clearRetreatMark(member);
        } else if (end > groupEnd) {
            groupEnd = end;
        }
    }

    if (groupEnd > now) {
        for (const member of members) {
            if (retreatEnd.has(member.id)) continue;
            markRetreat(member, groupEnd);
            lastRetreat.set(member.id, now);
            musketReady.delete(member.id);
            try {
                member.triggerEvent("udaw:retreat");
            } catch (_) {}
        }
        return;
    }

    for (const member of members) {
        if (member.typeId !== PIKEMAN) continue;
        let count = 0;
        let nearest = null;
        let nearestD2 = Infinity;
        for (const enemy of enemies) {
            const d2 = sq(enemy.location, member.location);
            if (d2 <= RETREAT_NEAR * RETREAT_NEAR) count++;
            if (d2 < nearestD2) {
                nearestD2 = d2;
                nearest = enemy;
            }
        }
        if (count < RETREAT_ENEMIES) continue;
        if (!canRetreat(members, now)) return;
        startRetreat(members, nearest, now, false);
        return;
    }
}

function getSquadRiders(captain) {
    const rideable = getRideable(captain);
    if (!rideable) return [];
    let riders;
    try {
        riders = rideable.getRiders();
    } catch (_) {
        return [];
    }
    return riders.filter((rider) => isAlive(rider)
        && rider.id !== captain.id
        && SQUAD_TYPES.has(rider.typeId)
        && !readBool(rider, CAPTAIN_PROPERTY));
}

function hitSourceIsFriendly(source) {
    const attacker = source.damagingEntity;
    const projectile = source.damagingProjectile;
    if (projectile && projectile.typeId === BULLET_ID) return true;
    if (attacker && (attacker.typeId === BULLET_ID || SQUAD_TYPES.has(attacker.typeId))) return true;
    return false;
}

function reactToHit(hurtEntity, source, now) {
    if (!isAlive(hurtEntity) || !SQUAD_TYPES.has(hurtEntity.typeId)) return;
    if (!HIT_CAUSES.has(source.cause) || hitSourceIsFriendly(source)) return;
    if (!isRiding(hurtEntity)) return;

    const captain = getMount(hurtEntity);
    if (!captain || !readBool(captain, CAPTAIN_PROPERTY)) return;
    if (retreatEnd.has(captain.id)) return;

    const last = hitReactionAt.get(captain.id);
    if (last !== undefined && now - last < HIT_REACTION_COOLDOWN) return;
    hitReactionAt.set(captain.id, now);

    const riders = getSquadRiders(captain);
    if (riders.length === 0) return;
    const members = [captain].concat(riders);
    if (!canRetreat(members, now)) return;

    const attacker = source.damagingEntity;
    const enemy = attacker && isAlive(attacker) ? attacker : undefined;
    const roll = Math.random();
    if (roll < HIT_DISMOUNT_CHANCE) {
        startRetreat(members, enemy, now, true);
    } else if (roll < HIT_DISMOUNT_CHANCE + HIT_MOUNTED_RETREAT_CHANCE) {
        startRetreat(members, enemy, now, false);
    }
}

function enforceLine(members, enemies) {
    const melee = members.filter((member) => member.typeId === PIKEMAN || member.typeId === SWORDSMAN);
    const muskets = members.filter((member) => member.typeId === MUSKETEER);
    if (melee.length === 0 || muskets.length === 0) return;

    for (const musket of muskets) {
        if (isRiding(musket)) continue;
        let enemy = null;
        let enemyD2 = Infinity;
        for (const candidate of enemies) {
            const d2 = sq(musket.location, candidate.location);
            if (d2 < enemyD2) {
                enemyD2 = d2;
                enemy = candidate;
            }
        }
        if (!enemy) continue;

        let meleeD2 = Infinity;
        for (const unit of melee) {
            const d2 = sq(unit.location, enemy.location);
            if (d2 < meleeD2) meleeD2 = d2;
        }
        if (!Number.isFinite(meleeD2)) continue;

        const musketDist = Math.sqrt(enemyD2);
        const meleeDist = Math.sqrt(meleeD2);
        if (musketDist < meleeDist - 1.0 && musketDist < 10) {
            const dx = musket.location.x - enemy.location.x;
            const dz = musket.location.z - enemy.location.z;
            const d = Math.hypot(dx, dz) || 1;
            try {
                musket.applyImpulse({ x: (dx / d) * 0.35, y: 0.05, z: (dz / d) * 0.35 });
            } catch (_) {}
        }
    }
}

function getEye(entity) {
    try {
        return entity.getHeadLocation();
    } catch (_) {
        const loc = entity.location;
        return { x: loc.x, y: loc.y + 1.6, z: loc.z };
    }
}

function hasLineOfSight(member, target) {
    try {
        const eye = getEye(member);
        const loc = target.location;
        const tx = loc.x;
        const ty = loc.y + 1.1;
        const tz = loc.z;
        const dx = tx - eye.x;
        const dy = ty - eye.y;
        const dz = tz - eye.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.1) return false;
        member.lookAt({ x: tx, y: ty, z: tz });
        const hit = member.getBlockFromViewDirection({
            maxDistance: dist,
            includeLiquidBlocks: false,
            includePassableBlocks: false
        });
        return !hit;
    } catch (_) {
        return true;
    }
}

function pickTarget(member, enemies) {
    let best = null;
    let bestD2 = Infinity;
    const min2 = MUSKET_MIN * MUSKET_MIN;
    const max2 = MUSKET_MAX * MUSKET_MAX;
    for (const enemy of enemies) {
        const d2 = sq(member.location, enemy.location);
        if (d2 < min2 || d2 > max2) continue;
        if (d2 < bestD2) {
            bestD2 = d2;
            best = enemy;
        }
    }
    return best;
}

function nearestEnemy(member) {
    try {
        const list = member.dimension.getEntities({
            location: member.location,
            maxDistance: MUSKET_MAX,
            families: ["monster"]
        });
        let best = null;
        let bestD2 = MUSKET_MAX * MUSKET_MAX;
        for (const enemy of list) {
            if (!isAlive(enemy)) continue;
            const d2 = sq(member.location, enemy.location);
            if (d2 < bestD2) {
                bestD2 = d2;
                best = enemy;
            }
        }
        return best;
    } catch (_) {
        return null;
    }
}

function shootProjectile(member, target) {
    try {
        const eye = getEye(member);
        const loc = target.location;
        const tx = loc.x;
        const ty = loc.y + 1.1;
        const tz = loc.z;
        const dx = tx - eye.x;
        const dy = ty - eye.y;
        const dz = tz - eye.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.1 || dist > MUSKET_MAX + 4) return;
        try {
            member.lookAt({ x: tx, y: ty, z: tz });
        } catch (_) {}
        const inv = 1 / dist;
        const dirX = dx * inv;
        const dirY = dy * inv;
        const dirZ = dz * inv;
        const origin = {
            x: eye.x + dirX * BULLET_FORWARD,
            y: eye.y + dirY * BULLET_FORWARD,
            z: eye.z + dirZ * BULLET_FORWARD
        };
        const time = dist / BULLET_SPEED;
        const vy = dirY * BULLET_SPEED + 0.5 * BULLET_GRAVITY * time;
        const dim = member.dimension;
        const ball = dim.spawnEntity(BULLET_ID, origin);
        ball.applyImpulse({ x: dirX * BULLET_SPEED, y: vy, z: dirZ * BULLET_SPEED });
        dim.spawnParticle("minecraft:campfire_smoke_particle", origin);
        dim.playSound("flintlockshoot", origin, { volume: 1.0, pitch: 1.0 });
    } catch (_) {}
}

function fireMusket(member, target) {
    if (!isAlive(member) || retreatEnd.has(member.id)) return;
    try {
        member.playAnimation("animation.musketeer.shot");
    } catch (_) {}
    let current = null;
    try {
        if (target && target.isValid) current = target;
    } catch (_) {}
    if (!current) current = nearestEnemy(member);
    if (current) shootProjectile(member, current);
    try {
        system.runTimeout(() => {
            if (!isAlive(member) || retreatEnd.has(member.id)) return;
            try {
                member.playAnimation("animation.musketeer.reload");
            } catch (_) {}
        }, SHOT_TICKS);
    } catch (_) {}
}

function updateMuskets(members, enemies, now) {
    for (const member of members) {
        if (member.typeId !== MUSKETEER) continue;
        const ready = musketReady.get(member.id);
        if (ready !== undefined && now < ready) continue;
        const target = pickTarget(member, enemies);
        if (!target) continue;
        if (!hasLineOfSight(member, target)) continue;
        musketReady.set(member.id, now + CYCLE_TICKS);
        try {
            member.lookAt({ x: target.location.x, y: target.location.y + 1.1, z: target.location.z });
        } catch (_) {}
        try {
            member.playAnimation("animation.musketeer.aim");
        } catch (_) {}
        try {
            system.runTimeout(() => fireMusket(member, target), AIM_TICKS);
        } catch (_) {
            musketReady.delete(member.id);
        }
    }
}

function sanitizeRiders(guards, now) {
    for (const guard of guards) {
        const mount = getMount(guard);
        if (!mount) continue;
        let valid = false;
        try {
            valid = isAlive(mount)
                && mount.typeId === guard.typeId
                && readBool(mount, CAPTAIN_PROPERTY)
                && !readBool(guard, CAPTAIN_PROPERTY)
                && readString(guard, SQUAD_PROPERTY) === String(mount.id)
                && readString(mount, SQUAD_PROPERTY) === String(mount.id);
        } catch (_) {
            valid = false;
        }
        if (valid) continue;
        ejectRider(mount, guard);
        blockMount(guard, now + MOUNT_RETRY_TICKS);
        setMountEnabled(guard, false);
    }
}

function buildSquads(guards) {
    const byType = new Map();
    for (const guard of guards) {
        if (!isAlive(guard)) continue;
        const typeId = guard.typeId;
        let list = byType.get(typeId);
        if (!list) {
            list = [];
            byType.set(typeId, list);
        }
        list.push(guard);
    }

    const squads = [];
    for (const [typeId, list] of byType) {
        const used = new Set();
        const captains = sortGuards(list.filter((guard) => readBool(guard, CAPTAIN_PROPERTY)));
        for (const captain of captains) {
            if (used.has(captain.id)) continue;
            const members = [captain];
            used.add(captain.id);
            const squadId = String(captain.id);
            const candidates = [];
            for (const other of list) {
                if (used.has(other.id)) continue;
                if (readString(other, SQUAD_PROPERTY) !== squadId) continue;
                const d2 = sq(captain.location, other.location);
                if (d2 <= SQUAD_KEEP_RADIUS * SQUAD_KEEP_RADIUS) {
                    candidates.push({ member: other, d2: d2 });
                }
            }
            candidates.sort((a, b) => a.d2 - b.d2);
            for (const candidate of candidates) {
                if (members.length >= MAX_SQUAD) break;
                members.push(candidate.member);
                used.add(candidate.member.id);
            }
            squads.push({ typeId: typeId, captain: captain, members: members });
        }

        for (const guard of list) {
            if (used.has(guard.id)) continue;
            let best = null;
            let bestD2 = SQUAD_RADIUS * SQUAD_RADIUS;
            for (const squad of squads) {
                if (squad.typeId !== typeId) continue;
                if (squad.members.length >= MAX_SQUAD) continue;
                const d2 = sq(guard.location, squad.captain.location);
                if (d2 <= bestD2) {
                    bestD2 = d2;
                    best = squad;
                }
            }
            if (!best) continue;
            best.members.push(guard);
            used.add(guard.id);
        }

        const remaining = sortGuards(list.filter((guard) => !used.has(guard.id)));
        for (const seed of remaining) {
            if (used.has(seed.id)) continue;
            const members = [seed];
            used.add(seed.id);
            const candidates = [];
            for (const other of remaining) {
                if (used.has(other.id)) continue;
                const d2 = sq(seed.location, other.location);
                if (d2 <= SQUAD_RADIUS * SQUAD_RADIUS) {
                    candidates.push({ member: other, d2: d2 });
                }
            }
            candidates.sort((a, b) => a.d2 - b.d2);
            for (const candidate of candidates) {
                if (members.length >= MAX_SQUAD) break;
                members.push(candidate.member);
                used.add(candidate.member.id);
            }
            squads.push({ typeId: typeId, captain: pickCaptain(members), members: members });
        }
    }
    return squads;
}

function assignGroup(group, now) {
    const captain = group.captain;
    if (!isAlive(captain)) return false;
    promoteCaptain(captain);
    writeString(captain, SQUAD_PROPERTY, String(captain.id));
    for (const member of group.members) {
        if (!isAlive(member) || member.id === captain.id) continue;
        if (readBool(member, CAPTAIN_PROPERTY)) demoteCaptain(member);
        writeString(member, SQUAD_PROPERTY, String(captain.id));
        const mount = getMount(member);
        if (mount && mount.id !== captain.id) {
            ejectRider(mount, member);
            blockMount(member, now + MOUNT_RETRY_TICKS);
            setMountEnabled(member, false);
        }
    }
    return true;
}

function validateRiders(captain, now) {
    const rideable = getRideable(captain);
    if (!rideable) return;
    let riders;
    try {
        riders = rideable.getRiders();
    } catch (_) {
        return;
    }
    if (!riders || riders.length === 0) return;
    const captainSquad = readString(captain, SQUAD_PROPERTY);
    for (const rider of riders) {
        if (!isAlive(rider)) continue;
        const valid = rider.typeId === captain.typeId
            && !readBool(rider, CAPTAIN_PROPERTY)
            && readString(rider, SQUAD_PROPERTY) === captainSquad;
        if (valid) continue;
        try {
            rideable.ejectRider(rider);
        } catch (_) {}
        blockMount(rider, now + MOUNT_RETRY_TICKS);
        setMountEnabled(rider, false);
    }
}

function processSquad(dim, group, now) {
    const captain = group.captain;
    if (!isAlive(captain)) return;
    const members = group.members.filter(isAlive);
    if (members.length === 0) return;
    if (!members.some((member) => member.id === captain.id)) members.unshift(captain);
    if (!assignGroup(group, now)) return;

    syncMountedAnimations(members, captain);

    const center = averageLocation(members);
    const enemies = getEnemies(dim, center);
    const threat = hasThreat(enemies, members, COMBAT_RADIUS);

    updateRetreats(members, enemies, now);
    const retreating = members.some((member) => retreatEnd.has(member.id));

    if (threat || retreating) {
        lastCombat.set(captain.id, now);
    } else {
        const last = lastCombat.get(captain.id);
        if (last === undefined || now - last >= REMOUNT_CALM_TICKS) {
            for (const member of members) {
                if (member.id === captain.id) continue;
                if (isMountBlocked(member, now)) {
                    setMountEnabled(member, false);
                    dismountEntity(member);
                } else {
                    setMountEnabled(member, true);
                }
            }
            validateRiders(captain, now);
        }
    }

    const active = members.filter((member) => !retreatEnd.has(member.id));
    if (active.length === 0) return;
    if (threat && !retreating) enforceLine(active, enemies);
    if (!retreating) updateMuskets(active, enemies, now);
}

function resetLoadedGuards() {
    musketReady.clear();
    retreatEnd.clear();
    lastRetreat.clear();
    lastCombat.clear();
    mountBlockedUntil.clear();

    for (const dimId of DIMENSIONS) {
        let dim;
        try {
            dim = world.getDimension(dimId);
        } catch (_) {
            continue;
        }
        let guards;
        try {
            guards = dim.getEntities({ families: ["udaw_squad"] });
        } catch (_) {
            continue;
        }
        for (const guard of guards) {
            if (!isAlive(guard)) continue;
            try {
                ejectRiders(guard);
                dismountEntity(guard);
                try {
                    guard.triggerEvent("udaw:demote_captain");
                } catch (_) {}
                try {
                    guard.triggerEvent("udaw:disable_mount");
                } catch (_) {}
                writeBool(guard, CAPTAIN_PROPERTY, false);
                writeBool(guard, MOUNT_PROPERTY, false);
                clearString(guard, SQUAD_PROPERTY);
                try {
                    guard.triggerEvent("udaw:regroup");
                } catch (_) {}
                clearRetreatMark(guard);
            } catch (_) {}
        }
    }
}

function updateSquads() {
    try {
        const now = system.currentTick;
        for (const dimId of DIMENSIONS) {
            let dim;
            try {
                dim = world.getDimension(dimId);
            } catch (_) {
                continue;
            }
            let guards;
            try {
                guards = dim.getEntities({ families: ["udaw_squad"] });
            } catch (_) {
                continue;
            }
            if (!guards || guards.length === 0) continue;
            sanitizeRiders(guards, now);
            for (const group of buildSquads(guards)) {
                try {
                    processSquad(dim, group, now);
                } catch (_) {}
            }
        }
    } catch (_) {}
}

world.afterEvents.entityDie.subscribe((event) => {
    const id = event.deadEntity.id;
    musketReady.delete(id);
    retreatEnd.delete(id);
    lastRetreat.delete(id);
    lastCombat.delete(id);
    mountBlockedUntil.delete(id);
});

world.beforeEvents.entityHurt.subscribe((event) => {
    if (event.hurtEntity.typeId !== SWORDSMAN) return;
    if (!BLOCKABLE.has(event.damageSource.cause)) return;
    const source = event.damageSource.damagingEntity;
    if (source && source.typeId === BULLET_ID) return;
    if (Math.random() >= BLOCK_CHANCE) return;
    event.cancel = true;
    const entity = event.hurtEntity;
    try {
        system.runTimeout(() => {
            if (!isAlive(entity)) return;
            try {
                entity.playAnimation("animation.swordman.block");
            } catch (_) {}
        }, 1);
    } catch (_) {}
});

system.runTimeout(resetLoadedGuards, 1);
system.runInterval(updateSquads, 20);
