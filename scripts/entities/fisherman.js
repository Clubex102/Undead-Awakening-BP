import { world, system } from "@minecraft/server";

/* ================= PESCADOR =================
 * udaw:zombie_fisher: el JUEGO lanza el anzuelo (ranged_attack vanilla).
 * El script solo resuelve impactos: en MOB lo ARRASTRA hacia el pescador
 * (tirón + slowness breve) y en BLOQUE falla el lance. Sin loops por tick:
 * todo va por eventos salvo la estela (solo si hay anzuelos en vuelo).
 */

const FISHER_ID = "udaw:zombie_fisher";
const FHOOK_ID = "udaw:fish_hook"; // anzuelo propio (el vanilla no lo spawnea el shooter)
const LINK_ID = "udaw:fish_link"; // eslabón de cuerda (sin física: flota solo)
const DIMENSIONS = ["overworld", "nether", "the_end"];
const FISH_DEBUG = true;
const FISH_TRAIL = "udaw:grapple_trail"; // tu cadena negra (puffs)
const HOOK_SPEED_CAP = 0; // freno DESACTIVADO: recortar velocidad borra el proyectil
const LINK_SPACING = 0.45; // separación entre eslabones (el eslabón mide 0.5)
const LINK_MAX = 40; // tope de eslabones por cuerda (~18 bloques)

const hookOwner = new Map(); // hookId -> fisherId (dueño del lance)
const liveHooks = new Set(); // hookIds en vuelo (estela barata)
const ropes = new Map(); // hookId -> { fisherId, links: [entityId] } cuerda viva

function flog(msg) {
    if (FISH_DEBUG) { try { console.warn("[pescador] " + msg); } catch (_) {} }
}

world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (!e || e.typeId !== FHOOK_ID) return;
    try {
        try { liveHooks.add(e.id); } catch (_) {}
        try { ropes.set(e.id, { fisherId: null, links: [] }); } catch (_) {}
        if (hookOwner.size > 100) hookOwner.clear();
        if (liveHooks.size > 60) liveHooks.clear();
        // Dueño: pescador libre más cercano (el lance es vanilla)
        let best = null;
        let bestD = 36;
        const cands = e.dimension.getEntities({ location: e.location, maxDistance: 6 });
        for (const c of cands) {
            if (c.typeId !== FISHER_ID) continue;
            let ok = false;
            try { ok = c.isValid; } catch (_) {}
            if (!ok) continue;
            const dx = c.location.x - e.location.x;
            const dy = c.location.y - e.location.y;
            const dz = c.location.z - e.location.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best) {
            hookOwner.set(e.id, best.id);
            try {
                const rope = ropes.get(e.id);
                if (rope) rope.fisherId = best.id;
            } catch (_) {}
            try { best.playAnimation("animation.fisher.fish"); } catch (_) {}
            flog("lance!");
        }
    } catch (_) {}
});

function resolveFisher(hookEnt, dim) {
    let id = null;
    try { id = hookOwner.get(hookEnt.id); } catch (_) {}
    if (id) {
        try {
            const f = world.getEntity(id);
            if (f && f.isValid && f.typeId === FISHER_ID) return f;
        } catch (_) {}
    }
    try {
        const near = dim.getEntities({ location: hookEnt.location, maxDistance: 6 });
        for (const e of near) {
            if (e.typeId !== FISHER_ID) continue;
            try { if (e.isValid) return e; } catch (_) {}
        }
    } catch (_) {}
    return null;
}

function releaseRope(hookId) {
    // Suelta la cuerda: elimina eslabones y borra el registro.
    try {
        const rope = ropes.get(hookId);
        if (rope && rope.links) {
            for (const lid of rope.links) {
                try {
                    const l = world.getEntity(lid);
                    if (l && l.isValid) l.remove();
                } catch (_) {}
            }
        }
    } catch (_) {}
    try { ropes.delete(hookId); } catch (_) {}
}

function dropHook(hookId) {
    try { hookOwner.delete(hookId); } catch (_) {}
    try { liveHooks.delete(hookId); } catch (_) {}
    releaseRope(hookId);
}

world.afterEvents.projectileHitEntity.subscribe((ev) => {
    const p = ev.projectile;
    if (!p || p.typeId !== FHOOK_ID) return;

    const dim = ev.dimension;
    const f = resolveFisher(p, dim);
    let target = null;
    try { target = ev.getEntityHit().entity; } catch (_) {}
    // Eslabones de la propia cuerda: el anzuelo los atraviesa sin romperse.
    try { if (target && target.typeId === LINK_ID) return; } catch (_) {}
    try { p.remove(); } catch (_) {}
    dropHook(p.id);
    if (!f) return;

    let fl = null;
    try { fl = f.location; } catch (_) { return; }

    // Ignorar al propio dueño (el tiro nace pegado a él)
    if (target) {
        try { if (target.id === f.id) return; } catch (_) {}
    }
    if (!target || !target.isValid) return;
    try { flog("impacto en " + target.typeId); } catch (_) {}

    // TIRÓN hacia el pescador (un jalón seco, sin atar).
    // Vale para mobs Y jugadores en cualquier modo.
    let pdx = 0, pdz = 0, plen = 1;
    try {
        const tl = target.location;
        pdx = fl.x - tl.x;
        pdz = fl.z - tl.z;
        plen = Math.sqrt(pdx * pdx + pdz * pdz) || 1;
    } catch (_) {}
    if (target.typeId === "minecraft:player") {
        // Al jugador el knockback a veces no le entra: impulso directo
        // (conserva 30% de su velocidad y suma el jalón + elevación).
        try {
            const v = target.getVelocity();
            target.clearVelocity();
            target.applyImpulse({
                x: v.x * 0.3 + pdx / plen * 0.9,
                y: Math.max(v.y, 0) * 0.3 + 0.55,
                z: v.z * 0.3 + pdz / plen * 0.9
            });
        } catch (_) {}
    } else {
        try {
            target.applyKnockback({ x: pdx / plen * 1.8, z: pdz / plen * 1.8 }, 0.6);
        } catch (_) {}
    }
    // Slowness breve para que el tirón cuaje (no aturde, puede seguir pegando)
    try { target.addEffect("slowness", 60, { amplifier: 1, showParticles: false }); } catch (_) {}
    try { f.playAnimation("animation.fisher.fished"); } catch (_) {}
    try { dim.playSound("random.bow_hit", fl); } catch (_) {}
    try { dim.spawnParticle(FISH_TRAIL, target.location); } catch (_) {}
    flog("tirón!");
});

world.afterEvents.projectileHitBlock.subscribe((ev) => {
    const p = ev.projectile;
    if (!p || p.typeId !== FHOOK_ID) return;
    try { p.remove(); } catch (_) {}
    dropHook(p.id);
    try {
        ev.dimension.spawnParticle(FISH_TRAIL, ev.location);
    } catch (_) {}
    flog("lance fallado");
});

// Vuelo del anzuelo cada 2 ticks (solo si hay algo vivo): estela + freno
// de velocidad (anzuelo más lento) + cuerda de eslabones sin partículas.
system.runInterval(() => {
    try {
        if (liveHooks.size === 0 && ropes.size === 0) return;
    } catch (_) { return; }
    const seen = new Set();
    for (const dimId of DIMENSIONS) {
        let dimension = null;
        try { dimension = world.getDimension(dimId); } catch (_) { continue; }
        try {
            const hooks = dimension.getEntities({ type: FHOOK_ID });
            for (const h of hooks) {
                try {
                    if (!h.isValid) continue;
                    try { seen.add(h.id); } catch (_) {}
                    dimension.spawnParticle(FISH_TRAIL, h.location);
                } catch (_) {}
            }
        } catch (_) {}
    }
    // Cuerdas: tender eslabones pescador -> anzuelo
    try {
        for (const [hid, rope] of ropes) {
            if (!seen.has(hid)) { releaseRope(hid); continue; }
            let hook = null, fisher = null;
            try { hook = world.getEntity(hid); if (hook && !hook.isValid) hook = null; } catch (_) { hook = null; }
            let fid = rope.fisherId;
            if (!fid) { try { fid = hookOwner.get(hid); } catch (_) {} }
            try { fisher = fid ? world.getEntity(fid) : null; if (fisher && !fisher.isValid) fisher = null; } catch (_) { fisher = null; }
            if (!hook || !fisher) { releaseRope(hid); continue; }
            let hp = null, fp = null, fdim = null;
            try { hp = hook.location; fp = fisher.location; fdim = fisher.dimension; } catch (_) { releaseRope(hid); continue; }
            const ax = fp.x, ay = fp.y + 1.4, az = fp.z; // mano del pescador
            const dx = hp.x - ax, dy = hp.y - ay, dz = hp.z - az;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
            let n = Math.ceil(dist / LINK_SPACING);
            if (n < 2) n = 2;
            if (n > LINK_MAX) n = LINK_MAX;
            while (rope.links.length < n) {
                try {
                    const l = fdim.spawnEntity(LINK_ID, { x: ax, y: ay, z: az });
                    if (l) rope.links.push(l.id);
                    else break;
                } catch (_) { break; }
            }
            while (rope.links.length > n) {
                const lid = rope.links.pop();
                try {
                    const l = world.getEntity(lid);
                    if (l && l.isValid) l.remove();
                } catch (_) {}
            }
            const total = rope.links.length;
            for (let i = 0; i < total; i++) {
                const t = (i + 1) / (total + 1);
                const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
                try {
                    const l = world.getEntity(rope.links[i]);
                    if (!l || !l.isValid) continue;
                    const t2 = (i + 2) / (total + 1);
                    if (t2 > 1) {
                        try { l.teleport({ x: px, y: py, z: pz }); } catch (_) {}
                    } else {
                        try {
                            l.teleport({ x: px, y: py, z: pz }, { facingLocation: { x: ax + dx * t2, y: ay + dy * t2, z: az + dz * t2 } });
                        } catch (_) {
                            try { l.teleport({ x: px, y: py, z: pz }); } catch (_) {}
                        }
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}
    // Poda: ganchos desaparecidos sin impacto (despawn) sueltan todo
    try {
        for (const hid of liveHooks) {
            if (!seen.has(hid)) {
                try { liveHooks.delete(hid); } catch (_) {}
                try { hookOwner.delete(hid); } catch (_) {}
                releaseRope(hid);
            }
        }
    } catch (_) {}
}, 2);

world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (!e) return;
    if (e.typeId === FHOOK_ID) { dropHook(e.id); return; }
    if (e.typeId !== FISHER_ID) return;
});
