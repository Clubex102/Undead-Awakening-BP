import { world, system, GameMode } from "@minecraft/server";

const HOSTILE_ID = "udaw:big_ship_hostile";
const NATURAL_TAG = "udaw_natural_encounter";
const COOLDOWN = 6000;
const IDLE_DESPAWN = 3600;
const NEARBY_RADIUS = 160;
const PLAYER_RADIUS = 96;

const cooldowns = new Map();
const idle = new Map();

function isWater(dim, x, y, z) {
    try {
        return dim.getBlock({ x, y, z })?.typeId === "minecraft:water";
    } catch (_) {
        return false;
    }
}

function isOcean(dim, x, y, z) {
    try {
        return dim.getBiome({ x, y, z }).id.includes("ocean");
    } catch (_) {
        return false;
    }
}

function oceanSpot(dim, center) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 30;
        const x = Math.round(center.x + Math.cos(angle) * dist);
        const z = Math.round(center.z + Math.sin(angle) * dist);

        for (let y = 100; y >= 40; y--) {
            if (!isWater(dim, x, y, z)) continue;
            if (!isWater(dim, x, y - 2, z)) continue;
            if (isWater(dim, x, y + 1, z)) continue;
            if (!isOcean(dim, x, y, z)) continue;

            let open = true;
            for (let dx = -4; dx <= 4 && open; dx += 2) {
                for (let dz = -4; dz <= 4; dz += 2) {
                    if (
                        !isWater(dim, x + dx, y, z + dz) ||
                        !isWater(dim, x + dx, y - 1, z + dz)
                    ) {
                        open = false;
                        break;
                    }
                }
            }
            if (open) return { x: x + 0.5, y: y + 1.6, z: z + 0.5 };
        }
    }
    return undefined;
}

function nearbyShip(dim, location) {
    try {
        return dim.getEntities({ type: HOSTILE_ID, location, maxDistance: NEARBY_RADIUS })[0];
    } catch (_) {
        return undefined;
    }
}

function trySpawn(player) {
    const dimId = player.dimension.id;
    if (dimId !== "minecraft:overworld" && dimId !== "overworld") return;

    const mode = player.getGameMode();
    if (mode === GameMode.Creative || mode === GameMode.Spectator) return;

    const now = system.currentTick;
    const ready = cooldowns.get(player.id) ?? 0;
    if (now < ready) return;

    const dim = player.dimension;
    if (nearbyShip(dim, player.location)) return;

    const spot = oceanSpot(dim, player.location);
    if (!spot) return;

    try {
        const ship = dim.spawnEntity(HOSTILE_ID, spot);
        ship.addTag(NATURAL_TAG);
        idle.set(ship.id, 0);
        cooldowns.set(player.id, now + COOLDOWN);
    } catch (_) {}
}

system.runInterval(() => {
    for (const player of world.getPlayers()) {
        try { trySpawn(player); } catch (_) {}
    }
}, 200);

system.runInterval(() => {
    const seen = new Set();

    for (const dimName of ["overworld", "nether", "the_end"]) {
        let dim;
        try { dim = world.getDimension(dimName); } catch (_) { continue; }

        let ships = [];
        try { ships = dim.getEntities({ type: HOSTILE_ID }); } catch (_) {}
        for (const ship of ships) {
            let natural = false;
            try { natural = ship.hasTag(NATURAL_TAG); } catch (_) {}
            if (!natural) continue;

            seen.add(ship.id);
            let near = false;
            try {
                near = dim.getPlayers({ location: ship.location, maxDistance: PLAYER_RADIUS }).length > 0;
            } catch (_) {}

            const ticks = near ? 0 : (idle.get(ship.id) ?? 0) + 40;
            if (ticks > IDLE_DESPAWN) {
                try { ship.remove(); } catch (_) {}
                idle.delete(ship.id);
                continue;
            }
            idle.set(ship.id, ticks);
        }
    }

    for (const id of idle.keys()) {
        if (!seen.has(id)) idle.delete(id);
    }
}, 40);
