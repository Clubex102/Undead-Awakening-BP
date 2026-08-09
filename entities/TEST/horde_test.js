import {
    world,
    system
} from "@minecraft/server";
//code provide by kaelus, developer from forgotten legends whith permission to use and modify for this project
/* =========================================================
   ORC HORDE SYSTEM
   Persistent + Optimized Version
   Minecraft Bedrock Script API
========================================================= */

/* =========================================================
   CONFIG
========================================================= */

const DEBUG = true;

/* =========================
   PERFORMANCE
========================= */

const SCAN_INTERVAL = 80;
const WORLD_LOOP_INTERVAL = 1200;

/* =========================
   RAID SETTINGS
========================= */

const RAID_COOLDOWN = 7200;
const AMBUSH_COOLDOWN = 2400;

/* =========================
   DYNAMIC PROPERTY KEYS
========================= */

const DP_AGGRESSION = "fc:aggression";
const DP_LAST_RAID = "fc:last_raid";
const DP_LAST_AMBUSH = "fc:last_ambush";

/* =========================================================
   VALID HORDE ENTITIES
========================================================= */

const VALID_ENTITIES = [

    "fc:wild_orc",
    "fc:orc_berserker",
    "fc:orc_ringleader",
    "fc:orc_warlord",
    "fc:fc_warg",
    "fc:snagarc",
    "fc:fc_fire_drake"

];

/* =========================================================
   UNITS
========================================================= */

const AMBUSH_UNITS = [

    "fc:wild_orc",
    "fc:snagarc",
    "fc:fc_warg"

];

const RAID_UNITS = [

    "fc:wild_orc",
    "fc:orc_berserker",
    "fc:snagarc",
    "fc:fc_warg"

];

const PATROL_UNITS = [

    "fc:wild_orc",
    "fc:snagarc"

];

/* =========================================================
   HELPERS
========================================================= */

function randomBetween(min, max) {

    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}

function randomChoice(array) {

    return array[
        Math.floor(
            Math.random() * array.length
        )
    ];
}

function isValidOrc(entity) {

    return VALID_ENTITIES.includes(
        entity.typeId
    );
}

/* =========================================================
   DYNAMIC PROPERTY HELPERS
========================================================= */

function getNumberDP(
    player,
    key,
    fallback = 0
) {

    const value =
        player.getDynamicProperty(key);

    return typeof value === "number"
        ? value
        : fallback;
}

function setNumberDP(
    player,
    key,
    value
) {

    player.setDynamicProperty(
        key,
        value
    );
}

function getAggression(player) {

    return getNumberDP(
        player,
        DP_AGGRESSION,
        0
    );
}

function setAggression(
    player,
    value
) {

    setNumberDP(
        player,
        DP_AGGRESSION,
        value
    );
}

function getLastRaid(player) {

    return getNumberDP(
        player,
        DP_LAST_RAID,
        0
    );
}

function setLastRaid(
    player,
    value
) {

    setNumberDP(
        player,
        DP_LAST_RAID,
        value
    );
}

function getLastAmbush(player) {

    return getNumberDP(
        player,
        DP_LAST_AMBUSH,
        0
    );
}

function setLastAmbush(
    player,
    value
) {

    setNumberDP(
        player,
        DP_LAST_AMBUSH,
        value
    );
}

/* =========================================================
   GROUND DETECTION
========================================================= */

function findGround(
    dimension,
    x,
    startY,
    z
) {

    for (let y = startY; y > -64; y--) {

        const block =
            dimension.getBlock({

                x: Math.floor(x),
                y: Math.floor(y),
                z: Math.floor(z)

            });

        if (!block) continue;

        if (
            block.typeId !==
            "minecraft:air"
        ) {

            return y + 1;
        }
    }

    return startY;
}

/* =========================================================
   ENTITY CONFIGURATION
========================================================= */

function configureEntity(
    entity,
    mode
) {

    if (!entity?.isValid()) return;

    switch (mode) {

        case "patrol":

            entity.addTag("patrol");

        break;

        case "ambush":

            entity.addTag("ambush");
            entity.addTag("hunter");

            entity.nameTag =
                "§6AMBUSH";

        break;

        case "raid":

            entity.addTag("raid");
            entity.addTag("hunter");
            entity.addTag("horde");

            entity.nameTag =
                "§cHORDE";

        break;

        case "warlord":

            entity.addTag("raid");
            entity.addTag("hunter");
            entity.addTag("boss");
            entity.addTag("warlord");

            entity.nameTag =
                "§4WARLORD";

        break;
    }

    applyState(entity);
}

/* =========================================================
   APPLY STATES
========================================================= */

function applyState(entity) {

    if (!entity?.isValid()) return;

    try {

        /* =========================
           PATROL
        ========================= */

        if (entity.hasTag("patrol")) {

            entity.triggerEvent(
                "fc:set_patrol"
            );

            return;
        }

        /* =========================
           AMBUSH
        ========================= */

        if (entity.hasTag("ambush")) {

            entity.triggerEvent(
                "fc:set_ambush"
            );

            return;
        }

        /* =========================
           WARLORD
        ========================= */

        if (entity.hasTag("warlord")) {

            entity.triggerEvent(
                "fc:set_warlord"
            );

            return;
        }

        /* =========================
           RAID
        ========================= */

        if (
            entity.hasTag("raid") &&
            !entity.hasTag("boss")
        ) {

            entity.triggerEvent(
                "fc:set_raid"
            );

            return;
        }

    } catch (e) {

        if (DEBUG) {

            console.warn(
                `Failed applying state to ${entity.typeId}`
            );
        }
    }
}

/* =========================================================
   PASSIVE SCANNER
========================================================= */

system.runInterval(() => {

    for (const player of world.getPlayers()) {

        const nearby =
            player.dimension.getEntities({

                location:
                    player.location,

                maxDistance: 128,

                excludeTypes: [
                    "minecraft:item",
                    "minecraft:xp_orb"
                ]

            });

        for (const entity of nearby) {

            if (!entity?.isValid()) continue;

            if (!isValidOrc(entity)) continue;

            applyState(entity);
        }
    }

}, SCAN_INTERVAL);

/* =========================================================
   ENTITY SPAWNING
========================================================= */

function spawnConfiguredEntity(
    entityId,
    dimension,
    location,
    mode
) {

    try {

        const entity =
            dimension.spawnEntity(
                entityId,
                location
            );

        configureEntity(
            entity,
            mode
        );

        return entity;

    } catch (e) {

        if (DEBUG) {

            console.warn(
                `Failed spawning ${entityId}`
            );
        }
    }
}

/* =========================================================
   ATMOSPHERE
========================================================= */

function playRaidHorn(player) {

    try {

        player.runCommandAsync(
            "playsound raid.horn @a[r=128]"
        );

    } catch (e) {}
}

function startStorm() {

    try {

        world
            .getDimension("overworld")
            .runCommandAsync(
                "weather thunder"
            );

    } catch (e) {}
}

/* =========================================================
   PATROLS
========================================================= */

function spawnPatrol(player) {

    const dimension =
        player.dimension;

    const base =
        player.location;

    const amount =
        randomBetween(2, 5);

    for (let i = 0; i < amount; i++) {

        const angle =
            Math.random() *
            Math.PI * 2;

        const distance =
            randomBetween(50, 90);

        const x =
            base.x +
            Math.cos(angle) * distance;

        const z =
            base.z +
            Math.sin(angle) * distance;

        const y =
            findGround(
                dimension,
                x,
                base.y + 50,
                z
            );

        spawnConfiguredEntity(

            randomChoice(
                PATROL_UNITS
            ),

            dimension,

            {
                x: x,
                y: y,
                z: z
            },

            "patrol"
        );
    }

    player.onScreenDisplay
        .setActionBar(

            "§7Movement appears in the distance..."
        );
}

/* =========================================================
   AMBUSH
========================================================= */

function startAmbush(player) {

    const current =
        system.currentTick;

    const lastAmbush =
        getLastAmbush(player);

    if (
        current - lastAmbush <
        AMBUSH_COOLDOWN
    ) return;

    setLastAmbush(
        player,
        current
    );

    const dimension =
        player.dimension;

    const base =
        player.location;

    player.onScreenDisplay
        .setActionBar(
            "§6You feel watched..."
        );

    try {

        player.runCommandAsync(
            "playsound mob.wolf.howl @a[r=48]"
        );

    } catch (e) {}

    system.runTimeout(() => {

        const amount =
            randomBetween(3, 6);

        for (let i = 0; i < amount; i++) {

            const angle =
                Math.random() *
                Math.PI * 2;

            const distance =
                randomBetween(18, 30);

            const x =
                base.x +
                Math.cos(angle) * distance;

            const z =
                base.z +
                Math.sin(angle) * distance;

            const y =
                findGround(
                    dimension,
                    x,
                    base.y + 35,
                    z
                );

            spawnConfiguredEntity(

                randomChoice(
                    AMBUSH_UNITS
                ),

                dimension,

                {
                    x: x,
                    y: y,
                    z: z
                },

                "ambush"
            );
        }

        player.sendMessage(
            "§6An ambush emerges nearby."
        );

    }, 120);
}

/* =========================================================
   RAID WAVE
========================================================= */

function spawnRaidWave(
    player,
    amount
) {

    const dimension =
        player.dimension;

    const base =
        player.location;

    for (let i = 0; i < amount; i++) {

        const angle =
            Math.random() *
            Math.PI * 2;

        const distance =
            randomBetween(45, 90);

        const x =
            base.x +
            Math.cos(angle) * distance;

        const z =
            base.z +
            Math.sin(angle) * distance;

        const y =
            findGround(
                dimension,
                x,
                base.y + 60,
                z
            );

        spawnConfiguredEntity(

            randomChoice(
                RAID_UNITS
            ),

            dimension,

            {
                x: x,
                y: y,
                z: z
            },

            "raid"
        );
    }
}

/* =========================================================
   BOSSES
========================================================= */

function spawnRingleader(player) {

    const dimension =
        player.dimension;

    const base =
        player.location;

    const x =
        base.x +
        randomBetween(30, 45);

    const z =
        base.z +
        randomBetween(30, 45);

    const y =
        findGround(
            dimension,
            x,
            base.y + 60,
            z
        );

    spawnConfiguredEntity(

        "fc:orc_ringleader",

        dimension,

        {
            x: x,
            y: y,
            z: z
        },

        "raid"
    );
}

function spawnWarlord(player) {

    const dimension =
        player.dimension;

    const base =
        player.location;

    const x =
        base.x +
        randomBetween(40, 60);

    const z =
        base.z +
        randomBetween(40, 60);

    const y =
        findGround(
            dimension,
            x,
            base.y + 60,
            z
        );

    spawnConfiguredEntity(

        "fc:orc_warlord",

        dimension,

        {
            x: x,
            y: y,
            z: z
        },

        "warlord"
    );
}

function spawnFireDrake(player) {

    const dimension =
        player.dimension;

    const base =
        player.location;

    const angle =
        Math.random() *
        Math.PI * 2;

    const distance =
        randomBetween(55, 80);

    const x =
        base.x +
        Math.cos(angle) * distance;

    const z =
        base.z +
        Math.sin(angle) * distance;

    const y =
        findGround(
            dimension,
            x,
            base.y + 80,
            z
        );

    spawnConfiguredEntity(

        "fc:fc_fire_drake",

        dimension,

        {
            x: x,
            y: y + 8,
            z: z
        },

        "raid"
    );
}

/* =========================================================
   RAIDS
========================================================= */

function startRaid(
    player,
    warlord = false
) {

    const current =
        system.currentTick;

    const lastRaid =
        getLastRaid(player);

    if (
        current - lastRaid <
        RAID_COOLDOWN
    ) {

        player.sendMessage(
            "§cThe Horde is regrouping..."
        );

        return;
    }

    setLastRaid(
        player,
        current
    );

    playRaidHorn(player);

    startStorm();

    player.onScreenDisplay
        .setTitle(

            "§4§lORC HORDE",

            {
                fadeInDuration: 30,
                stayDuration: 180,
                fadeOutDuration: 40,

                subtitle:
                    "§cWar drums echo across the land..."
            }
        );

    player.sendMessage(
        "§4§lAn Orc Horde approaches."
    );

    /* =========================
       WAVE 1
    ========================= */

    system.runTimeout(() => {

        spawnRaidWave(
            player,
            randomBetween(8, 14)
        );

    }, 160);

    /* =========================
       WAVE 2
    ========================= */

    system.runTimeout(() => {

        playRaidHorn(player);

        player.sendMessage(
            "§6More warbands emerge nearby..."
        );

        spawnRaidWave(
            player,
            randomBetween(12, 18)
        );

    }, 700);

    /* =========================
       WAVE 3
    ========================= */

    system.runTimeout(() => {

        player.sendMessage(
            "§cThe Horde grows stronger..."
        );

        spawnRaidWave(
            player,
            randomBetween(14, 22)
        );

    }, 1300);

    /* =========================
       BOSSES
    ========================= */

    system.runTimeout(() => {

        spawnRingleader(player);

        player.sendMessage(
            "§cAn Orc Ringleader commands the Horde!"
        );

        if (warlord) {

            system.runTimeout(() => {

                playRaidHorn(player);

                player.onScreenDisplay
                    .setTitle(

                        "§4§lWARLORD",

                        {
                            fadeInDuration: 20,
                            stayDuration: 120,
                            fadeOutDuration: 20,

                            subtitle:
                                "§cThe Horde Leader enters battle"
                        }
                    );

                spawnWarlord(player);

                spawnFireDrake(player);

                player.sendMessage(
                    "§4A Fire Drake descends from the skies!"
                );

            }, 400);
        }

    }, 1800);
}

/* =========================================================
   WORLD LOOP
========================================================= */

system.runInterval(() => {

    for (const player of world.getPlayers()) {

        const aggression =
            getAggression(player);

        /* =========================
           RANDOM PATROLS
        ========================= */

        if (Math.random() < 0.02) {

            spawnPatrol(player);
        }

        /* =========================
           NIGHT AMBUSHES
        ========================= */

        const night =
            world.getTimeOfDay() > 13000;

        if (
            night &&
            Math.random() < 0.015
        ) {

            startAmbush(player);
        }

        /* =========================
           RAIDS
        ========================= */

        if (

            Math.random() <

            0.01 +

            (
                aggression * 0.0005
            )

        ) {

            startRaid(

                player,

                aggression >= 25
            );
        }
    }

}, WORLD_LOOP_INTERVAL);

/* =========================================================
   AGGRESSION
========================================================= */

world.afterEvents.entityDie.subscribe((event) => {

    const dead =
        event.deadEntity;

    const source =
        event.damageSource
            ?.damagingEntity;

    if (!source) return;

    if (
        source.typeId !==
        "minecraft:player"
    ) return;

    const player = source;

    if (

        dead.typeId === "fc:wild_orc" ||
        dead.typeId === "fc:orc_berserker" ||
        dead.typeId === "fc:orc_ringleader" ||
        dead.typeId === "fc:orc_warlord" ||
        dead.typeId === "fc:fc_warg" ||
        dead.typeId === "fc:snagarc" ||
        dead.typeId === "fc:fc_fire_drake"

    ) {

        let aggression =
            getAggression(player);

        aggression += 1;

        setAggression(
            player,
            aggression
        );

        if (aggression === 25) {

            player.sendMessage(
                "§6The Horde has noticed your actions..."
            );
        }

        if (aggression === 50) {

            player.sendMessage(
                "§4§lThe Horde seeks vengeance."
            );
        }
    }
});

/* =========================================================
   DEV TEST EVENTS
========================================================= */

system.afterEvents
.scriptEventReceive.subscribe((event) => {

    const player =
        event.sourceEntity;

    if (!player) return;

    if (
        player.typeId !==
        "minecraft:player"
    ) return;

    switch (event.id) {

        case "fc:test_ambush":

            startAmbush(player);

        break;

        case "fc:test_raid":

            startRaid(
                player,
                false
            );

        break;

        case "fc:test_warlord":

            startRaid(
                player,
                true
            );

        break;

        case "fc:test_patrol":

            spawnPatrol(player);

        break;
    }
});