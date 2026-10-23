import { system } from "@minecraft/server";

const ITEM_ID = "udaw:battle_horn";
const MUSKETEER = "udaw:musketeer";
const SECOND_SQUAD_TYPES = [MUSKETEER, "udaw:pikeman", "udaw:swordman"];
const SQUAD_SIZE = 5;
const ARRIVAL_DELAY = 200;
const DEPARTURE_DELAY = 6000;

function isValid(entity) {
    try {
        return entity.isValid;
    } catch (_) {
        return false;
    }
}

function setUpFollower(entity, player) {
    const tameable = entity.getComponent("minecraft:tameable");
    if (!tameable || !tameable.tame(player)) {
        throw new Error(`Could not assign ${entity.typeId} to player ${player.id}`);
    }
}

function spawnSquad(player, typeId, squadIndex, members) {
    const center = player.location;
    const spacing = squadIndex === 0 ? 3 : -3;
    const offsets = [
        [0, 0],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
    ];

    for (const [dx, dz] of offsets) {
        const location = {
            x: center.x + spacing + dx,
            y: center.y,
            z: center.z + dz,
        };
        let member;
        try {
            member = player.dimension.spawnEntity(typeId, location);
            setUpFollower(member, player);
            members.push(member);
        } catch (error) {
            if (member && isValid(member)) member.remove();
            console.warn(`[battle_horn] Could not spawn ${typeId}: ${error}`);
        }
    }
}

function callReinforcements(player) {
    if (!isValid(player)) return;

    const members = [];
    const otherType = SECOND_SQUAD_TYPES[Math.floor(Math.random() * SECOND_SQUAD_TYPES.length)];
    spawnSquad(player, MUSKETEER, 0, members);
    spawnSquad(player, otherType, 1, members);

    if (members.length < SQUAD_SIZE * 2) {
        player.sendMessage({ translate: "udaw.battle_horn.partial" });
    }

    system.runTimeout(() => {
        for (const member of members) {
            if (isValid(member)) member.remove();
        }
        if (isValid(player)) {
            player.sendMessage({ translate: "udaw.battle_horn.departed" });
        }
    }, DEPARTURE_DELAY);
}

system.beforeEvents.startup.subscribe((event) => {
    event.itemComponentRegistry.registerCustomComponent(ITEM_ID, {
        onUse(useEvent) {
            const player = useEvent.source;
            if (player.typeId !== "minecraft:player" || useEvent.itemStack?.typeId !== ITEM_ID) return;

            player.dimension.playSound("item.goat_horn.sound.0", player.location);
            player.sendMessage({ translate: "udaw.battle_horn.arriving" });

            system.runTimeout(() => callReinforcements(player), ARRIVAL_DELAY);
        },
    });
});
