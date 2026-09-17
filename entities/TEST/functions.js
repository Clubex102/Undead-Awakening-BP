import * as server from "@minecraft/server"
import * as v3 from "./v3"

const world = server.world
const system = server.system

const transformThroughBp = [`minecraft:player`]

const notTransformIntoZombie = [`golem`, `blaze`, `magma`]

const zombieIdforFamily = { iron_golem: `udc:iron_golem`, silverfish: `udc:silverfish`, evoker: `udc:evoker`, evocation_illager: `udc:evoker`, pillager: `udc:pillager`, vindicator: `udc:vindicator`, slime: `udc:slime`, spider: `udc:spider`, creeper: `udc:zombie_creeper`, villager: `udc:zombie_villager_v2`, enderman: `udc:enderman`, hoglin: `minecraft:zoglin`, illager: `udc:illager` }

// ---------------------------------------------------------
// ZOMBIE FOOD MECHANIC STATE & HELPERS
// ---------------------------------------------------------
const playerEatingData = new Map();

// Hardcoded vanilla nutrition values since API omits the component
const vanillaFoodNutrition = {
    "minecraft:apple": 4, "minecraft:baked_potato": 5, "minecraft:beef": 3,
    "minecraft:beetroot": 1, "minecraft:beetroot_soup": 6, "minecraft:bread": 5,
    "minecraft:carrot": 3, "minecraft:chicken": 2, "minecraft:chorus_fruit": 4,
    "minecraft:cooked_beef": 8, "minecraft:cooked_chicken": 6, "minecraft:cooked_cod": 5,
    "minecraft:cooked_mutton": 6, "minecraft:cooked_porkchop": 8, "minecraft:cooked_rabbit": 5,
    "minecraft:cooked_salmon": 6, "minecraft:cookie": 2, "minecraft:dried_kelp": 1,
    "minecraft:enchanted_golden_apple": 4, "minecraft:glow_berries": 2, "minecraft:golden_apple": 4,
    "minecraft:golden_carrot": 6, "minecraft:honey_bottle": 6, "minecraft:melon_slice": 2,
    "minecraft:mushroom_stew": 6, "minecraft:mutton": 2, "minecraft:poisonous_potato": 2,
    "minecraft:porkchop": 3, "minecraft:potato": 1, "minecraft:pufferfish": 1,
    "minecraft:pumpkin_pie": 8, "minecraft:rabbit": 3, "minecraft:rabbit_stew": 10,
    "minecraft:cod": 2, "minecraft:salmon": 2, "minecraft:rotten_flesh": 4,
    "minecraft:spider_eye": 2, "minecraft:suspicious_stew": 6, "minecraft:sweet_berries": 2,
    "minecraft:tropical_fish": 1
};

export function startZombieFoodConsumption(player, itemStack) {
    if (!itemStack) return;

    let nutrition = 0;
    const typeId = itemStack.typeId;

    if (typeId.startsWith("minecraft:")) {
        nutrition = vanillaFoodNutrition[typeId] || 0;
    } else {
        const foodComp = itemStack.getComponent(`minecraft:food`);
        if (foodComp) nutrition = foodComp.nutrition;
    }

    if (nutrition > 0) {
        const hungerComp = player.getComponent(`minecraft:player.hunger`);
        const currentHunger = hungerComp ? hungerComp.currentValue : 20;

        // Save state at the exact moment they start eating
        playerEatingData.set(player.id, {
            startHunger: currentHunger,
            itemId: typeId,
            startAmount: itemStack.amount,
            nutrition: nutrition
        });
        console.warn(`[Zombie Food] ${player.name} started eating ${typeId}. Start hunger: ${currentHunger}, Nutrition: ${nutrition}`);
    }
}

export function handleZombieFoodConsumption(player, currentItemStack) {
    const data = playerEatingData.get(player.id);
    if (!data) return;

    let ate = false;

    // Condition 1: Was 1 item, now the stack is gone completely
    if (!currentItemStack && data.startAmount === 1) ate = true;
    // Condition 2: Still same item type, but amount decreased
    else if (currentItemStack && currentItemStack.typeId === data.itemId && currentItemStack.amount < data.startAmount) ate = true;
    // Condition 3: Item type changed (like Mushroom Stew -> Bowl)
    else if (currentItemStack && currentItemStack.typeId !== data.itemId) ate = true;

    // Condition 4 (Fallback): If the game already gave the player the hunger points
    const hungerComp = player.getComponent(`minecraft:player.hunger`);
    if (hungerComp && hungerComp.currentValue > data.startHunger) {
        ate = true;
    }

    if (ate) {
        // Immediately remove data so a delayed stopUse doesn't process it twice
        playerEatingData.delete(player.id);

        // Wait 1 tick to let vanilla game fully apply its hunger first, then overwrite
        system.run(() => {
            if (player.isValid) {
                const updatedHungerComp = player.getComponent(`minecraft:player.hunger`);
                if (updatedHungerComp) {
                    const targetHunger = Math.min(20, Math.floor(data.startHunger + (data.nutrition / 2)));
                    updatedHungerComp.setCurrentValue(targetHunger);
                    console.warn(`[Zombie Food] ${player.name} finished eating. Set hunger to ${targetHunger} (Halved from ${data.nutrition}).`);
                }
                player.addEffect(`hunger`, 5 * 20, { amplifier: 0 });
                console.warn(`[Zombie Food] Applied 5s of Hunger effect to ${player.name}.`);
            }
        });
    } else {
        // It might be a genuine cancel, OR it might be itemStopUse firing just before itemCompleteUse.
        // Delay cancellation by 1 tick to allow itemCompleteUse to process the data if it fires next.
        system.run(() => {
            if (playerEatingData.has(player.id)) {
                console.warn(`[Zombie Food] Cancelled or not eaten by ${player.name}.`);
                playerEatingData.delete(player.id);
            }
        });
    }
}
// ---------------------------------------------------------


export function ironGolemMelee2(entity) {
    const attackDuration = 20 * 0.5
    const r = 1.25
    const damage = 17
    const mobMultiplier = 2
    const initialTick = system.currentTick
    let affectedIds = new Set()
    let vd = entity.getViewDirection()
    vd = v3.normalize({ x: vd.x, y: 0, z: vd.z })

    const ids = system.runInterval(() => {
        if ((system.currentTick - initialTick) >= attackDuration || !entity.isValid) {
            system.clearRun(ids)
            try {
                entity.clearVelocity()
            } catch { }
        }
        entity.clearVelocity()
        entity.applyImpulse({ x: vd.x * 0.5, y: 0, z: vd.z * 0.5 })
        entity.dimension.getEntities({ location: entity.location, maxDistance: r, excludeFamilies: [`undead`], excludeTypes: [`minecraft:item`] }).forEach((e) => {
            const id = entity.id
            if (!affectedIds.has(id)) {
                if (e.applyDamage(damage, { cause: `entityAttack`, damagingEntity: entity })) {
                    try {
                        e.applyKnockback({ x: vd.x * 5, z: vd.z * 5 }, 0.5)
                    } catch { }

                } else if (e.typeId === `minecraft:player`) {
                    entity.triggerEvent(`stunned`)
                    const ride = entity.dimension.spawnEntity(`udc:zombie_iron_golem_stunned`, entity.location)
                    ride.getComponent(`minecraft:rideable`).addRider(entity)
                    ride.applyImpulse({ x: -vd.x * 0.75, y: 0.5, z: -vd.z * 0.75 })
                    try {
                        e.applyKnockback({ x: vd.x * 0.75, z: vd.z * 0.75 }, 0.5)
                    } catch { }
                    system.clearRun(ids)
                }

                affectedIds.add(id)
            }
        })
    })
}

export function soulIntoRandomZombie(entity) {
    const { dimension, location } = entity
    const health = entity.getComponent(`minecraft:health`).currentValue
    const basicZombies = [{ id: `udc:zombie`, weight: 40 }, { id: `udc:zombie_villager_v2`, weight: 20 }, { id: `udc:zombie_creeper`, weight: 35 }, { id: `udc:spider`, weight: 35 }, { id: `udc:pillager`, weight: 40 }, { id: `udc:vindicator`, weight: 30 }, { id: `udc:zombie_pigman`, weight: 30 }, { id: `udc:evoker`, weight: 20 }]

    const minibossZombies = [{ id: `udc:iron_golem`, weight: 40 }]

    const skinId = entity.getComponent(`minecraft:skin_id`).value
    let zombieId = undefined
    if (skinId <= 1) {
        zombieId = selectRandomByWeight(basicZombies).id
    } else {
        zombieId = selectRandomByWeight(minibossZombies).id
    }

    const zombie = dimension.spawnEntity(zombieId, location, { initialEvent: `minecraft:entity_spawned` })

    if (zombie.getComponent(`minecraft:health`).currentValue > health) {
        zombie.getComponent(`minecraft:health`).setCurrentValue(health)
    }

    entity.remove()
}


function selectRandomByWeight(items) {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);

    if (totalWeight === 0) {
        throw new Error("La suma de los pesos no puede ser 0.");
    }

    const random = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const item of items) {
        cumulativeWeight += item.weight;
        if (random < cumulativeWeight) {
            return item;
        }
    }
    throw new Error("Error al seleccionar un elemento.");
}


export function summonPatrolFollower(dimension, location, id = undefined) {
    const validFollowerIds = [{ id: `udc:vindicator`, weight: 4 }, { id: `udc:evoker`, weight: 1 }, { id: `udc:pillager`, weight: 4 }]
    let followerId = undefined
    if (id == undefined) {
        followerId = selectRandomByWeight(validFollowerIds).id
    } else {
        followerId = id
    }

    const follower = dimension.spawnEntity(followerId, location, { initialEvent: `from_patrol` })
    follower.applyKnockback({ x: Math.random() * 0.5, z: Math.random() * 0.5 }, 0)
}

export function validThrowTarget(entity) {
    const { dimension, location } = entity
    let valid = (entity.getComponent(`minecraft:health`)?.effectiveMax <= 50 && entity.getComponent(`minecraft:health`)?.effectiveMax >= 15 && entity.isOnGround && entity.typeId != `udc:spider`)
    const nearestValidTarget = dimension.getEntities({ location, excludeFamilies: [`undead`], maxDistance: 5 }).filter(e => e.matches({ families: [`player`] }) || e.matches({ families: [`mob`] }))[0]

    if (valid && !nearestValidTarget) {
        return true
    } else {
        return false
    }
}

export function transformToZombie(entity) {
    const { dimension, location, typeId } = entity

    dimension.spawnParticle(`udc:zombie_transform`, location)

    if (transformThroughBp.includes(typeId)) {
        return
    }

    // Ignore vanilla villagers so their built-in game components handle zombification
    if (typeId === `minecraft:villager_v2` || typeId === `minecraft:villager`) {
        return
    }

    if (entity.matches({ families: [`piglin`] })) {
        entity.triggerEvent(`become_zombie_event`)
        return
    }

    for (let i = 0; i < notTransformIntoZombie.length; i++) {
        if (entity.matches({ families: [notTransformIntoZombie[i]] })) {
            return
        }
    }

    const posibleFamilies = Object.keys(zombieIdforFamily)

    for (let i = 0; i < posibleFamilies.length; i++) {
        if (entity.matches({ families: [posibleFamilies[i]] }) || entity.typeId.includes(posibleFamilies[i])) {
            const v = entity.getVelocity()
            const r = entity.getRotation()
            const zombie = dimension.spawnEntity(zombieIdforFamily[posibleFamilies[i]], location, { initialEvent: `minecraft:entity_transformed` })
            entity.remove()
            zombie.runCommand(`kill @e[type=item,r=1]`)
            zombie.setRotation(r)
            zombie.applyImpulse(v)
            return
        }
    }

    const moundsToSpawn = Math.floor(entity.getComponent(`minecraft:health`).effectiveMax / 10)

    if (moundsToSpawn > 0) {
        entity.remove()
        let m = undefined
        for (let i = 0; i < moundsToSpawn; i++) {
            m = dimension.spawnEntity(`udc:fleshbound_soul`, location, { initialEvent: `minecraft:entity_spawned` })

            const forceX = -1 + 2 * Math.random()
            const forceZ = -1 + 2 * Math.random()
            const horizStrength = 3 + Math.random() * 2
            m.applyKnockback({ x: forceX * horizStrength, z: forceZ * horizStrength }, 0.5)
        }
        m.runCommand(`kill @e[type=item,r=1]`)
    }
}


export function followShootedhead(spider, target) {
    let sLocation, tLocation = undefined
    const tick5 = system.currentTick % 5
    const dimension = spider.dimension
    let continue_ = true
    spider.triggerEvent(`shoot_head`)
    const id = system.runInterval(() => {
        sLocation = spider?.getHeadLocation()
        try {
            tLocation = target?.location
        } catch {
            try { target.remove() } catch { }
            if (spider.matches({ tags: [`willPull`] })) {
                spider.removeTag(`willPull`)
            } else {
                try {
                    spider.triggerEvent(`melee`)
                } catch {

                }
            }
            system.clearRun(id)
        }

        const distance = v3.getDistanceVector(sLocation, tLocation)
        const { rx: rx, ry: ry, m: m } = v3.cartesianToSphere(distance)

        spider.setRotation({ x: rx, y: ry })

        if (system.currentTick % 5 == tick5) {
            const block = dimension.getBlockFromRay(tLocation, v3.scale(distance, -1), { maxDistance: m })?.block

            if (block || m > 60 || m < 2) {
                try {
                    spider.triggerEvent(`melee`)
                } catch {

                }
                system.clearRun(id)
            }
        }

        spider.setProperty(`udc:x_rotation`, rx)
        spider.setProperty(`udc:y_rotation`, ry)
        spider.setProperty(`udc:magnitude`, m)

    }, 1)
}

export function spiderPullTarget(spider, target, hitLocation) {

    let sLocation, tLocation = undefined
    const isPlayer = (target.typeId === `minecraft:player`)
    const dimension = spider.dimension
    let continue_ = true
    const headHitbox = spider.dimension.spawnEntity(`udc:spider_head_hitbox`, v3.add([target.location, hitLocation]), { initialEvent: `despawn_timer` })
    spider.triggerEvent(`shoot_head`)
    const id = system.runInterval(() => {

        try {
            sLocation = spider.getHeadLocation()
            tLocation = v3.add([target.location, hitLocation])
            headHitbox.teleport({ x: tLocation.x, y: tLocation.y - 0.25, z: tLocation.z })
            if (system.currentTick % 10 == 0) { headHitbox.triggerEvent(`despawn_timer`) }
        } catch {
            continue_ = false
        }

        if (!continue_ || !sLocation || !tLocation) {
            try {
                spider.triggerEvent(`melee`)
            } catch {

            }
            system.clearRun(id)
        }
        const distance = v3.add([tLocation, v3.scale(sLocation, -1)])
        const direction = v3.normalize(distance)
        const { rx, ry, m } = v3.cartesianToSphere(distance)

        spider.setRotation({ x: rx, y: ry })

        const block = dimension.getBlockFromRay(tLocation, v3.scale(distance, -1), { maxDistance: m })?.block

        if (block || m > 60 || m < 2) {
            try {
                spider.triggerEvent(`melee`)
            } catch {

            }
            system.clearRun(id)
        }

        spider.setProperty(`udc:x_rotation`, rx)
        spider.setProperty(`udc:y_rotation`, ry)
        spider.setProperty(`udc:magnitude`, m)

        if (system.currentTick % 2 == 0) {
            try {
                if (isPlayer) {
                    target.applyKnockback({ x: -direction.x * 0.5, z: -direction.z * 0.5 }, -direction.y * 0.5)
                } else {
                    target.applyKnockback({ x: -direction.x * 0.5, z: -direction.z * 0.5 }, -direction.y * 0.5)
                    target.applyImpulse(v3.scale(direction, -0.25))
                }
            } catch {

            }
        }
    }, 1)
}


function getNearestValidTarget(zombie) {
    const dimension = zombie.dimension;
    const loc = zombie.location;

    const queryOptions = {
        location: loc,
        maxDistance: 30,
        excludeFamilies: ["undead"]
    };

    const potentialTargets = dimension.getEntities(queryOptions);
    let nearestTarget = null;
    let minDistance = Infinity;

    for (const entity of potentialTargets) {
        if (entity.id === zombie.id) continue;
        if (entity.matches({ families: ["undead"] })) continue;

        if (entity.typeId === "minecraft:player") {
            // FIX: Use the server.GameMode enum instead of raw strings!
            const isValidPlayer = entity.matches({
                excludeGameModes: [server.GameMode.Creative, server.GameMode.Spectator]
            });
            if (!isValidPlayer) continue;
        }

        let maxDistForType = -1;

        if (
            entity.matches({ families: ["player"] }) ||
            entity.matches({ families: ["irongolem"] }) ||
            entity.matches({ families: ["snowgolem"] })
        ) {
            maxDistForType = 30;
        } else if (
            entity.matches({ families: ["villager"] }) ||
            entity.matches({ families: ["wandering_trader"] })
        ) {
            maxDistForType = 25;
        } else if (entity.matches({ families: ["mob"] })) {
            maxDistForType = 10;
        }

        if (maxDistForType === -1) continue;

        const dx = entity.location.x - loc.x;
        const dy = entity.location.y - loc.y;
        const dz = entity.location.z - loc.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance <= maxDistForType && distance < minDistance) {
            minDistance = distance;
            nearestTarget = entity;
        }
    }

    return nearestTarget;
}

export function getMiningTargetBlocks(zombie) {
    const loc = zombie.location;
    const target = getNearestValidTarget(zombie);

    let isUp = false;
    let isDown = false;
    let fwdX = 0;
    let fwdZ = 0;

    let targetVec = { x: 0, y: 0, z: 0 };

    if (target) {
        const targetLoc = target.location;

        const deltaY = Math.floor(targetLoc.y) - Math.floor(loc.y);
        if (deltaY > 0) isUp = true;
        else if (deltaY < 0) isDown = true;

        const distVec = v3.getDistanceVector(loc, targetLoc);
        targetVec = v3.normalize(distVec);

        const horizVec = { x: distVec.x, y: 0, z: distVec.z };
        if (horizVec.x !== 0 || horizVec.z !== 0) {
            const normVec = v3.normalize(horizVec);
            fwdX = Math.round(normVec.x);
            fwdZ = Math.round(normVec.z);

            if (fwdX !== 0 && fwdZ !== 0) {
                if (Math.random() < 0.5) fwdX = 0;
                else fwdZ = 0;
            }
        }
    } else {
        const view = zombie.getViewDirection();
        targetVec = view;

        if (view.y > 0.5) isUp = true;
        else if (view.y < -0.5) isDown = true;

        fwdX = Math.round(view.x);
        fwdZ = Math.round(view.z);

        if (fwdX !== 0 && fwdZ !== 0) {
            if (Math.random() < 0.5) fwdX = 0;
            else fwdZ = 0;
        }
    }

    const baseX = Math.floor(loc.x);
    const baseY = Math.floor(loc.y);
    const baseZ = Math.floor(loc.z);
    let positions = [];

    if (isUp) {
        positions = [
            { x: baseX, y: baseY + 2, z: baseZ },
            { x: baseX + fwdX, y: baseY + 2, z: baseZ + fwdZ },
            { x: baseX + fwdX, y: baseY + 1, z: baseZ + fwdZ }
        ];
    } else if (isDown) {
        positions = [
            { x: baseX, y: baseY - 1, z: baseZ },
            { x: baseX + fwdX, y: baseY - 1, z: baseZ + fwdZ },
            { x: baseX + fwdX, y: baseY, z: baseZ + fwdZ }
        ];
    } else {
        positions = [
            { x: baseX + fwdX, y: baseY + 1, z: baseZ + fwdZ },
            { x: baseX + fwdX, y: baseY, z: baseZ + fwdZ }
        ];
    }

    return { positions, targetVec };
}

export function canZombieBreakBlock(block, isAxe, isShovel, isPickaxe, isHeavyPickaxe) {
    const blockId = block.typeId.replace("minecraft:", "");

    const generalKeywords = [
        "moss", "leaves", "kelp", "wart", "hay", "sponge", "shroomlight",
        "target", "azalea", "sculk", "froglight", "propagule"
    ];
    if (generalKeywords.some(kw => blockId.includes(kw))) return true;

    if (isShovel) {
        const shovelKeywords = [
            "gravel", "grass", "dirt", "farmland", "sand", "snow",
            "concretepowder", "podzol", "mycelium", "clay", "soul", "mud"
        ];
        if (shovelKeywords.some(kw => blockId.includes(kw))) return true;
    }

    if (isAxe) {
        const axeKeywords = [
            "sign", "log", "door", "fence", "planks", "stairs", "slab",
            "pressure_plate", "button", "loom", "lichen", "cocoa",
            "campfire", "bamboo", "stem", "hyphae", "scaffolding",
            "jukebox", "bee", "table", "composter", "noteblock",
            "chest", "chorus", "melon", "bookshelf", "lectern", "pumpkin", "wood"
        ];
        if (block.hasTag("wood") || axeKeywords.some(kw => blockId.includes(kw))) return true;
    }

    if (isHeavyPickaxe) {
        const heavyPickaxeKeywords = [
            "obsidian", "ancient_debris", "respawn_anchor", "diamond_block", "netherite_block"
        ];
        if (heavyPickaxeKeywords.some(kw => blockId.includes(kw))) return true;
    }

    if (isPickaxe) {
        const pickaxeKeywords = [
            "stone", "ore", "deepslate", "glass", "ice", "coral", "basalt",
            "quartz", "terracotta", "brick", "iron", "gold", "emerald", "redstone",
            "copper", "coal" , "amethyst", "tuff", "dripstone", "calcite", "lantern",
            "furnace", "smoker", "dispenser", "dropper", "observer", "rail",
            "prismarine", "purpur", "magma", "conduit", "spawner"
        ];
        if (block.hasTag("stone") || block.hasTag("metal") || pickaxeKeywords.some(kw => blockId.includes(kw))) return true;
    }

    return false;
}

// ---------------------------------------------------------
// PATHFINDING STATE TRACKING
// ---------------------------------------------------------
// Per-zombie state that must persist across separate calls to
// handleZombieBuilding and handleZombieMining (module-level, keyed by entity id).
const positionHistory = new Map();
const forceUnstick = new Map();
const activeBuildingJobs = new Map(); 
const activeMiningJobs = new Map();

export function handleZombieBuilding(zombie) {
    if (!zombie.isValid) {
        if (zombie) {
            positionHistory.delete(zombie.id);
            forceUnstick.delete(zombie.id);
            if (activeBuildingJobs.has(zombie.id)) {
                system.clearJob(activeBuildingJobs.get(zombie.id));
                activeBuildingJobs.delete(zombie.id);
            }
        }
        return;
    }
    
    if (!zombie.isOnGround) return;
    if (activeBuildingJobs.has(zombie.id)) return;

    const target = getNearestValidTarget(zombie);
    if (!target || !target.isValid) return;

    const loc = zombie.location;
    const tLoc = target.location;
    const dimension = zombie.dimension;

    const blockType = zombie.typeId.toLowerCase().includes("pig") ? "minecraft:netherrack" : "minecraft:dirt";

    const locX = Math.floor(loc.x);
    const locY = Math.floor(loc.y);
    const locZ = Math.floor(loc.z);

    // ---------- Stuck detection ----------
    let history = positionHistory.get(zombie.id) || [];
    history = [...history, { x: locX, y: locY, z: locZ }].slice(-3);
    positionHistory.set(zombie.id, history);

    const isStuck = history.length === 3 &&
        history.every(p => p.x === history[0].x && p.y === history[0].y && p.z === history[0].z);

    // ---------- Block helpers ----------
    const isReplaceable = (block) => {
        if (!block) return false;
        const id = block.typeId;
        if (id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water") return true;
        const replaceables = ["tallgrass", "lava", "snow_layer", "flower", "vines", "kelp", "fern"];
        return replaceables.some(tag => id.includes(tag));
    };

    const isAirWaterOrLava = (block) => {
        if (!block) return false;
        const id = block.typeId;
        return id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water"
            || id === "minecraft:lava" || id === "minecraft:flowing_lava";
    };

    const isOpen = (block) => !block || isReplaceable(block) || isAirWaterOrLava(block);

    const hasClearance = (x, y, z, height) => {
        for (let i = 0; i < height; i++) {
            if (!isOpen(dimension.getBlock({ x, y: y + i, z }))) return false;
        }
        return true;
    };

    const getBlockingEntities = (x, y, z) =>
        dimension.getEntitiesAtBlockLocation({ x, y, z }).filter(e => e.id !== zombie.id);

    const placeBlock = (x, y, z) => {
        const block = dimension.getBlock({ x, y, z });
        if (block && isOpen(block)) {
            if (getBlockingEntities(x, y, z).length > 0) return false;
            block.setType(blockType);
            dimension.playSound("use.gravel", { x, y, z });
            zombie.runCommand("playanimation @s animation.zombie.swing a 0.333");
            return true;
        }
        return false;
    };

    const applyTeleportSlowness = (entity) => {
        try {
            entity.addEffect("slowness", 19, { amplifier: 255, showParticles: false });
        } catch (e) { }
    };

    // ---------- Step 1: A* Pathfind (Now a Generator) ----------
    function* calculateBuildingPath() {
        const DIRECTIONS = [
            { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
            { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
            { dx: 0, dy: 1, dz: 0 },
            { dx: 1, dy: 1, dz: 0 }, { dx: -1, dy: 1, dz: 0 },
            { dx: 0, dy: 1, dz: 1 }, { dx: 0, dy: 1, dz: -1 },
            { dx: 1, dy: -1, dz: 0 }, { dx: -1, dy: -1, dz: 0 },
            { dx: 0, dy: -1, dz: 1 }, { dx: 0, dy: -1, dz: -1 },
        ];

        const start = { x: locX, y: locY, z: locZ };
        const goal = { x: Math.floor(tLoc.x), y: Math.floor(tLoc.y), z: Math.floor(tLoc.z) };

        const MAX_NODES = 2000;
        const MARGIN_XZ = 30;
        const MARGIN_Y_UP = 30;

        const minX = Math.min(start.x, goal.x) - MARGIN_XZ;
        const maxX = Math.max(start.x, goal.x) + MARGIN_XZ;
        const minZ = Math.min(start.z, goal.z) - MARGIN_XZ;
        const maxZ = Math.max(start.z, goal.z) + MARGIN_XZ;
        const minY = Math.min(start.y, goal.y);
        const maxY = Math.max(start.y, goal.y) + MARGIN_Y_UP;

        const inBounds = (x, y, z) => x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
        const isGoal = (n) => n.x === goal.x && n.y === goal.y && n.z === goal.z;

        const heuristic = (n) => {
            const ddx = n.x - goal.x;
            const ddy = n.y - goal.y;
            const ddz = n.z - goal.z;
            return Math.sqrt(ddx * ddx + ddz * ddz) + Math.abs(ddy) * 1.2;
        };

        const getNeighbors = (node) => {
            const { x, y, z } = node;
            const neighbors = [];
            for (const { dx, dy, dz } of DIRECTIONS) {
                const nx = x + dx, ny = y + dy, nz = z + dz;
                if (!inBounds(nx, ny, nz)) continue;

                const isStairUp = dy === 1 && (dx !== 0 || dz !== 0);
                const isStairDown = dy === -1 && (dx !== 0 || dz !== 0);

                if (isStairUp && !hasClearance(x, y, z, 3)) continue;

                const requiredHeight = isStairDown ? 3 : 2;
                if (!hasClearance(nx, ny, nz, requiredHeight)) continue;

                const isStaircase = isStairUp || isStairDown;
                const cost = isStaircase ? 1.3 : dy !== 0 ? 1.5 : 1;
                neighbors.push({ x: nx, y: ny, z: nz, cost });
            }
            return neighbors;
        };

        const keyOf = (n) => `${n.x},${n.y},${n.z}`;

        if (isGoal(start)) {
            finishPathfinding(null);
            return;
        }

        const open = [{ ...start, g: 0, f: heuristic(start) }];
        const cameFrom = new Map();
        const gScore = new Map([[keyOf(start), 0]]);
        const visited = new Set();

        let closestNode = start;
        let minH = heuristic(start);
        let expanded = 0;

        while (open.length > 0 && expanded < MAX_NODES) {
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const current = open.splice(bestIdx, 1)[0];
            const currentKey = keyOf(current);
            if (visited.has(currentKey)) continue;
            visited.add(currentKey);
            
            expanded++;
            if (expanded % 50 === 0) yield;

            if (!zombie.isValid) {
                activeBuildingJobs.delete(zombie.id);
                return;
            }

            if (isGoal(current)) {
                const path = [];
                let key = currentKey;
                while (cameFrom.has(key)) {
                    const entry = cameFrom.get(key);
                    path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
                    key = entry.parentKey;
                }
                finishPathfinding(path);
                return;
            }

            for (const neighbor of getNeighbors(current)) {
                const nKey = keyOf(neighbor);
                if (visited.has(nKey)) continue;
                
                const h = heuristic(neighbor);
                if (h < minH) {
                    minH = h;
                    closestNode = neighbor;
                }

                const tentativeG = current.g + neighbor.cost;
                if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
                    gScore.set(nKey, tentativeG);
                    cameFrom.set(nKey, { parentKey: currentKey, node: neighbor });
                    open.push({ x: neighbor.x, y: neighbor.y, z: neighbor.z, g: tentativeG, f: tentativeG + heuristic(neighbor) });
                }
            }
        }
        
        // Partial Path Fallback
        if (keyOf(closestNode) !== keyOf(start)) {
            const path = [];
            let key = keyOf(closestNode);
            while (cameFrom.has(key)) {
                const entry = cameFrom.get(key);
                path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
                key = entry.parentKey;
            }
            finishPathfinding(path);
            return;
        }

        finishPathfinding(null);
    }

    // ---------- Step 2 & 3: Movement Execution ----------
    function finishPathfinding(path) {
        activeBuildingJobs.delete(zombie.id);
        
        if (!zombie.isValid) return;
        if (!path || path.length === 0) {
            zombie.lookAt(target.getHeadLocation());
            return;
        }

        const next = path[0];

        if (isStuck) {
            forceUnstick.set(zombie.id, true);
        }
        const forcing = forceUnstick.get(zombie.id) || false;

        const belowNext = dimension.getBlock({ x: next.x, y: next.y - 1, z: next.z });
        const placed = isOpen(belowNext) ? placeBlock(next.x, next.y - 1, next.z) : false;

        if (placed || forcing) {
            if (forcing && placed) forceUnstick.set(zombie.id, false);
            zombie.teleport({ x: next.x + 0.5, y: next.y + 0.05, z: next.z + 0.5 }, { facingLocation: tLoc });
            applyTeleportSlowness(zombie);
            return;
        }

        zombie.lookAt(target.getHeadLocation());
    }

    // Start the Job
    const jobId = system.runJob(calculateBuildingPath());
    activeBuildingJobs.set(zombie.id, jobId);
}

// ---------------------------------------------------------
// NEW GAMEPLAY HELPERS
// ---------------------------------------------------------

export function checkZombieFriendlyFire(victim, attacker) {
    if (!attacker) return false;
    // Specifically checks for the "zombie" family OR the player tag.
    const isVictimZombieAlly = victim.matches({ families: [`zombie`] }) || victim.hasTag(`udc_zombified`);
    const isAttackerZombieAlly = attacker.matches({ families: [`zombie`] }) || attacker.hasTag(`udc_zombified`);

    return isVictimZombieAlly && isAttackerZombieAlly;
}

export function handleFatalZombification(victim, attacker, damage, cause) {
    const healthComp = victim.getComponent(`minecraft:health`);
    const isFatal = healthComp && damage >= healthComp.currentValue;

    if (!isFatal) return false;

    // Validate victim: Must be a mob, cannot be a player, cannot be undead or inanimate.
    if (victim.typeId === `minecraft:player` || victim.matches({ families: [`undead`, `inanimate`] }) || !victim.matches({ families: [`mob`] })) {
        return false;
    }

    let isHoldingGoldTool = false;
    if (attacker?.typeId === `minecraft:player`) {
        const equipment = attacker.getComponent(`equippable`);
        const mainhand = equipment?.getEquipment(`Mainhand`);
        if (mainhand && (mainhand.typeId.includes(`golden_`) || mainhand.typeId.includes(`gold_`))) {
            isHoldingGoldTool = true;
        }
    }

    if (isHoldingGoldTool) {
        console.warn(`[Zombification] Fatal blow with a golden tool by ${attacker.name}. Zombification bypassed.`);
        return false; // Let normal death and drops happen
    }

    const isZombifiedPlayer = attacker?.typeId === `minecraft:player` && attacker?.hasTag(`udc_zombified`);
    const isZombieMob = attacker?.matches({ families: [`zombie`] });

    if (isZombifiedPlayer) {
        const maxHp = healthComp.effectiveMax || 20;
        const hungerRestored = Math.max(1, Math.floor(maxHp / 2)); // 1 hunger point per 2 max HP

        system.run(() => {
            if (attacker.isValid) {
                const playerHunger = attacker.getComponent(`minecraft:player.hunger`);
                if (playerHunger) {
                    playerHunger.setCurrentValue(Math.min(20, playerHunger.currentValue + hungerRestored));
                    console.warn(`[Zombie Kill Eat] ${attacker.name} killed ${victim.typeId} (Max HP: ${maxHp}). Restored ${hungerRestored} hunger.`);
                }
            }

            if (victim.isValid) {
                const tempHitbox = victim.dimension.spawnEntity(`udc:player_zombie_hitbox`, victim.location);
                victim.applyDamage(9999, { cause, damagingEntity: tempHitbox });
                tempHitbox.remove();
            }
        });
        return true; // Indicate event was handled
    } else if (isZombieMob && !victim.matches({ families: [`villager`] })) {
        system.run(() => {
            if (victim.isValid) {
                transformToZombie(victim);
            }
        });
        return true; // Indicate event was handled
    }

    return false;
}

export function checkZombieSunburn(player, currentTick) {
    if (player.dimension.id !== "minecraft:overworld") return;
    const time = world.getTimeOfDay();
    if (time > 13000 && time < 23450) return; // It is nighttime
    if (player.isInWater || player.isSwimming) return; // Safe in water

    // Check if there is a block blocking the sun above the player
    const headLoc = player.getHeadLocation();
    let isUnderCover = false;
    try {
        // Cast a ray straight up to the sky limit
        const hit = player.dimension.getBlockFromRay(headLoc, { x: 0, y: 1, z: 0 }, { maxDistance: 320 - headLoc.y });
        if (hit && hit.block) isUnderCover = true;
    } catch (e) { }

    if (isUnderCover) return; // Safe under cover

    const eq = player.getComponent("equippable");
    const headSlot = eq?.getEquipmentSlot(server.EquipmentSlot.Head);

    if (headSlot && headSlot.hasItem()) {
        // Only drain durability every 5 seconds (100 ticks) to match mechanics
        if (currentTick % 100 === 0) {
            const item = headSlot.getItem();
            const dur = item.getComponent("durability");
            const ench = item.getComponent("enchantable");

            if (dur) {
                let unbreaking = 0;
                if (ench && ench.hasEnchantment("unbreaking")) {
                    unbreaking = ench.getEnchantment("unbreaking").level;
                }

                // Unbreaking armor chance to take damage formula
                const chanceToDamage = 1 - (0.6 + (0.4 / (unbreaking + 1)));

                if (unbreaking === 0 || Math.random() < chanceToDamage) {
                    if (dur.damage + 1 >= dur.maxDurability) {
                        headSlot.setItem(undefined);
                        player.dimension.playSound("random.break", player.location);
                    } else {
                        dur.damage += 1;
                        headSlot.setItem(item);
                    }
                }
            }
        }
    } else {
        // No helmet, burn them for 2 seconds (constantly refreshed while in sun)
        player.setOnFire(2);
    }
}

export function handlePlayerDeathInfection(deadPlayer, damageSource) {
    const attacker = damageSource.damagingEntity;
    if (!attacker) return;

    const isZombieAttacker = attacker.matches({ families: [`zombie`] }) || attacker.hasTag(`udc_zombified`);
    if (!isZombieAttacker) return;

    // Difficulty scaling: Default 50%, tries to read world difficulty if API allows it
    let chance = 0.50;
    try {
        const diff = world.difficulty;
        if (diff === server.Difficulty.easy) chance = 0.25;
        if (diff === server.Difficulty.normal) chance = 0.50;
        if (diff === server.Difficulty.hard) chance = 1.00;
    } catch (e) { }

    if (Math.random() <= chance) {
        deadPlayer.setDynamicProperty(`udc_pending_infection`, true);
    }
}

export function cureZombiePlayer(player) {
    player.removeTag(`udc_zombified`);
    player.sendMessage("§aYou have been cured of the zombie infection!");
    player.playSound("random.levelup");
    player.playSound("mob.zombie_villager.cure");
}

// Toggle this to true to see dynamic size tags, or false to inherit normal nametags
const DEBUG_NAMETAG = false;

export function handleSlimeFuse(entity, dimension, location) {
    try {
        const target = dimension.getEntities({ location, type: `udc:slime`, closest: 2, maxDistance: 1.25 * entity.getComponent(`minecraft:scale`).value })[1];

        if (target && entity.getProperty(`udc:can_fuse`) && target.getProperty(`udc:can_fuse`)) {

            const esize = Math.floor(entity.getComponent(`minecraft:skin_id`).value);
            const tsize = Math.floor(target.getComponent(`minecraft:skin_id`).value);

            const emass = entity.getProperty(`udc:extra_mass`) || 0;
            const tmass = target.getProperty(`udc:extra_mass`) || 0;

            const totalE = esize + emass;
            const totalT = tsize + tmass;

            let survivor, sacrificed;
            if (totalE > totalT || (totalE === totalT && entity.id < target.id)) {
                survivor = entity;
                sacrificed = target;
            } else {
                survivor = target;
                sacrificed = entity;
            }

            survivor.setProperty(`udc:can_fuse`, false);
            sacrificed.setProperty(`udc:can_fuse`, false);

            const sMass = survivor.getProperty(`udc:extra_mass`) || 0;
            const sacSize = Math.floor(sacrificed.getComponent(`minecraft:skin_id`).value);
            const sacMass = sacrificed.getProperty(`udc:extra_mass`) || 0;

            const newExtraMass = sMass + sacSize + sacMass;
            survivor.setProperty(`udc:extra_mass`, newExtraMass);

            const survivorSkin = Math.floor(survivor.getComponent(`minecraft:skin_id`).value);

            if (DEBUG_NAMETAG) {
                survivor.nameTag = `Size: ${survivorSkin} (+${newExtraMass})`;
            }

            const minFire = sacrificed.getComponent(`minecraft:onfire`)?.onFireTicksRemaining || 0;
            const maxFire = survivor.getComponent(`minecraft:onfire`)?.onFireTicksRemaining || 0;
            const combinedFireTicks = Math.max(minFire, maxFire);

            if (combinedFireTicks > 0) {
                survivor.setOnFire(combinedFireTicks / 20, true);
            }

            [...sacrificed.getEffects()].forEach(effect => {
                const safeDuration = effect.duration > 0 ? effect.duration : 20000000;
                const existing = survivor.getEffect(effect.typeId);

                if (!existing || existing.amplifier < effect.amplifier || (existing.amplifier === effect.amplifier && existing.duration < safeDuration)) {
                    survivor.addEffect(effect.typeId, safeDuration, { amplifier: effect.amplifier });
                }
            });

            sacrificed.remove();
            survivor.triggerEvent(`udc:start_growth_timer`);
        }
    } catch { }
}

export function handleSlimeGrowth(entity) {
    if (!entity?.isValid) return;

    const skinId = Math.floor(entity.getComponent(`minecraft:skin_id`).value);
    const extraMass = entity.getProperty(`udc:extra_mass`) || 0;

    if (extraMass <= 0) return;

    const newSize = skinId + extraMass;

    // ==========================================
    // 1. CAPTURE STATE BEFORE DELETION
    // ==========================================
    const dimension = entity.dimension;
    const headLocation = entity.getHeadLocation();

    const fireTicks = entity.getComponent(`minecraft:onfire`)?.onFireTicksRemaining || 0;

    const rawNameTag = entity.nameTag;
    const savedNameTag = (rawNameTag && !rawNameTag.startsWith("Size: ")) ? rawNameTag : undefined;

    const savedEffects = entity.getEffects().map(effect => ({
        typeId: effect.typeId,
        duration: effect.duration,
        amplifier: effect.amplifier
    }));

    // ==========================================
    // 2. DESTROY ORIGINAL
    // ==========================================
    entity.remove();

    // ==========================================
    // 3. REBUILD ENTITIES
    // ==========================================
    const mainSize = Math.min(32, newSize);
    const mainSlime = dimension.spawnEntity(`udc:slime`, headLocation);

    if (mainSlime.isValid) {
        mainSlime.setProperty(`udc:can_fuse`, false);
        mainSlime.setProperty(`udc:extra_mass`, 0);
        mainSlime.triggerEvent(`size${mainSize}`);

        if (DEBUG_NAMETAG) {
            mainSlime.nameTag = `Size: ${mainSize}`;
        } else if (savedNameTag) {
            mainSlime.nameTag = savedNameTag;
        }

        savedEffects.forEach(effect => {
            const safeDuration = effect.duration > 0 ? effect.duration : 20000000;
            mainSlime.addEffect(effect.typeId, safeDuration, { amplifier: effect.amplifier });
        });

        system.runTimeout(() => {
            if (mainSlime.isValid) {
                const hp = mainSlime.getComponent("minecraft:health");
                if (hp) {
                    try { hp.setCurrentValue(mainSize); } catch (e) {
                        system.runTimeout(() => { if (mainSlime.isValid) try { mainSlime.getComponent("minecraft:health")?.setCurrentValue(mainSize); } catch { } }, 2);
                    }
                }
                if (fireTicks > 0) mainSlime.setOnFire(fireTicks / 20, true);
            }
        }, 1);
    }

    if (newSize > 32) {
        let remainder = newSize - 32;
        const splits = [];
        [32, 5, 3, 2, 1].forEach(sizeValue => {
            while (remainder >= sizeValue) {
                splits.push(sizeValue);
                remainder -= sizeValue;
            }
        });

        for (const s of splits) {
            const newSlime = dimension.spawnEntity(`udc:slime`, headLocation);
            if (newSlime.isValid) {
                newSlime.setProperty(`udc:can_fuse`, false);
                newSlime.setProperty(`udc:extra_mass`, 0);
                newSlime.triggerEvent(`size${s}`);

                if (DEBUG_NAMETAG) {
                    newSlime.nameTag = `Size: ${s}`;
                } else if (savedNameTag) {
                    newSlime.nameTag = savedNameTag;
                }

                savedEffects.forEach(effect => {
                    const safeDuration = effect.duration > 0 ? effect.duration : 20000000;
                    newSlime.addEffect(effect.typeId, safeDuration, { amplifier: effect.amplifier });
                });

                system.runTimeout(() => {
                    if (newSlime.isValid) {
                        try { newSlime.getComponent("minecraft:health")?.setCurrentValue(s); } catch (e) {
                            system.runTimeout(() => { if (newSlime.isValid) try { newSlime.getComponent("minecraft:health")?.setCurrentValue(s); } catch { } }, 2);
                        }
                        if (fireTicks > 0) newSlime.setOnFire(fireTicks / 20, true);
                    }
                }, 1);

                const forceX = (Math.random() - 0.5) * 3;
                const forceY = Math.random() * 0.5 + 0.4;
                const forceZ = (Math.random() - 0.5) * 3;
                newSlime.applyImpulse({ x: forceX, y: forceY, z: forceZ });
            }
        }
    }
}

export function handleSlimeSplit(hurtEntity, damage, cause, event) {
    if (hurtEntity.typeId !== `udc:slime`) return false;

    if (damage < 1) return false;
    if (cause === "suicide" || cause === "selfDestruct") return false;

    const skinIdComp = hurtEntity.getComponent(`minecraft:skin_id`);
    if (!skinIdComp) return false;

    const skinId = Math.floor(skinIdComp.value);
    const extraMass = hurtEntity.getProperty(`udc:extra_mass`) || 0;

    const damageDealt = Math.ceil(damage);
    if (damageDealt <= 0) return false;

    const healthComp = hurtEntity.getComponent(`minecraft:health`);
    const isFatal = healthComp && damageDealt >= healthComp.currentValue;

    // ==========================================
    // INSTANT KILL MECHANIC (Sizes 1 to 3)
    // ==========================================
    // If a small slime is one-shot, let the engine kill it natively. No splits spawn!
    if (skinId <= 3 && isFatal) {
        return false;
    }

    // Size 1 slimes (with no extra mass) take non-fatal damage normally
    if (skinId <= 1 && extraMass === 0) return false;

    // Negate ALL damage for slimes larger than size 1 (or size 1s that have extra mass)
    event.cancel = true;

    // If unfusable, it cannot split. Takes no damage and returns before the sound plays.
    if (hurtEntity.getProperty(`udc:can_fuse`) === false) {
        return false;
    }

    // ==========================================
    // 1. CAPTURE STATE BEFORE DELETION
    // ==========================================
    const dimension = hurtEntity.dimension;
    const headLocation = hurtEntity.getHeadLocation();

    const onFireComp = hurtEntity.getComponent(`minecraft:onfire`);
    const remainingFireSeconds = onFireComp ? (onFireComp.onFireTicksRemaining / 20) : 0;

    const rawNameTag = hurtEntity.nameTag;
    const savedNameTag = (rawNameTag && !rawNameTag.startsWith("Size: ")) ? rawNameTag : undefined;

    const savedEffects = hurtEntity.getEffects().map(effect => ({
        typeId: effect.typeId,
        duration: effect.duration,
        amplifier: effect.amplifier
    }));

    system.run(() => {
        try { dimension.playSound(`mob.slime.squish`, headLocation); } catch { }

        let amountToSpawn = 0;
        let newSize = skinId;

        // ==========================================
        // 2. DESTROY ORIGINAL
        // ==========================================
        if (hurtEntity.isValid) {
            hurtEntity.remove();
        }

        // ==========================================
        // 3. REBUILD ENTITIES
        // ==========================================
        if (isFatal) {
            amountToSpawn = skinId + extraMass;
        } else {
            amountToSpawn = damageDealt + extraMass;
            newSize = skinId - damageDealt;

            if (newSize < 1) {
                newSize = 1;
                amountToSpawn = (skinId - 1) + extraMass;
            }

            const survivor = dimension.spawnEntity(`udc:slime`, headLocation);
            if (survivor.isValid) {
                survivor.setProperty(`udc:can_fuse`, false);
                survivor.setProperty(`udc:extra_mass`, 0);
                survivor.triggerEvent(`size${newSize}`);

                if (typeof DEBUG_NAMETAG !== 'undefined' && DEBUG_NAMETAG) {
                    survivor.nameTag = `Size: ${newSize}`;
                } else if (savedNameTag) {
                    survivor.nameTag = savedNameTag;
                }

                savedEffects.forEach(effect => {
                    const safeDuration = effect.duration > 0 ? effect.duration : 20000000;
                    survivor.addEffect(effect.typeId, safeDuration, { amplifier: effect.amplifier });
                });

                system.runTimeout(() => {
                    if (survivor.isValid) {
                        const hp = survivor.getComponent("minecraft:health");
                        if (hp) {
                            try { hp.setCurrentValue(newSize); } catch (error) {
                                system.runTimeout(() => { if (survivor.isValid) try { survivor.getComponent("minecraft:health")?.setCurrentValue(newSize); } catch { } }, 2);
                            }
                        }
                        if (remainingFireSeconds > 0) survivor.setOnFire(remainingFireSeconds, true);
                    }
                }, 1);
            }
        }

        const splits = [];
        let remainingToSplit = amountToSpawn;
        let allowedChunks = [32, 5, 3, 2, 1];

        // If fatal (for sizes 4+), force it to break into at least 2 slimes
        if (isFatal) {
            allowedChunks = allowedChunks.filter(c => c < amountToSpawn);
            if (allowedChunks.length === 0) allowedChunks = [1];
        }

        allowedChunks.forEach(sizeValue => {
            while (remainingToSplit >= sizeValue) {
                splits.push(sizeValue);
                remainingToSplit -= sizeValue;
            }
        });

        for (const s of splits) {
            const newSlime = dimension.spawnEntity(`udc:slime`, headLocation);
            if (newSlime.isValid) {
                newSlime.setProperty(`udc:can_fuse`, false);
                newSlime.setProperty(`udc:extra_mass`, 0);
                newSlime.triggerEvent(`size${s}`);

                if (typeof DEBUG_NAMETAG !== 'undefined' && DEBUG_NAMETAG) {
                    newSlime.nameTag = `Size: ${s}`;
                } else if (savedNameTag) {
                    newSlime.nameTag = savedNameTag;
                }

                savedEffects.forEach(effect => {
                    const safeDuration = effect.duration > 0 ? effect.duration : 20000000;
                    newSlime.addEffect(effect.typeId, safeDuration, { amplifier: effect.amplifier });
                });

                system.runTimeout(() => {
                    if (newSlime.isValid) {
                        const hp = newSlime.getComponent("minecraft:health");
                        if (hp) {
                            try { hp.setCurrentValue(s); } catch (error) {
                                system.runTimeout(() => { if (newSlime.isValid) try { newSlime.getComponent("minecraft:health")?.setCurrentValue(s); } catch { } }, 2);
                            }
                        }
                        if (remainingFireSeconds > 0) newSlime.setOnFire(remainingFireSeconds, true);
                    }
                }, 1);

                const forceX = (Math.random() - 0.5) * 3;
                const forceY = Math.random() * 0.5 + 0.4;
                const forceZ = (Math.random() - 0.5) * 3;
                newSlime.applyImpulse({ x: forceX, y: forceY, z: forceZ });
            }
        }
    });

    return true;
}


export function handleZombieMining(zombie) {
    if (!zombie.isValid) {
        if (zombie) {
            positionHistory.delete(zombie.id);
            forceUnstick.delete(zombie.id);
            if (activeMiningJobs.has(zombie.id)) {
                system.clearJob(activeMiningJobs.get(zombie.id));
                activeMiningJobs.delete(zombie.id);
            }
        }
        return;
    }
    
    if (!zombie.isOnGround) return;
    if (activeMiningJobs.has(zombie.id)) return;

    const target = getNearestValidTarget(zombie);
    if (!target || !target.isValid) return;

    const loc = zombie.location;
    const tLoc = target.location;
    const dimension = zombie.dimension;

    const isAxe = zombie.hasTag("udc_tool_axe");
    const isShovel = zombie.hasTag("udc_tool_shovel");
    const isPickaxe = zombie.hasTag("udc_tool_pickaxe");
    const isHeavyPickaxe = zombie.hasTag("udc_tool_heavy_pickaxe");

    const locX = Math.floor(loc.x);
    const locY = Math.floor(loc.y);
    const locZ = Math.floor(loc.z);

    // ---------- Stuck detection ----------
    let history = positionHistory.get(zombie.id) || [];
    history = [...history, { x: locX, y: locY, z: locZ }].slice(-3);
    positionHistory.set(zombie.id, history);

    const isStuck = history.length === 3 &&
        history.every(p => p.x === history[0].x && p.y === history[0].y && p.z === history[0].z);

    // DEBUG LOG: You can remove this once you confirm it works!
    // console.warn(`[Mining Debug] Zombie ${zombie.id.slice(-5)} | Stuck: ${isStuck} | History: ${JSON.stringify(history)}`);

    // ---------- Block helpers ----------
    const isReplaceable = (block) => {
        if (!block) return false;
        const id = block.typeId;
        if (id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water") return true;
        const replaceables = ["tallgrass", "lava", "snow_layer", "flower", "vines", "kelp", "fern"];
        return replaceables.some(tag => id.includes(tag));
    };

    const isAirWaterOrLava = (block) => {
        if (!block) return false;
        const id = block.typeId;
        return id === "minecraft:air" || id === "minecraft:water" || id === "minecraft:flowing_water"
            || id === "minecraft:lava" || id === "minecraft:flowing_lava";
    };

    const isOpen = (block) => !block || isReplaceable(block) || isAirWaterOrLava(block);

    const isBreakable = (block) => {
        if (!block) return false;
        if (isOpen(block)) return false; 
        return canZombieBreakBlock(block, isAxe, isShovel, isPickaxe, isHeavyPickaxe);
    };

    // Treat blocks it can break as open space for pathfinding
    const isPassable = (block) => isOpen(block) || isBreakable(block);

    const hasPassableClearance = (x, y, z, height) => {
        for (let i = 0; i < height; i++) {
            if (!isPassable(dimension.getBlock({ x, y: y + i, z }))) return false;
        }
        return true;
    };

    const countBreakableInClearance = (x, y, z, height) => {
        let count = 0;
        for (let i = 0; i < height; i++) {
            if (isBreakable(dimension.getBlock({ x, y: y + i, z }))) count++;
        }
        return count;
    };

    const applyTeleportSlowness = (entity) => {
        try { entity.addEffect("slowness", 19, { amplifier: 255, showParticles: false }); } catch (e) { }
    };

    // ---------- Step 1: A* Pathfind (Generator) ----------
    function* calculateMiningPath() {
        const DIRECTIONS = [
            { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
            { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
            { dx: 0, dy: 1, dz: 0 },
            { dx: 1, dy: 1, dz: 0 }, { dx: -1, dy: 1, dz: 0 },
            { dx: 0, dy: 1, dz: 1 }, { dx: 0, dy: 1, dz: -1 },
            { dx: 1, dy: -1, dz: 0 }, { dx: -1, dy: -1, dz: 0 },
            { dx: 0, dy: -1, dz: 1 }, { dx: 0, dy: -1, dz: -1 },
        ];

        const start = { x: locX, y: locY, z: locZ };
        const goal = { x: Math.floor(tLoc.x), y: Math.floor(tLoc.y), z: Math.floor(tLoc.z) };

        const MAX_NODES = 2000;
        const MARGIN_XZ = 30;
        const MARGIN_Y_UP = 30;

        const minX = Math.min(start.x, goal.x) - MARGIN_XZ;
        const maxX = Math.max(start.x, goal.x) + MARGIN_XZ;
        const minZ = Math.min(start.z, goal.z) - MARGIN_XZ;
        const maxZ = Math.max(start.z, goal.z) + MARGIN_XZ;
        const minY = Math.min(start.y, goal.y);
        const maxY = Math.max(start.y, goal.y) + MARGIN_Y_UP;

        const inBounds = (x, y, z) => x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
        const isGoal = (n) => n.x === goal.x && n.y === goal.y && n.z === goal.z;

        const heuristic = (n) => {
            const ddx = n.x - goal.x;
            const ddy = n.y - goal.y;
            const ddz = n.z - goal.z;
            return Math.sqrt(ddx * ddx + ddz * ddz) + Math.abs(ddy) * 1.2;
        };

        const getNeighbors = (node) => {
            const { x, y, z } = node;
            const neighbors = [];
            for (const { dx, dy, dz } of DIRECTIONS) {
                const nx = x + dx, ny = y + dy, nz = z + dz;
                if (!inBounds(nx, ny, nz)) continue;

                // Ensure there is solid ground to walk on to prevent floating paths
                const floorBlock = dimension.getBlock({ x: nx, y: ny - 1, z: nz });
                if (isOpen(floorBlock)) continue;

                const isStairUp = dy === 1 && (dx !== 0 || dz !== 0);
                const isStairDown = dy === -1 && (dx !== 0 || dz !== 0);
                const isStaircase = isStairUp || isStairDown;

                if (isStairUp && !hasPassableClearance(x, y, z, 3)) continue;

                const requiredHeight = isStairDown ? 3 : 2;
                if (!hasPassableClearance(nx, ny, nz, requiredHeight)) continue;

                const breakCost = countBreakableInClearance(nx, ny, nz, requiredHeight) * 4;
                const baseCost = isStaircase ? 1.3 : dy !== 0 ? 1.5 : 1;
                neighbors.push({ x: nx, y: ny, z: nz, cost: baseCost + breakCost });
            }
            return neighbors;
        };

        const keyOf = (n) => `${n.x},${n.y},${n.z}`;

        if (isGoal(start)) {
            finishPathfinding(null);
            return;
        }

        const open = [{ ...start, g: 0, f: heuristic(start) }];
        const cameFrom = new Map();
        const gScore = new Map([[keyOf(start), 0]]);
        const visited = new Set();

        let closestNode = start;
        let minH = heuristic(start);
        let expanded = 0;

        while (open.length > 0 && expanded < MAX_NODES) {
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const current = open.splice(bestIdx, 1)[0];
            const currentKey = keyOf(current);
            if (visited.has(currentKey)) continue;
            visited.add(currentKey);
            
            expanded++;
            if (expanded % 50 === 0) yield;

            if (!zombie.isValid) {
                activeMiningJobs.delete(zombie.id);
                return;
            }

            if (isGoal(current)) {
                const path = [];
                let key = currentKey;
                while (cameFrom.has(key)) {
                    const entry = cameFrom.get(key);
                    path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
                    key = entry.parentKey;
                }
                finishPathfinding(path);
                return;
            }

            for (const neighbor of getNeighbors(current)) {
                const nKey = keyOf(neighbor);
                if (visited.has(nKey)) continue;
                
                const h = heuristic(neighbor);
                if (h < minH) {
                    minH = h;
                    closestNode = neighbor;
                }

                const tentativeG = current.g + neighbor.cost;
                if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
                    gScore.set(nKey, tentativeG);
                    cameFrom.set(nKey, { parentKey: currentKey, node: neighbor });
                    open.push({ x: neighbor.x, y: neighbor.y, z: neighbor.z, g: tentativeG, f: tentativeG + heuristic(neighbor) });
                }
            }
        }
        
        if (keyOf(closestNode) !== keyOf(start)) {
            const path = [];
            let key = keyOf(closestNode);
            while (cameFrom.has(key)) {
                const entry = cameFrom.get(key);
                path.unshift({ x: entry.node.x, y: entry.node.y, z: entry.node.z });
                key = entry.parentKey;
            }
            finishPathfinding(path);
            return;
        }

        finishPathfinding(null);
    }

    // ---------- Step 2 & 3: Mining Execution ----------
    function finishPathfinding(path) {
        activeMiningJobs.delete(zombie.id);

        if (!zombie.isValid) return;
        if (!path || path.length === 0) {
            zombie.lookAt(target.getHeadLocation());
            return;
        }

        const next = path[0];

        if (isStuck) forceUnstick.set(zombie.id, true);
        const forcing = forceUnstick.get(zombie.id) || false;

        let successfullyMined = false;
        const requiredHeight = (next.y < locY) ? 3 : 2; 

        // If stepping up, clear the block overhead first
        if (next.y > locY && (next.x !== locX || next.z !== locZ)) {
            const overheadBlock = dimension.getBlock({ x: locX, y: locY + 2, z: locZ });
            if (isBreakable(overheadBlock)) {
                dimension.runCommand(`setblock ${locX} ${locY + 2} ${locZ} air destroy`);
                successfullyMined = true;
            }
        }

        // Clear blocks in the target location
        for (let i = 0; i < requiredHeight; i++) {
            const block = dimension.getBlock({ x: next.x, y: next.y + i, z: next.z });
            if (isBreakable(block)) {
                dimension.runCommand(`setblock ${next.x} ${next.y + i} ${next.z} air destroy`);
                successfullyMined = true;
            }
        }

        if (successfullyMined) {
            if (forcing) forceUnstick.set(zombie.id, false);
            positionHistory.set(zombie.id, []); 
            
            zombie.runCommand("playanimation @s animation.zombie.swing a 0.333");
            
            // Wait 2 ticks after breaking blocks before moving
            system.runTimeout(() => {
                if (zombie.isValid) {
                    zombie.teleport({ x: next.x + 0.5, y: next.y, z: next.z + 0.5 }, { facingLocation: tLoc });
                    applyTeleportSlowness(zombie);
                }
            }, 2);
            return;
        }

        // ONLY force teleport if stuck. If not stuck, just let the zombie walk naturally.
        if (forcing) {
            forceUnstick.set(zombie.id, false);
            positionHistory.set(zombie.id, []);

            zombie.teleport({ x: next.x + 0.5, y: next.y, z: next.z + 0.5 }, { facingLocation: tLoc });
            applyTeleportSlowness(zombie);
            return;
        }

        zombie.lookAt(target.getHeadLocation());
    }

    // Start the Job
    const jobId = system.runJob(calculateMiningPath());
    activeMiningJobs.set(zombie.id, jobId);
}