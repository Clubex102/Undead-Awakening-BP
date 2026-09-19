import { world, system } from "@minecraft/server";

const BULLET_IDS = new Set(["udaw:bullet", "udaw:bullet2", "udaw:bullet3", "udaw:cannonbullet", "udaw:pillagerbullet", "udaw:pillagercannonbullet"]);
const TRAIL_INTERVAL = 4;
const SMOKE_PARTICLE = "udaw:gun_smoke";
const FIRE_PARTICLE = "udaw:fire";

// id -> {entity, x, y, z, still}. Solo echan humo en movimiento;
// quietas se olvidan para no apilar humo en el suelo.
const bullets = new Map();

// Suelo que la bala rasa vuelve esteril (coarse dirt) al impactar
const STERILE_SOIL = new Set([
    "minecraft:grass_block",
    "minecraft:dirt",
    "minecraft:coarse_dirt",
    "minecraft:sand",
    "minecraft:red_sand",
    "minecraft:gravel",
    "minecraft:mud",
    "minecraft:podzol",
    "minecraft:mycelium",
    "minecraft:farmland",
    "minecraft:dirt_with_roots"
]);

// Se atraviesan buscando el suelo (no frenan el parche)
const SCAN_THROUGH = new Set([
    "minecraft:air",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:tallgrass",
    "minecraft:short_grass",
    "minecraft:fern",
    "minecraft:large_fern",
    "minecraft:red_flower",
    "minecraft:yellow_flower",
    "minecraft:vine",
    "minecraft:snow_layer"
]);

function slugImpact(dimension, loc, bullet, prevX, prevZ) {
    const cx = Math.floor(loc.x);
    const cy = Math.floor(loc.y);
    const cz = Math.floor(loc.z);

    try { bullet.addTag("udaw:cratered"); } catch (_) {}

    // Tirador para acreditar bajas
    let shooter = null;
    try {
        const sid = bullet.getDynamicProperty("udaw:shooter");
        if (sid) shooter = world.getEntity(sid);
        if (shooter && !shooter.isValid) shooter = null;
    } catch (_) { shooter = null; }

    // Dano en area (3 bloques), sin romper nada
    let victims = [];
    try {
        victims = dimension.getEntities({
            location: { x: cx, y: cy, z: cz },
            maxDistance: 3,
            excludeTypes: ["minecraft:item", "minecraft:xp_orb", "udaw:cannon"]
        });
    } catch (_) {}
    for (const v of victims) {
        try {
            if (shooter && v.id === shooter.id) continue;
            const opts = { cause: "projectile" };
            if (shooter) opts.damagingEntity = shooter;
            v.applyDamage(10, opts);
        } catch (_) {}
    }

    // Polvo del impacto
    try {
        dimension.spawnParticle("udaw:gun_smoke", { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 });
        dimension.spawnParticle("udaw:gun_smoke", { x: cx + 0.5, y: cy + 1, z: cz + 0.5 });
    } catch (_) {}

    // Parche esteril 3x4: 3x3 + una fila extra en la direccion de llegada
    let fx = 0;
    let fz = 1;
    try {
        const dx = loc.x - prevX;
        const dz = loc.z - prevZ;
        if (Math.abs(dx) >= Math.abs(dz) && dx !== 0) { fx = dx > 0 ? 1 : -1; fz = 0; }
        else if (dz !== 0) { fx = 0; fz = dz > 0 ? 1 : -1; }
    } catch (_) {}

    const cells = [];
    for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
            cells.push({ x: cx + ox, z: cz + oz });
        }
    }
    for (let o = -1; o <= 1; o++) {
        cells.push({ x: cx + 2 * fx + (fz !== 0 ? o : 0), z: cz + 2 * fz + (fx !== 0 ? o : 0) });
    }

    for (const c of cells) {
        try {
            for (let y = cy + 2; y >= cy - 4; y--) {
                const b = dimension.getBlock({ x: c.x, y, z: c.z });
                if (!b) break;
                if (SCAN_THROUGH.has(b.typeId)) continue;
                // Primer bloque solido: si es suelo blando, hoyo + esteril debajo
                if (STERILE_SOIL.has(b.typeId)) {
                    dimension.runCommand(`setblock ${c.x} ${y} ${c.z} air destroy`);
                    try {
                        const below = dimension.getBlock({ x: c.x, y: y - 1, z: c.z });
                        if (below && STERILE_SOIL.has(below.typeId)) {
                            below.setType("minecraft:coarse_dirt");
                        }
                    } catch (_) {}
                }
                break;
            }
        } catch (_) {}
    }
}

world.afterEvents.entitySpawn.subscribe((ev) => {
    if (!BULLET_IDS.has(ev.entity.typeId)) return;
    try {
        const l = ev.entity.location;
        bullets.set(ev.entity.id, { entity: ev.entity, x: l.x, y: l.y, z: l.z, still: 0 });
        if (ev.entity.typeId === "udaw:cannonbullet") {
            console.warn("[slug] tracked " + ev.entity.id);
        }
    } catch (_) {}
});

system.runInterval(() => {
    for (const [id, rec] of bullets) {
        let loc = null;
        try {
            if (!rec.entity.isValid) { bullets.delete(id); continue; }
            loc = rec.entity.location;
        } catch (_) { bullets.delete(id); continue; }

        const dx = loc.x - rec.x;
        const dy = loc.y - rec.y;
        const dz = loc.z - rec.z;

        // Impacto de slug: al primer contacto con el suelo (reposo o rodando),
        // no esperando a que se quede quieta del todo (a veces despawnea antes)
        try {
            let onGround = false;
            try { onGround = !!rec.entity.isOnGround; } catch (_) {}
            if (onGround) {
                const isSlug = rec.entity.typeId === "udaw:cannonbullet" && rec.entity.hasTag("udaw:slug");
                let cratered = true;
                try { cratered = rec.entity.hasTag("udaw:cratered"); } catch (_) {}
                if (isSlug && !cratered) {
                    console.warn("[slug] IMPACTO en " + Math.floor(loc.x) + "," + Math.floor(loc.y) + "," + Math.floor(loc.z));
                    slugImpact(rec.entity.dimension, loc, rec.entity, rec.x, rec.z);
                }
            }
        } catch (_) {}

        if (dx * dx + dy * dy + dz * dz < 0.02) {
            rec.still++;
            if (rec.still > 5) bullets.delete(id);
            continue;
        }

        rec.x = loc.x;
        rec.y = loc.y;
        rec.z = loc.z;
        rec.still = 0;

        try {
            let fiery = false;
            try { fiery = rec.entity.typeId === "udaw:bullet3" || rec.entity.hasTag("udaw:inc"); } catch (_) {}
            rec.entity.dimension.spawnParticle(fiery ? FIRE_PARTICLE : SMOKE_PARTICLE, loc);
        } catch (_) {}
    }
}, TRAIL_INTERVAL);
