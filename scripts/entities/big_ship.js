import { world, system, Player } from "@minecraft/server";

// ───────────────────────── Configuración ─────────────────────────
const SHIP_ID = "udaw:big_ship";
const DECK_ID = "udaw:ship_deck";
const BULLET_ID = "udaw:cannonbullet";
const FLINT_ITEM = "minecraft:flint_and_steel";
const DIMENSIONS = ["overworld", "nether", "the_end"];

// Movimiento (drive corre cada 2 ticks)
const MAX_SPEED = 0.34;
const MAX_REVERSE = 0.14;
const ACCEL = 0.02;          // aumento de velocidad por paso al acelerar
const COAST_DRAG = 0.96;     // factor por paso cuando sueltas el acelerador
const LATERAL_GRIP = 0.4;    // qué tan rápido se corrige el derrape (0 = patina, 1 = sobre rieles)
const TURN_REST = 0.9;       // grados por paso con el barco casi parado
const TURN_FULL = 0.32;      // grados por paso a velocidad máxima
const TURN_SMOOTH = 0.25;    // suavizado del giro (0.1 = muy pesado, 1 = instantáneo)
const MOVE_EPS = 0.03;

// Cubierta
const PAD_SPOTS = [
    { key: "bow", y: 4.0, z: 6.5 },
    { key: "stern", y: 4.7, z: -7.0 }
];
const PAD_HALF = 2.4;

// Cañones
const CANNON_OFFSETS = [4, 0, -4];   // posición de cada cañón a lo largo del barco (proa → popa)
const SIDE_OFFSET = 3.8;
const DECK_Y = 2.4;
const SALVO_GAP = 4;                 // ticks entre cañón y cañón (andanada en ola)
const ANIM_DELAY = 4;                // ticks entre la animación y el primer disparo
const RELOAD = 240;                  // recarga por costado, en ticks
const BULLET_SPEED = 2.5;
const BULLET_GRAVITY = 0.05;         // gravedad de tu bala (blocks/tick²). Pon 0 si no cae
const ARC_YAW = (40 * Math.PI) / 180;      // cuánto puede girar cada cañón hacia proa o popa
const PITCH_MIN = (-12 * Math.PI) / 180;
const PITCH_MAX = (45 * Math.PI) / 180;
const AIM_RANGE = 120;
const RECOIL = 0.02;
const SIDE_ANIM = { 1: "animation.ship.shoot_lf", "-1": "animation.ship.shoot_rh" }; // +1 = costado izquierdo; cámbialos si salen invertidos
const SIDE_NAME = { 1: "babor", "-1": "estribor" };

// ───────────────────────── Estado ─────────────────────────
// id del barco -> { ship, turn, moving, pads, last, reload, invalid }
const ships = new Map();
const orphans = new Map();

// ───────────────────────── Utilidades ─────────────────────────
function isAlive(entity) {
    try {
        return !!entity && entity.isValid;
    } catch (_) {
        return false;
    }
}

const wrapDegrees = (deg) => ((deg % 360) + 360) % 360;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function yawOf(ship) {
    try {
        const r = ship.getRotation();
        return Number.isFinite(r.y) ? r.y : 0;
    } catch (_) {
        return 0;
    }
}

function forwardOf(ship) {
    const rad = (yawOf(ship) * Math.PI) / 180;
    return { x: -Math.sin(rad), z: Math.cos(rad) };
}

function pilotOf(ship) {
    try {
        const rideable = ship.getComponent("minecraft:rideable");
        if (!rideable) return undefined;
        const riders = rideable.getRiders();
        if (!riders) return undefined;
        const pilot = riders[rideable.controllingSeat ?? 0];
        return pilot instanceof Player ? pilot : undefined;
    } catch (_) {
        return undefined;
    }
}

function readInput(player) {
    try {
        const move = player.inputInfo?.getMovementVector?.();
        if (!move) return { throttle: 0, steer: 0 };
        return {
            throttle: move.y > 0.15 ? 1 : move.y < -0.15 ? -1 : 0,
            steer: move.x > 0.15 ? 1 : move.x < -0.15 ? -1 : 0
        };
    } catch (_) {
        return { throttle: 0, steer: 0 };
    }
}

function register(ship) {
    let s = ships.get(ship.id);
    if (!s) {
        s = { ship, turn: 0, moving: undefined, pads: {}, last: {}, reload: {}, invalid: 0 };
        ships.set(ship.id, s);
    } else if (!isAlive(s.ship)) {
        s.ship = ship;
        s.pads = {};
        s.last = {};
    }
    return s;
}

// ───────────────────────── Conducción ─────────────────────────
// La velocidad hacia adelante se acerca a la deseada y la lateral se corrige con "agarre",
// así el barco gira de verdad en vez de patinar.
function drive(s) {
    const ship = s.ship;
    let moving = false;

    try {
        const pilot = pilotOf(ship);
        const input = pilot ? readInput(pilot) : { throttle: 0, steer: 0 };
        const vel = ship.getVelocity();
        const speed = Math.hypot(vel.x, vel.z);

        const ratio = Math.min(1, speed / MAX_SPEED);
        const targetTurn = input.steer * (TURN_REST + (TURN_FULL - TURN_REST) * ratio);
        s.turn += (targetTurn - s.turn) * TURN_SMOOTH;
        if (Math.abs(s.turn) > 0.01) {
            ship.setRotation({ x: 0, y: wrapDegrees(yawOf(ship) - s.turn) });
        } else {
            s.turn = 0;
        }

        const f = forwardOf(ship);
        const fwd = vel.x * f.x + vel.z * f.z;
        const latX = vel.x - fwd * f.x;
        const latZ = vel.z - fwd * f.z;

        let targetFwd;
        if (input.throttle > 0) targetFwd = Math.min(MAX_SPEED, fwd + ACCEL);
        else if (input.throttle < 0) targetFwd = Math.max(-MAX_REVERSE, fwd - ACCEL);
        else targetFwd = fwd * COAST_DRAG;

        const dv = targetFwd - fwd;
        ship.applyImpulse({
            x: dv * f.x - latX * LATERAL_GRIP,
            y: 0,
            z: dv * f.z - latZ * LATERAL_GRIP
        });

        moving = speed > MOVE_EPS;
    } catch (_) {
        moving = false;
    }

    if (s.moving !== moving) {
        s.moving = moving;
        try { ship.setProperty("udaw:moving", moving); } catch (_) {}
    }
}

// ───────────────────────── Cubierta ─────────────────────────
function padLocation(ship, spot) {
    const rad = (yawOf(ship) * Math.PI) / 180;
    const l = ship.location;
    return {
        x: l.x - spot.z * Math.sin(rad),
        y: l.y + spot.y,
        z: l.z + spot.z * Math.cos(rad)
    };
}

// Cada plataforma lleva una etiqueta con el id del barco: tras recargar el mundo se reutiliza
// la que ya existe en vez de crear otra.
function getPad(s, spot, position) {
    let pad = s.pads[spot.key];
    if (isAlive(pad)) return pad;
    pad = undefined;
    const tag = `pad:${s.ship.id}:${spot.key}`;

    try {
        const found = s.ship.dimension.getEntities({ type: DECK_ID, tags: [tag], location: s.ship.location, maxDistance: 24 });
        for (const e of found) {
            if (!pad) pad = e;
            else { try { e.remove(); } catch (_) {} }
        }
    } catch (_) {}

    if (!pad) {
        try {
            pad = s.ship.dimension.spawnEntity(DECK_ID, position);
            pad.addTag(tag);
        } catch (_) {
            pad = undefined;
        }
    }

    s.pads[spot.key] = pad;
    s.last[spot.key] = undefined;
    return pad;
}

function carryPlayers(ship, pad, dx, dz) {
    let list;
    try {
        list = ship.dimension.getPlayers({ location: pad, maxDistance: 6 });
    } catch (_) {
        return;
    }

    for (const player of list) {
        try {
            if (player.getComponent("minecraft:riding")?.entityRidingOn) continue;
            const p = player.location;
            if (
                Math.abs(p.x - pad.x) > PAD_HALF - 0.2 ||
                Math.abs(p.z - pad.z) > PAD_HALF - 0.2 ||
                p.y < pad.y - 1.0 ||
                p.y > pad.y + 1.1
            ) continue;
            player.teleport({ x: p.x + dx, y: Math.max(p.y, pad.y), z: p.z + dz }, { keepVelocity: true });
        } catch (_) {}
    }
}

// Solo trabaja cuando la plataforma realmente cambió de sitio
function updatePads(s) {
    for (const spot of PAD_SPOTS) {
        let position;
        try {
            position = padLocation(s.ship, spot);
        } catch (_) {
            continue;
        }

        const pad = getPad(s, spot, position);
        if (!isAlive(pad)) continue;

        const last = s.last[spot.key];
        const dx = last ? position.x - last.x : 0;
        const dy = last ? position.y - last.y : 0;
        const dz = last ? position.z - last.z : 0;
        if (last && Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3 && Math.abs(dz) < 1e-3) continue;

        s.last[spot.key] = { x: position.x, y: position.y, z: position.z };
        try { pad.teleport(position); } catch (_) {}
        if (dx !== 0 || dz !== 0) carryPlayers(s.ship, position, dx, dz);
    }
}

function removePads(s) {
    for (const pad of Object.values(s.pads)) {
        if (!isAlive(pad)) continue;
        try { pad.remove(); } catch (_) { try { pad.kill(); } catch (_) {} }
    }
    s.pads = {};
    s.last = {};
}

function scan() {
    for (const name of DIMENSIONS) {
        let dim;
        try { dim = world.getDimension(name); } catch (_) { continue; }

        try {
            for (const ship of dim.getEntities({ type: SHIP_ID })) {
                const s = register(ship);
                updatePads(s);
            }
        } catch (_) {}

        // Plataformas huérfanas (su barco ya no existe): se borran tras dos revisiones seguidas
        try {
            const present = new Set();
            for (const deck of dim.getEntities({ type: DECK_ID })) {
                const tag = deck.getTags().find((t) => t.startsWith("pad:"));
                if (!tag) continue;
                const s = ships.get(tag.split(":")[1]);
                present.add(deck.id);
                if (s && isAlive(s.ship)) { orphans.delete(deck.id); continue; }
                const n = (orphans.get(deck.id) ?? 0) + 1;
                if (n >= 2) { deck.remove(); orphans.delete(deck.id); } else orphans.set(deck.id, n);
            }
            for (const id of orphans.keys()) if (!present.has(id)) orphans.delete(id);
        } catch (_) {}
    }
}

// ───────────────────────── Cañones ─────────────────────────
function aimPoint(player, ship) {
    const dim = player.dimension;
    const eye = player.getHeadLocation();
    const view = player.getViewDirection();
    let dist = AIM_RANGE;

    try {
        const hit = dim.getBlockFromRay(eye, view, { maxDistance: AIM_RANGE, includeLiquidBlocks: true });
        if (hit?.block) {
            const b = hit.block.location;
            dist = Math.min(dist, Math.hypot(b.x + 0.5 - eye.x, b.y + 0.5 - eye.y, b.z + 0.5 - eye.z));
        }
    } catch (_) {}

    try {
        for (const h of dim.getEntitiesFromRay(eye, view, { maxDistance: dist })) {
            const e = h.entity;
            if (e.id === player.id || e.id === ship.id) continue;
            if (e.typeId === DECK_ID || e.typeId === BULLET_ID) continue;
            dist = Math.min(dist, h.distance);
            break;
        }
    } catch (_) {}

    return { x: eye.x + view.x * dist, y: eye.y + view.y * dist, z: eye.z + view.z * dist };
}

// Dirección del disparo: limitada al arco del costado y con la elevación necesaria
// para que la bala llegue al punto apuntado aunque caiga por gravedad.
function shotVelocity(pos, aim, sv) {
    const dx = aim.x - pos.x, dy = aim.y - pos.y, dz = aim.z - pos.z;
    const hd = Math.hypot(dx, dz);
    let hx = sv.x, hz = sv.z;

    if (hd > 1) {
        const ux = dx / hd, uz = dz / hd;
        const ang = clamp(Math.atan2(sv.x * uz - sv.z * ux, sv.x * ux + sv.z * uz), -ARC_YAW, ARC_YAW);
        const c = Math.cos(ang), n = Math.sin(ang);
        hx = sv.x * c - sv.z * n;
        hz = sv.x * n + sv.z * c;
    }

    const v = BULLET_SPEED, g = BULLET_GRAVITY;
    let pitch;
    if (g > 0 && hd > 1) {
        const disc = v ** 4 - g * (g * hd * hd + 2 * dy * v * v);
        pitch = disc >= 0 ? Math.atan2(v * v - Math.sqrt(disc), g * hd) : Math.PI / 4;
    } else {
        pitch = Math.atan2(dy, Math.max(hd, 1));
    }
    pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);

    const cp = Math.cos(pitch);
    return { x: hx * cp * v, y: Math.sin(pitch) * v, z: hz * cp * v };
}

function shoot(ship, player, side, offset, aim) {
    if (!isAlive(ship)) return;

    const f = forwardOf(ship);
    const sv = { x: f.z * side, z: -f.x * side };
    const base = ship.location;
    const dim = ship.dimension;
    const pos = {
        x: base.x + f.x * offset + sv.x * SIDE_OFFSET,
        y: base.y + DECK_Y,
        z: base.z + f.z * offset + sv.z * SIDE_OFFSET
    };

    const vel = shotVelocity(pos, aim, sv);
    const sh = ship.getVelocity();

    try {
        const bullet = dim.spawnEntity(BULLET_ID, pos);
        bullet.applyImpulse({ x: vel.x + sh.x, y: vel.y, z: vel.z + sh.z });
        try { bullet.getComponent("minecraft:projectile").owner = player; } catch (_) {}
    } catch (_) {}

    try { dim.playSound("cannonshoot", pos, { volume: 2.5, pitch: 0.6 + Math.random() * 0.2 }); } catch (_) {}
    const muzzle = { x: pos.x + sv.x * 1.2, y: pos.y + 0.2, z: pos.z + sv.z * 1.2 };
    try { dim.spawnParticle("minecraft:large_explosion", muzzle); } catch (_) {}
    try { dim.spawnParticle("minecraft:basic_smoke_particle", muzzle); } catch (_) {}
    try { ship.applyImpulse({ x: -sv.x * RECOIL, y: 0, z: -sv.z * RECOIL }); } catch (_) {}
}

function fire(s, player) {
    const ship = s.ship;
    const now = system.currentTick;
    const view = player.getViewDirection();
    const f = forwardOf(ship);

    // El costado que dispara es hacia donde mira el jugador
    const side = view.x * f.z - view.z * f.x >= 0 ? 1 : -1;

    const readyAt = s.reload[side] ?? 0;
    if (now < readyAt) {
        player.onScreenDisplay.setActionBar(`§7Recargando ${SIDE_NAME[side]}: ${((readyAt - now) / 20).toFixed(1)} s`);
        return;
    }
    s.reload[side] = now + RELOAD;

    const aim = aimPoint(player, ship);
    player.onScreenDisplay.setActionBar(`§6¡Fuego a ${SIDE_NAME[side]}!`);
    try { ship.playAnimation(SIDE_ANIM[side]); } catch (_) {}

    CANNON_OFFSETS.forEach((offset, i) => {
        system.runTimeout(() => {
            try { shoot(ship, player, side, offset, aim); } catch (_) {}
        }, ANIM_DELAY + i * SALVO_GAP);
    });
}

// ───────────────────────── Bucles y eventos ─────────────────────────
system.run(scan);
system.runInterval(scan, 40);

system.runInterval(() => {
    for (const [id, s] of ships) {
        if (!isAlive(s.ship)) {
            // Margen para chunks que se recargan: si no vuelve, se limpia
            if (++s.invalid > 50) {
                removePads(s);
                ships.delete(id);
            }
            continue;
        }
        s.invalid = 0;
        drive(s);
    }
}, 2);

system.runInterval(() => {
    for (const s of ships.values()) {
        if (!isAlive(s.ship)) continue;
        try { updatePads(s); } catch (_) {}
    }
}, 1);

world.afterEvents.entitySpawn.subscribe((event) => {
    const e = event.entity;
    if (e && e.typeId === SHIP_ID) updatePads(register(e));
});

world.afterEvents.entityRemove.subscribe((event) => {
    if (event.typeId !== SHIP_ID) return;
    const s = ships.get(event.removedEntityId);
    if (s) removePads(s);
});

world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const item = event.itemStack;
    if (!(player instanceof Player)) return;
    if (!item || item.typeId !== FLINT_ITEM) return;

    let ship;
    try {
        ship = player.getComponent("minecraft:riding")?.entityRidingOn;
    } catch (_) {
        return;
    }

    if (!ship || ship.typeId !== SHIP_ID) return;
    if (pilotOf(ship)?.id !== player.id) return;

    fire(register(ship), player);
});