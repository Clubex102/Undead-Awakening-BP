import { world, system, GameMode } from "@minecraft/server";

/* ================= ABORDADOR =================
 * udaw:zombie_boarder: el JUEGO dispara el garfio (ranged_attack vanilla,
 * sin auto-dano) y pelea cuerpo a cuerpo (melee vanilla). El script solo
 * resuelve impactos: en BLOQUE clava el ancla, en MOB lo jalonea y ancla
 * ahi mismo. Despues sube hasta 2 zombies a lomos y se iza de un salto.
 */

const BOARDER_ID = "udaw:zombie_boarder";
const HOOK_ID = "udaw:grapple_hook";
const DIMENSIONS = ["overworld", "nether", "the_end"];

const GRAPPLE_RANGE = 24;
const MAX_RIDERS = 2;
const ABD_DEBUG = true;
const TRAIL_PARTICLE = "udaw:grapple_trail";

const jobs = new Map(); // boarderId -> { hookId, anchor, preyId, age, launched, launchAge, riders }
const retryMap = new Map(); // boarderId -> { count, until } reintentos con jinetes montados
const aboardRiders = new Set(); // ids de zombies yendo de jinetes (no actuan ni se embarcan)
const pendingHooks = new Map(); // hookId -> boarderId (dueno del tiro vanilla)
const lastShot = new Map(); // boarderId -> tick del ultimo tiro (vanilla o dirigido)
const hookBirth = new Map(); // hookId -> tick de nacimiento (gracia anti self-hit)

function dlog(msg) {
    if (ABD_DEBUG) { try { console.warn("[abordador] " + msg); } catch (_) {} }
}

const BOARD_PREY = new Set([
    "minecraft:player",
    "minecraft:villager",
    "minecraft:villager_v2",
    "minecraft:iron_golem",
    "minecraft:wandering_trader",
    "minecraft:pillager",
    "minecraft:vindicator",
    "minecraft:evoker",
    "minecraft:illusioner",
    "minecraft:ravager",
    "minecraft:witch"
]);

function isIllagerFamily(e) {
    try { return e.matches({ families: ["illager"] }); } catch (_) { return false; }
}

function findBoardPrey(zombie) {
    let best = null;
    let bestDist = Infinity;
    let candidates = [];
    try {
        candidates = zombie.dimension.getEntities({
            location: zombie.location,
            maxDistance: GRAPPLE_RANGE
        });
    } catch (_) { return null; }
    for (const e of candidates) {
        if (e === zombie) continue;
        if (!BOARD_PREY.has(e.typeId) && !isIllagerFamily(e)) continue;
        if (e.typeId === "minecraft:player") {
            try {
                if (!e.matches({ excludeGameModes: [GameMode.creative, GameMode.spectator] })) continue;
            } catch (_) { continue; }
        }
        const dx = e.location.x - zombie.location.x;
        const dy = e.location.y - zombie.location.y;
        const dz = e.location.z - zombie.location.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < bestDist) {
            bestDist = d;
            best = e;
        }
    }
    return best;
}

function cancelJob(boardId) {
    const job = jobs.get(boardId);
    if (!job) return;
    if (job.riders) {
        for (const rid of job.riders) {
            try { aboardRiders.delete(rid); } catch (_) {}
        }
    }
    if (job.hookId) {
        try {
            const h = world.getEntity(job.hookId);
            if (h && h.isValid) h.remove();
        } catch (_) {}
    }
    try {
        const b = world.getEntity(boardId);
        if (b && b.isValid) {
            try {
                const ride = b.getComponent("minecraft:rideable");
                if (ride) ride.ejectRiders();
            } catch (_) {}
        }
    } catch (_) {}
    jobs.delete(boardId);
}

function stepBoarder(b) {
    let valid = false;
    try { valid = b.isValid; } catch (_) { return; }
    if (!valid) {
        cancelJob(b.id);
        return;
    }
    // Un jinete no actua (evita jinetes anidados y fisicas peleando)
    try { if (aboardRiders.has(b.id)) return; } catch (_) { return; }

    const job = jobs.get(b.id);
    if (job) {
        ascendStep(b, job);
        return;
    }
    // Sin job: el vanilla (ranged + melee del JSON) manda. Nada que hacer.
}

function fireImpulse(b, loc, dx, dy, dz, horiz, tag) {
    // Calculo unico del salto: T por distancia+desnivel, vy por altura,
    // horizontal con boost por distancia+altura (doble punch).
    // Doble fase: vertical AHORA, horizontal +1s (via job.pendingH).
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const G = 0.08;
    // Tiempo de vuelo: crece con horizontal y con desnivel (mas o menos)
    let T = 8 + horiz * 0.9 + Math.abs(dy) * 1.3;
    if (T < 8) T = 8;
    if (T > 46) T = 46;
    // Tope horizontal segun distancia (lejos pega mas, cerca suave)
    const vhMax = dist > 14 ? 3.2 : 2.2;
    let vh = horiz / T;
    if (vh > vhMax && horiz > 0.01) T = horiz / vhMax;
    // Vertical: subida extra si el ancla esta alta, arco tenso si esta baja
    let vy;
    if (dy >= 0) {
        vy = dy / T + 0.5 * G * T + Math.min(dy * 0.05, 1.0);
    } else {
        vy = dy / T + 0.5 * G * T * 0.7;
    }
    if (vy > 3.4) vy = 3.4;
    if (vy < -3.0) vy = -3.0;
    // Horizontal con compensacion de rozamiento: lejos = mas punch,
    // alto = extra por el tiempo extra en el aire. Cerca = suave.
    let hBoost = 1 + Math.min(dist * 0.05, 1.0);
    if (dy > 0) hBoost += Math.min(dy * 0.02, 0.3);
    let vx = dx / T * hBoost;
    let vz = dz / T * hBoost;
    const vh2 = Math.sqrt(vx * vx + vz * vz);
    if (vh2 > 4.5) { vx *= 4.5 / vh2; vz *= 4.5 / vh2; }
    // FASE 1: despegue VERTICAL ahora. La FASE 2 (empuje horizontal) la
    // aplica ascendStep 1s despues con job.pendingH. Sube y luego tira.
    try {
        b.applyImpulse({ x: 0, y: vy, z: 0 });
        try { b.playAnimation("animation.boarder.boarding"); } catch (_) {}
        try { b.dimension.playSound("random.orb", loc); } catch (_) {}
    } catch (_) {}
    dlog("despegue" + (tag ? " " + tag : "") + "! vy=" + vy.toFixed(2) + " empujeH en 1s (vx=" + vx.toFixed(2) + " vz=" + vz.toFixed(2) + ")");
    return { vx, vz };
}

function freeRiders(job) {
    if (!job || !job.riders) return;
    for (const rid of job.riders) {
        try { aboardRiders.delete(rid); } catch (_) {}
    }
}

function finishBoard(b, job) {
    // Exito: desmonta, libera y limpia reintentos.
    try {
        const ride = b.getComponent("minecraft:rideable");
        if (ride) ride.ejectRiders();
    } catch (_) {}
    try { b.playAnimation("animation.boarder.boarding"); } catch (_) {}
    freeRiders(job);
    try { retryMap.delete(b.id); } catch (_) {}
    jobs.delete(b.id);
    dlog("coronado, desmonta");
}

function failBoard(b, job, why) {
    // Fallo: MANTIENE jinetes montados (el proximo gancho retoma sin
    // re-embarcar). A los 3 fallos suelta todo y empieza limpio.
    let now = 0;
    try { now = system.currentTick; } catch (_) {}
    let prev = null;
    try { prev = retryMap.get(b.id); } catch (_) {}
    const count = prev && prev.until > now ? prev.count + 1 : 1;
    if (count > 2) {
        try {
            const ride = b.getComponent("minecraft:rideable");
            if (ride) ride.ejectRiders();
        } catch (_) {}
        freeRiders(job);
        try { retryMap.delete(b.id); } catch (_) {}
    } else {
        try {
            retryMap.set(b.id, { count, until: now + 200 });
            if (retryMap.size > 40) {
                for (const [k, v] of retryMap) {
                    if (v.until <= now) {
                        try { retryMap.delete(k); } catch (_) {}
                    }
                }
            }
        } catch (_) {}
    }
    try { b.playAnimation("animation.boarder.boarding"); } catch (_) {}
    jobs.delete(b.id);
    dlog("fallo (" + why + "), reintento " + Math.min(count, 3) + "/3");
}

function readRetries(boardId) {
    // Lee y poda perezosa: sin intervalo extra de limpieza.
    try {
        const r = retryMap.get(boardId);
        if (!r) return 0;
        let now = 0;
        try { now = system.currentTick; } catch (_) {}
        if (r.until <= now) {
            try { retryMap.delete(boardId); } catch (_) {}
            return 0;
        }
        return r.count;
    } catch (_) { return 0; }
}

function ascendStep(b, job) {
    // Sin ancla no hay ascenso (el ancla la pone el impacto, no el disparo)
    if (!job.anchor) {
        cancelJob(b.id);
        return;
    }

    job.age = (job.age || 0) + 10;
    if (job.age > 200) {
        failBoard(b, job, "timeout");
        return;
    }

    let loc = null;
    try { loc = b.location; } catch (_) { cancelJob(b.id); return; }

    let prey = null;
    try {
        prey = world.getEntity(job.preyId);
        if (prey && !prey.isValid) prey = null;
    } catch (_) { prey = null; }

    // ANCLA VIVA cada 20 ticks: recentra en la presa (<=32 bloques).
    // Cero getEntities: solo mates sobre la presa ya resuelta.
    if (prey && (job.age % 20) === 0) {
        try {
            const pl = prey.location;
            const pdx = pl.x - loc.x;
            const pdz = pl.z - loc.z;
            if (pdx * pdx + pdz * pdz < 1024) {
                job.anchor.x = Math.floor(pl.x) + 0.5;
                job.anchor.y = Math.floor(pl.y) + 1;
                job.anchor.z = Math.floor(pl.z) + 0.5;
            } else { prey = null; } // huyo lejos: soltar
        } catch (_) { prey = null; }
    }

    const a = job.anchor;
    const dx = a.x - loc.x;
    const dy = a.y - loc.y;
    const dz = a.z - loc.z;
    const horiz2 = dx * dx + dz * dz; // al cuadrado: sin sqrt
    const horiz = Math.sqrt(horiz2); // un solo sqrt, lo usa el despegue

    if (!prey) { failBoard(b, job, "presa perdida"); return; }

    // LLEGADA amplia + anti-sobrepaso: cerca (3.5) o pista de que la
    // atraveso (2 checks seguidos dentro de 6 y alejandose) -> coronar.
    if (Math.abs(dy) < 3 && horiz2 < 12.25) { finishBoard(b, job); return; }
    if (job.pushAge > 0) {
        if (horiz2 < 36) {
            if (horiz2 > (job.lastH2 || 0)) {
                job.overChecks = (job.overChecks || 0) + 1;
                if (job.overChecks >= 2) { finishBoard(b, job); return; }
            } else { job.overChecks = 0; }
        } else { job.overChecks = 0; }
        job.lastH2 = horiz2;
    }

    if (!job.launched) {
        // DESPEGUE vertical hacia el ancla (con jinetes a bordo).
        // El empuje horizontal entra 1s despues (job.pendingH).
        const hv = fireImpulse(b, loc, dx, dy, dz, horiz, "");
        job.launched = true;
        job.launchAge = job.age;
        job.pushAge = 0;
        job.pendingH = hv ? { vx: hv.vx, vz: hv.vz, due: job.age + 20 } : null;
        return;
    }

    // FASE 2: empuje horizontal 1s despues del despegue
    try {
        if (job.pendingH && job.age >= job.pendingH.due) {
            b.applyImpulse({ x: job.pendingH.vx, y: 0, z: job.pendingH.vz });
            try { b.dimension.playSound("random.orb", b.location); } catch (_) {}
            dlog("empuje horizontal!");
            job.pushAge = job.age;
            job.pendingH = null;
        }
    } catch (_) { try { job.pendingH = null; } catch (_) {} }

    // GUIADO: micro-correccion hacia el ancla cada llamada (10 ticks),
    // solo tras la fase 2 y con desvio >1.5. Topes duros anti-infinito.
    try {
        if (job.pushAge > 0 && horiz2 > 2.25) {
            const cx = Math.max(-0.6, Math.min(0.6, dx * 0.06));
            const cz = Math.max(-0.6, Math.min(0.6, dz * 0.06));
            const cy = Math.max(-0.4, Math.min(0.5, dy * 0.06));
            if (cx !== 0 || cz !== 0 || cy !== 0) {
                b.applyImpulse({ x: cx, y: cy, z: cz });
            }
        }
    } catch (_) {}

    // Suelo tras el ultimo impulso: lejos = fallo con reintento, cerca = fin.
    try {
        const lastPush = job.pushAge > 0 ? job.pushAge : (job.launchAge || 0);
        let grounded = false;
        try { grounded = b.isOnGround; } catch (_) {}
        if (grounded && job.age - lastPush > 25) {
            if (horiz2 > 36) { failBoard(b, job, "lejos"); return; }
            finishBoard(b, job);
            return;
        }
    } catch (_) {}
}

system.runInterval(() => {
    for (const dimId of DIMENSIONS) {
        let dimension = null;
        try { dimension = world.getDimension(dimId); } catch (_) { continue; }
        let boarders = [];
        try { boarders = dimension.getEntities({ type: BOARDER_ID }); } catch (_) { continue; }
        for (const b of boarders) {
            try { stepBoarder(b); } catch (_) {}
        }
    }
}, 10);

// Estela del garfio + cuerda visible: solo trabaja si hay tiros o ascensos.
// Barato: salida temprana cuando no pasa nada.
system.runInterval(() => {
    try {
        if (pendingHooks.size === 0 && jobs.size === 0) return;
    } catch (_) { return; }
    const seenHooks = new Set();
    for (const dimId of DIMENSIONS) {
        let dimension = null;
        try { dimension = world.getDimension(dimId); } catch (_) { continue; }
        // Estela de ganchos en vuelo (el modelo es minusculo: la estela lo delata)
        try {
            const hooks = dimension.getEntities({ type: HOOK_ID });
            for (const h of hooks) {
                try {
                    if (!h.isValid) continue;
                    try { seenHooks.add(h.id); } catch (_) {}
                    dimension.spawnParticle(TRAIL_PARTICLE, h.location);
                } catch (_) {}
            }
        } catch (_) {}
        // Cuerda boarder -> ancla durante el ascenso (6 puntos interpolados)
        try {
            const boarders = dimension.getEntities({ type: BOARDER_ID });
            for (const b of boarders) {
                let job = null;
                try { job = jobs.get(b.id); } catch (_) {}
                if (!job || !job.anchor) continue;
                let bl = null;
                try { bl = b.location; } catch (_) { continue; }
                const a = job.anchor;
                const y0 = bl.y + 1.2;
                for (let i = 1; i <= 6; i++) {
                    const t = i / 7;
                    try {
                        dimension.spawnParticle(TRAIL_PARTICLE, {
                            x: bl.x + (a.x - bl.x) * t,
                            y: y0 + (a.y - y0) * t,
                            z: bl.z + (a.z - bl.z) * t
                        });
                    } catch (_) { break; }
                }
            }
        } catch (_) {}
    }
    // Podar tiros ya desaparecidos (despawn sin impacto) para no correr en vano
    try {
        for (const hid of pendingHooks.keys()) {
            if (!seenHooks.has(hid)) {
                try { pendingHooks.delete(hid); } catch (_) {}
            }
        }
    } catch (_) {}
}, 3);

world.afterEvents.entitySpawn.subscribe((ev) => {
    const e = ev.entity;
    if (!e || e.typeId !== HOOK_ID) return;
    // El tiro es vanilla: asociar al boarder libre mas cercano (dueno real)
    // y sellar tick de tiro + nacimiento (watchdog y gracia self-hit).
    let now = 0;
    try { now = system.currentTick; } catch (_) {}
    try {
        try { hookBirth.set(e.id, now); } catch (_) {}
        if (hookBirth.size > 100) hookBirth.clear();
        if (pendingHooks.size > 100) pendingHooks.clear();
        let best = null;
        let bestD = 36;
        const cands = e.dimension.getEntities({ location: e.location, maxDistance: 6 });
        for (const c of cands) {
            if (c.typeId !== BOARDER_ID) continue;
            let ok = false;
            try { ok = c.isValid && !jobs.has(c.id); } catch (_) {}
            if (!ok) continue;
            const dx = c.location.x - e.location.x;
            const dy = c.location.y - e.location.y;
            const dz = c.location.z - e.location.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = c; }
        }
        if (best) {
            pendingHooks.set(e.id, best.id);
            try { lastShot.set(best.id, now); } catch (_) {}
        }
    } catch (_) {}
});

function boardRiders(b, job, dim) {
    // Sube hasta MAX_RIDERS zombies (nunca jinetes ni boarders)
    let rideable = null;
    try { rideable = b.getComponent("minecraft:rideable"); } catch (_) { return 0; }
    if (!rideable) return 0;
    let cands = [];
    try {
        cands = dim.getEntities({ location: b.location, maxDistance: 6 });
    } catch (_) {}
    dlog("candidatos cerca: " + cands.length);
    let n = 0;
    for (const r of cands) {
        if (n >= MAX_RIDERS) break;
        let ok = false;
        try {
            ok = r.id !== b.id && !aboardRiders.has(r.id) &&
                r.typeId !== BOARDER_ID && r.matches({ families: ["zombie"] });
        } catch (_) { ok = false; }
        if (!ok) continue;
        try {
            rideable.addRider(r);
            n++;
            try { aboardRiders.add(r.id); } catch (_) {}
            try { job.riders.push(r.id); } catch (_) {}
        } catch (e) { dlog("addRider FAIL " + e); break; }
    }
    return n;
}

function resolveOwner(hookEnt, dim) {
    // 1. mapa del tiro vanilla, 2. prop legacy, 3. boarder libre cercano
    let id = null;
    try { id = pendingHooks.get(hookEnt.id); } catch (_) {}
    if (!id) { try { id = hookEnt.getDynamicProperty("udaw:owner"); } catch (_) {} }
    if (id) {
        try {
            const b = world.getEntity(id);
            if (b && b.isValid && b.typeId === BOARDER_ID) return b;
        } catch (_) {}
    }
    try {
        const near = dim.getEntities({ location: hookEnt.location, maxDistance: 6 });
        for (const e of near) {
            if (e.typeId !== BOARDER_ID) continue;
            let ok = false;
            try { ok = e.isValid && !jobs.has(e.id); } catch (_) {}
            if (ok) return e;
        }
    } catch (_) {}
    return null;
}

world.afterEvents.projectileHitBlock.subscribe((ev) => {
    const p = ev.projectile;
    if (!p || p.typeId !== HOOK_ID) return;

    const dim = ev.dimension;
    const b = resolveOwner(p, dim);
    try { p.remove(); } catch (_) {}
    try { pendingHooks.delete(p.id); } catch (_) {}
    try { hookBirth.delete(p.id); } catch (_) {}
    if (!b) return;
    if (jobs.has(b.id)) return; // ya izando, no apilar

    let ax = 0, ay = 0, az = 0;
    try {
        ax = Math.floor(ev.location.x) + 0.5;
        ay = Math.floor(ev.location.y) + 1;
        az = Math.floor(ev.location.z) + 0.5;
    } catch (_) { return; }

    const prey = findBoardPrey(b);
    if (!prey) {
        // Sin presa no hay abordaje: puff y fuera, sin crear job muerto.
        try { dim.spawnParticle(TRAIL_PARTICLE, { x: ax, y: ay + 0.3, z: az }); } catch (_) {}
        dlog("ancla sin presa, suelta");
        return;
    }
    const retries = readRetries(b.id);
    jobs.set(b.id, { hookId: null, anchor: { x: ax, y: ay, z: az }, preyId: prey.id, age: 0, launched: false, launchAge: 0, pushAge: 0, pendingH: null, lastH2: 0, overChecks: 0, riders: [], retries: retries });
    const n = boardRiders(b, jobs.get(b.id), dim);

    try { dim.playSound("random.anvil_land", b.location, { pitch: 0.7 }); } catch (_) {}
    try { dim.playSound("random.orb", b.location); } catch (_) {}
    try { b.playAnimation("animation.boarder.boarding"); } catch (_) {}
    for (let i = 0; i < 3; i++) {
        try { dim.spawnParticle(TRAIL_PARTICLE, { x: ax, y: ay + 0.3, z: az }); } catch (_) {}
    }
    dlog("ancla + " + n + " a bordo" + (retries > 0 ? " (reintento " + retries + ")" : ""));
});

world.afterEvents.projectileHitEntity.subscribe((ev) => {
    const p = ev.projectile;
    if (!p || p.typeId !== HOOK_ID) return;

    const dim = ev.dimension;
    const b = resolveOwner(p, dim);
    let target = null;
    try { target = ev.getEntityHit().entity; } catch (_) {}
    // Gracia al nacer: roce con el dueno en <10 ticks no rompe el gancho
    // (los tiros dirigidos nacen pegados a el). Sin gracia se borraba solo.
    if (b && target) {
        try {
            if (target.id === b.id) {
                let born = -1000;
                try {
                    const v = hookBirth.get(p.id);
                    if (v !== undefined) born = v;
                } catch (_) {}
                let now = 0;
                try { now = system.currentTick; } catch (_) {}
                if (now - born < 10) return;
            }
        } catch (_) {}
    }
    try { p.remove(); } catch (_) {}
    try { pendingHooks.delete(p.id); } catch (_) {}
    try { hookBirth.delete(p.id); } catch (_) {}
    if (!b) return;

    let bl = null;
    try { bl = b.location; } catch (_) { return; }

    // Ignorar al propio dueno (el tiro nace pegado a el)
    if (target) {
        try { if (target.id === b.id) return; } catch (_) {}
    }
    if (jobs.has(b.id)) return;

    if (target && target.isValid) {
        // Jaloneo hacia el abordador (un tiron, sin atar)
        try {
            const tl = target.location;
            const dx = bl.x - tl.x;
            const dz = bl.z - tl.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            target.applyKnockback({ x: dx / len * 0.8, z: dz / len * 0.8 }, 0.4);
        } catch (_) {}
        let ax = 0, ay = 0, az = 0;
        try {
            const tl = target.location;
            ax = Math.floor(tl.x) + 0.5;
            ay = Math.floor(tl.y);
            az = Math.floor(tl.z) + 0.5;
        } catch (_) { return; }
        jobs.set(b.id, { hookId: null, anchor: { x: ax, y: ay, z: az }, preyId: target.id, age: 0, launched: false, launchAge: 0, pushAge: 0, pendingH: null, lastH2: 0, overChecks: 0, riders: [], retries: readRetries(b.id) });
        const n = boardRiders(b, jobs.get(b.id), dim);
        try { dim.playSound("random.anvil_land", b.location, { pitch: 0.7 }); } catch (_) {}
        try { b.playAnimation("animation.boarder.boarding"); } catch (_) {}
        try { dim.spawnParticle(TRAIL_PARTICLE, { x: ax, y: ay + 0.5, z: az }); } catch (_) {}
        dlog("enganche + " + n + " a bordo");
    }
});

world.afterEvents.entityDie.subscribe((ev) => {
    const e = ev.deadEntity;
    if (!e) return;
    try { aboardRiders.delete(e.id); } catch (_) {}
    try { lastShot.delete(e.id); } catch (_) {}
    if (e.typeId !== BOARDER_ID) return;
    cancelJob(e.id);
});

// Watchdog hibrido cada 5s: si el vanilla no dispara teniendo presa a tiro
// (8-24 bloques), tiro dirigido por encima de la presa. Nunca ametralla:
// lastShot manda y el intervalo es largo. Barato: 1 getEntities por boarder.
system.runInterval(() => {
    let now = 0;
    try { now = system.currentTick; } catch (_) { return; }
    for (const dimId of DIMENSIONS) {
        let dimension = null;
        try { dimension = world.getDimension(dimId); } catch (_) { continue; }
        let boarders = [];
        try { boarders = dimension.getEntities({ type: BOARDER_ID }); } catch (_) { continue; }
        for (const b of boarders) {
            try {
                if (!b.isValid) continue;
                if (jobs.has(b.id)) continue; // ya izando
                let last = 0;
                try { last = lastShot.get(b.id) || 0; } catch (_) {}
                if (now - last < 160) continue; // tiro hace <8s: colabora
                const prey = findBoardPrey(b);
                if (!prey) continue;
                const bl = b.location;
                const pl = prey.location;
                const pdx = pl.x - bl.x;
                const pdz = pl.z - bl.z;
                const pd2 = pdx * pdx + pdz * pdz;
                if (pd2 < 64 || pd2 > 576) continue; // solo anillo 8..24
                fireDirected(b, prey);
            } catch (_) {}
        }
    }
}, 100);

function fireDirected(b, prey) {
    // Tiro scripteado POR ENCIMA de la presa (el vanilla apunta al pecho y
    // muere en el muro bajo). Nace a ojos +1.2 al frente, arco con caida
    // compensada (gravity 0.01 del gancho). Registra dueno y nacimiento.
    let dim = null, bl = null, pl = null;
    try { dim = b.dimension; bl = b.location; } catch (_) { return false; }
    try { pl = prey.location; } catch (_) { return false; }
    const G = 0.01;
    const tx = pl.x, ty = pl.y + 2.5, tz = pl.z; // mira: cabeza +2
    const sx = bl.x, sy = bl.y + 1.5, sz = bl.z; // sale: ojos
    const ddx = tx - sx, ddz = tz - sz;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
    let T = 8 + dist * 0.8;
    if (T < 10) T = 10;
    if (T > 30) T = 30;
    const vx = ddx / T;
    const vz = ddz / T;
    let vy = (ty - sy) / T + 0.5 * G * T;
    if (vy > 3) vy = 3;
    if (vy < -1) vy = -1;
    let hook = null;
    try {
        hook = dim.spawnEntity(HOOK_ID, {
            x: sx + ddx / dist * 1.2,
            y: sy,
            z: sz + ddz / dist * 1.2
        });
    } catch (_) { return false; }
    if (!hook) return false;
    try { hook.applyImpulse({ x: vx, y: vy, z: vz }); } catch (_) {}
    let now = 0;
    try { now = system.currentTick; } catch (_) {}
    try {
        pendingHooks.set(hook.id, b.id);
        hookBirth.set(hook.id, now);
        lastShot.set(b.id, now);
        if (lastShot.size > 60) lastShot.clear();
    } catch (_) {}
    try { dim.playSound("random.bow", bl); } catch (_) {}
    dlog("tiro dirigido! dist=" + dist.toFixed(1));
    return true;
}
