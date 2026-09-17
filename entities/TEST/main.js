import * as server from "@minecraft/server"
import * as v3 from "./v3"
import { 
    ironGolemMelee2, soulIntoRandomZombie, summonPatrolFollower, validThrowTarget, 
    spiderPullTarget, followShootedhead, transformToZombie, canZombieBreakBlock, 
     startZombieFoodConsumption, handleZombieFoodConsumption,
    checkZombieFriendlyFire, handleFatalZombification, checkZombieSunburn, 
    handlePlayerDeathInfection, cureZombiePlayer, handleSlimeSplit, handleSlimeFuse, handleSlimeGrowth,
    handleZombieBuilding, handleZombieMining // <--- Added Mining
} from "./functions"

const world = server.world
const system = server.system

// ---------------------------------------------------------
// ZOMBIE FOOD MECHANIC
// ---------------------------------------------------------
world.afterEvents.itemUse.subscribe((event) => {
    if (event.source.typeId !== "minecraft:player" || !event.source.hasTag(`udc_zombified`)) return;
    startZombieFoodConsumption(event.source, event.itemStack);
});

world.afterEvents.itemCompleteUse.subscribe((event) => {
    if (event.source.typeId !== "minecraft:player" || !event.source.hasTag(`udc_zombified`)) return;
    
    // Golden Apple Cure Logic
    if (event.itemStack.typeId.includes("golden_apple")) {
        cureZombiePlayer(event.source);
        return;
    }
    
    handleZombieFoodConsumption(event.source, event.itemStack);
});

world.afterEvents.itemStopUse.subscribe((event) => {
    if (event.source.typeId !== "minecraft:player" || !event.source.hasTag(`udc_zombified`)) return;
    handleZombieFoodConsumption(event.source, event.itemStack);
});


// ---------------------------------------------------------
// DATA DRIVEN ENTITY TRIGGER (CONSOLIDATED)
// ---------------------------------------------------------
world.afterEvents.dataDrivenEntityTrigger.subscribe((event) => {
    const { entity, eventId } = event
     if(!entity?.isValid) return
    const { location, dimension, typeId } = entity

   

    

    if (eventId === "get_up") {
        entity.setProperty(`udc:leaping`, 0)
        return;
    }

   if (eventId === "udc_fuse") {
        handleSlimeFuse(entity, dimension, location);
        return;
    }
    
    if (eventId === "udc:execute_growth") {
        handleSlimeGrowth(entity);
        return;
    }

    switch (typeId) {
        case "udc:fleshbound_soul": {
            if (eventId === "t") {
                soulIntoRandomZombie(entity)
            } else if (eventId === "fuse_with_soul") {
                const skinId = entity.getComponent(`minecraft:skin_id`).value
                if (skinId != 3 && !entity.getProperty(`udc:transforming`)) {
                    const id = entity.id
                    const closestSoul = dimension.getEntities({ type: `udc:fleshbound_soul`, location, maxDistance: 15 }).filter(e => e.id != id && e.getComponent(`minecraft:skin_id`).value == skinId && !e.getProperty(`udc:transforming`))[0]
                    if (closestSoul) {
                        const distance = v3.magnitude(v3.getDistanceVector(entity.location, closestSoul.location))
                        if (distance <= 0.5) {
                            try {
                                entity.triggerEvent(`size_up`)
                                closestSoul.remove()
                            } catch { }
                        } else {
                            const db = v3.normalize(v3.getDistanceVector(entity.location, closestSoul.location))
                            entity.applyKnockback({ x: db.x * 0.125, z: db.z * 0.125 }, 0)
                        }
                    }
                }
            }
            break;
        }
        case "udc:dead_undead_register": {
            if (eventId === "revive") {
                entity.addTag(`udc_reviving`)
                dimension.spawnParticle(`udc:evoker_revive`, location)
                dimension.playSound(`trial_spawner.charge_activate`, location)
                system.runTimeout(() => {
                    dimension.spawnParticle(`udc:evoker_revive_explosion`, location)
                    dimension.playSound(`random.totem`, location)
                    dimension.spawnEntity(entity.getDynamicProperty(`udcDeadEntityId`), location, { initialEvent: `minecraft:entity_spawned` })
                    entity.remove()
                }, 2 * 20)
            }
            break;
        }
        case "udc:iron_golem": {
            if (eventId === "patrol_leader") {
                const followersToSpawn = (4 + Math.round(3 * Math.random()))
                for (let i = 0; i < followersToSpawn; i++) summonPatrolFollower(dimension, location)
                summonPatrolFollower(dimension, location, `udc:evoker`)
            } else if (eventId === "check_for_nearby_zombies") {
                const nearestThrowableZombie = dimension.getEntities({ families: [`undead`], maxDistance: 16, location }).filter(e => validThrowTarget(e))[0]
                const nearestValidTarget = dimension.getEntities({ location, excludeFamilies: [`undead`], maxDistance: 15 }).filter(e => e.matches({ families: [`player`] }) || e.matches({ families: [`mob`] }))[0]
                if (nearestThrowableZombie && (entity.getProperty(`udc:should_ranged`) || entity.getProperty(`udc:attack_mode`) == 1)) {
                    const rideable = entity.getComponent(`minecraft:rideable`)
                    if (rideable && rideable.getRiders().length == 0 && !entity.getProperty(`udc:pulling_mob`) && entity.getProperty(`udc:attack_mode`) != 3) {
                        entity.triggerEvent(`pulling_mob`)
                    }
                }
                if (entity.getProperty(`udc:attack_mode`) == 0 && (nearestValidTarget || !nearestThrowableZombie)) {
                    entity.addEffect(`speed`, 5, { amplifier: 1, showParticles: false })
                }
            } else if (eventId === "pulling_mob") {
                const initialTick = system.currentTick
                const pullMob = dimension.getEntities({ families: [`undead`], maxDistance: 16, location }).filter(e => validThrowTarget(e))[0]
                let tentacles = undefined
                const id = system.runInterval(() => {
                    if (pullMob?.isValid) {
                        let time = system.currentTick - initialTick
                        switch (time) {
                            case 13:
                                try {
                                    tentacles = dimension.spawnEntity(`udc:silverfish_tentacles`, pullMob.location)
                                    tentacles.getComponent(`minecraft:rideable`).addRider(pullMob)
                                } catch { system.clearRun(id) }
                                break
                            case 23:
                                try { pullMob.addEffect(`invisibility`, 10, { showParticles: false }) } catch { system.clearRun(id) }
                                break
                            case 28:
                                try { entity.getComponent(`minecraft:rideable`).addRider(pullMob) } catch { system.clearRun(id) }
                                break
                        }
                    } else {
                        system.clearRun(id)
                    }
                })
            } else if (eventId === "do_melee1") {
                dimension.getEntities({ location, maxDistance: 2.5, excludeFamilies: [`undead`], excludeTypes: [`minecraft:item`] }).forEach((e) => {
                    if (e.isOnGround) {
                        e.applyDamage(10, { cause: `contact`, damagingEntity: entity })
                        const knv = v3.normalize(v3.getDistanceVector(location, e.location))
                        try { e.applyKnockback({ x: knv.x * 2, z: knv.z * 2 }, 1) } catch { }
                    }
                })
            } else if (eventId === "do_melee2") {
                ironGolemMelee2(entity)
            } else if (eventId === "silverfish_damage") {
                dimension.getEntities({ location, maxDistance: 1.25, excludeFamilies: [`undead`], excludeTypes: [`minecraft:item`] }).forEach((e) => {
                    e.applyDamage(2, { cause: `entityAttack`, damagingEntity: entity })
                })
            }
            break;
        }
        case "minecraft:iron_golem": {
            if (eventId === "minecraft:from_player") {
                const player = dimension.getPlayers({ location, maxDistance: 7, closest: 1 })[0]
                if (player) {
                    entity.remove()
                    const newGolem = dimension.spawnEntity(`udc:iron_golem_spawner`, location)
                    newGolem.getComponent(`minecraft:projectile`).owner = player
                    newGolem.triggerEvent(`t`)
                } else {
                    entity.removeTag(`testFor`)
                }
            }
            break;
        }
        case "udc:spider": {
            if (eventId === "unstuck") {
                if (entity.getProperty(`udc:magnitude`) > 0 && entity.getProperty(`udc:magnitude`) === entity.getProperty(`udc:pmagnitude`)) {
                    entity.triggerEvent(`melee`)
                } else {
                    entity.setProperty(`udc:pmagnitude`, entity.getProperty(`udc:magnitude`))
                }
            }
            break;
        }
    }
})

// ---------------------------------------------------------
// BEFORE ENTITY HEAL (CONSOLIDATED)
// ---------------------------------------------------------
// ---------------------------------------------------------
// BEFORE ENTITY HEAL (CONSOLIDATED)
// ---------------------------------------------------------
world.beforeEvents.entityHeal.subscribe((e) => {
    const { healedEntity, healSource } = e
    

    // Zombified players can't be healed by potion-cause healing (EntityHealCause.Heal)
    if (healedEntity.typeId === `minecraft:player` && healedEntity.hasTag(`udc_zombified`) && healSource.cause === server.EntityHealCause.Heal) {
        system.run(()=>{
            healedEntity.applyDamage(e.healing,{cause:`selfDestruct`})
        })
        e.cancel = true
        
    }
})



// ---------------------------------------------------------
// SYSTEM INTERVAL & RUNNERS
// ---------------------------------------------------------
system.runInterval(() => {
    if (system.currentTick % 2 == 1) {
        server.DimensionTypes.getAll().forEach((d) => {
            const dimension = world.getDimension(d.typeId)
            dimension.getEntities({ type: `udc:fleshbound_soul` }).forEach(entity => {
                const skinId = entity.getComponent(`minecraft:skin_id`).value
                if (skinId != 3) {
                    const closestSoul = dimension.getEntities({ type: `udc:fleshbound_soul`, location: entity.location }).forEach
                }
            })
        })
    }

    world.getAllPlayers().forEach((player) => {
        const { dimension, location } = player
        const zombieHitBoxId = player.getDynamicProperty(`udc:zombie_hitbox_id`)
        const zombieHitbox = zombieHitBoxId ? world.getEntity(zombieHitBoxId) : undefined
        const hasZombietag = player.hasTag(`udc_zombified`)

        if(hasZombietag){
            player.removeEffect(`poison`)
            player.removeEffect(`regeneration`)
            player.addEffect(`night_vision`,20*10,{showParticles:false})
            player.addEffect(`water_breathing`,20*1,{showParticles:false})
        }

        // ZOMBIE PLAYER SUNBURN LOGIC (Checked every 20 ticks/1 sec)
        if (hasZombietag && system.currentTick % 20 === 0) {
            checkZombieSunburn(player, system.currentTick);
        }

        // --- Health and Game Modes ---
        const healthComp = player.getComponent(`minecraft:health`)
        const isAlive = healthComp ? healthComp.currentValue > 0 : false
        const isCreative = player.matches({ gameMode: server.GameMode.creative })
        const isSpectator = player.matches({ gameMode: server.GameMode.spectator })

        const shouldHaveHitbox = hasZombietag && isAlive && !isCreative && !isSpectator

        if (shouldHaveHitbox && !zombieHitbox) {
            const newZombieHitbox = dimension.spawnEntity(`udc:player_zombie_hitbox`, location)
            player.setDynamicProperty(`udc:zombie_hitbox_id`, newZombieHitbox.id)
            newZombieHitbox.setDynamicProperty(`udc:linked_player_id`, player.id)
            return
        }

        if (!shouldHaveHitbox && zombieHitbox) {
            zombieHitbox.remove()
            player.setDynamicProperty(`udc:zombie_hitbox_id`, undefined)
            return
        }

        if (zombieHitbox) {
            zombieHitbox.teleport(location)
        }
    })
})


// ---------------------------------------------------------
// ENTITY SPAWN (CONSOLIDATED)
// ---------------------------------------------------------
world.afterEvents.entitySpawn.subscribe(({ cause, entity }) => {
    const typeId = entity.typeId

    switch (typeId) {
        case "udc:zombie_charge":
        case "udc:zombie_riptide": {
            const zombie = entity.getComponent(`minecraft:projectile`).owner
            zombie.runCommand(`ride @s start_riding @e[c=1,type=${typeId}]`)
            if (typeId === `udc:zombie_charge`) {
                zombie.setProperty(`udc:leaping`, 1)
                let groundCounter = 0
                const id = system.runInterval(() => {
                    let { dimension, location } = zombie
                    let target = dimension.getEntities({ location, closest: 1, maxDistance: 2, excludeFamilies: [`zombie`] })[0]
                    if (target != undefined) {
                        zombie.runCommand(`ride @e[c=1,family=!zombie] start_riding @s`)
                        target.applyDamage(4, { cause: `contact`, damagingEntity: zombie })
                        system.clearRun(id)
                    }
                    if (zombie.isOnGround) groundCounter++
                    if (!zombie.location || groundCounter >= 20) system.clearRun(id)
                })
            } else {
                zombie.setProperty(`udc:riptide`, 1)
            }
            break;
        }
        case "udc:zombie_irongolem_throw": {
            const zombie = entity.getComponent(`minecraft:projectile`).owner
            if (zombie?.typeId === `udc:iron_golem`) {
                const rider = zombie.getComponent(`minecraft:rideable`).getRiders()[0]
                if (rider) {
                    entity.getComponent(`minecraft:projectile`).owner = rider
                    zombie.getComponent(`minecraft:rideable`).ejectRiders()
                    entity.getComponent(`minecraft:rideable`).addRider(rider)
                }
            }
            break;
        }
        case "udc:spider_shoot": {
            const spider = entity.getComponent(`minecraft:projectile`).owner
            if (spider) followShootedhead(spider, entity)
            break;
        }
    }
})


// ---------------------------------------------------------
// PROJECTILE HIT ENTITY & BLOCK (CONSOLIDATED)
// ---------------------------------------------------------
world.afterEvents.projectileHitEntity.subscribe((callback) => {
    const { dimension, location, projectile, source } = callback
    const target = callback.getEntityHit().entity

    if (projectile.typeId === `udc:spider_shoot`) {
        target.dimension.playSound(`udc.zombie_spider.head_impact`, target.location)
        target.dimension.spawnParticle(`udc:spider_head_hit`, target.location)
        const spider = callback.source
        const hitLocation = v3.getDistanceVector(target.location, callback.location)

        if (!target.matches({ families: [`zombie`] }) && target.typeId != `udc:spider_shoot`) {
            spider.addTag(`willPull`)
            spiderPullTarget(spider, target, hitLocation)
        }
        try { projectile.remove() } catch { }
    }

    if (projectile?.typeId == `udc:zombie_pearl`) {
        source.teleport(location)
        world.playSound(`random.teleport`, location)
        try { projectile.remove() } catch { }
    }
})

world.afterEvents.projectileHitBlock.subscribe(({ dimension, location, projectile, source }) => {
    if (projectile.typeId === `udc:spider_shoot`) projectile.remove()
    if (projectile?.typeId == `udc:zombie_pearl`) {
        source.teleport(location)
        world.playSound(`random.teleport`, location)
        projectile.remove()
    }
})



// ---------------------------------------------------------
// ---------------------------------------------------------
// SCRIPT EVENT RECEIVE (CONSOLIDATED)
// ---------------------------------------------------------
system.afterEvents.scriptEventReceive.subscribe((event) => {
    const { id, message, sourceEntity } = event;
    
    if (id == `udc:riptide`) {
        try { sourceEntity.setProperty(`udc:riptide`, parseInt(message, 10)) } catch { }
    }
    if (id == `udc:leaping`) {
        try { sourceEntity.setProperty(`udc:leaping`, parseInt(message, 10)) } catch { }
    }
    if (id == `udc:zombie_build`) {
        handleZombieBuilding(sourceEntity);
    }
    // NEW: Catch the mine event from the JSON timer
    if (id == `udc:zombie_mine`) {
        handleZombieMining(sourceEntity);
    }
});


// ---------------------------------------------------------
// BEFORE ENTITY HURT (CONSOLIDATED & CLEANED)
// ---------------------------------------------------------
world.beforeEvents.entityHurt.subscribe((e) => {
    const { damage, damageSource, hurtEntity } = e
    const { cause, damagingEntity } = damageSource

    // Custom Player Hitbox Handling
    if (hurtEntity.typeId === `udc:player_zombie_hitbox`) {
        const playerId = hurtEntity.getDynamicProperty(`udc:linked_player_id`)
        const player = playerId ? world.getEntity(playerId) : undefined
        if (player) {
            if (cause === `entityAttack`) {
                system.run(() => {
                    if (playerId) player.applyDamage(damage, { cause, damagingEntity })
                })
            }
        } else {
            system.run(() => { hurtEntity.remove() })
        }
        e.cancel = true
        return // Early return since the hitbox itself doesn't need zombification
    }

    // Allow self-inflicted damage (e.g. a zombified player damaging themselves) to
    // bypass friendly fire cancellation - detected by comparing nametags rather than
    // strict reference equality, since the damaging/hurt entity references can differ.
    const isSelfInflicted = damagingEntity?.nameTag && hurtEntity?.nameTag && damagingEntity.nameTag === hurtEntity.nameTag

    // Treat magic damage from a witch, a player, or self-inflicted as Potion of Harming -
    // since undead entities are healed (not hurt) by it, cancel the damage and heal instead.
    if (hurtEntity.hasTag(`udc_zombified`) && cause === `magic`) {
        const isFromWitch = damagingEntity?.typeId === `minecraft:witch`
        const isFromPlayer = damagingEntity?.typeId === `minecraft:player`

        if (isFromWitch || isFromPlayer || isSelfInflicted) {
            e.cancel = true

            // Deferred because before-events run in read-only mode; health mutation isn't allowed here.
            system.run(() => {
                if (!hurtEntity.isValid) return
                const health = hurtEntity.getComponent(`minecraft:health`)
                if (health) {
                    const newValue = Math.min(health.currentValue + damage, health.effectiveMax)
                    health.setCurrentValue(newValue)
                }
            })
            return
        }
    }

    // Call external helper for Friendly Fire
    if (!isSelfInflicted && checkZombieFriendlyFire(hurtEntity, damagingEntity)) {
        e.cancel = true;
        return;
    }

    // Call external helper for Slime Split Logic
    if (handleSlimeSplit(hurtEntity, Math.ceil(damage), cause, e)) {
        return; // Early return to bypass zombification checks since it split
    }

    // Call external helper for Fatal Zombification Logic
    if (handleFatalZombification(hurtEntity, damagingEntity, damage, cause)) {
        e.cancel = true;
    }
})



// ---------------------------------------------------------
// AFTER ENTITY HURT (CONSOLIDATED)
// ---------------------------------------------------------
// ---------------------------------------------------------
// AFTER ENTITY HURT (CONSOLIDATED)
// ---------------------------------------------------------
world.beforeEvents.entityHurt.subscribe((e) => {
    const { damage, damageSource, hurtEntity } = e
    const { cause, damagingEntity } = damageSource

    // Custom Player Hitbox Handling
    if (hurtEntity.typeId === `udc:player_zombie_hitbox`) {
        const playerId = hurtEntity.getDynamicProperty(`udc:linked_player_id`)
        const player = playerId ? world.getEntity(playerId) : undefined
        if (player) {
            if (cause === `entityAttack`) {
                system.run(() => {
                    if (playerId) player.applyDamage(damage, { cause, damagingEntity })
                })
            }
        } else {
            system.run(() => { hurtEntity.remove() })
        }
        e.cancel = true
        return // Early return since the hitbox itself doesn't need zombification
    }

    // Allow self-inflicted damage (e.g. a zombified player damaging themselves) to
    // bypass friendly fire cancellation - detected by comparing nametags rather than
    // strict reference equality, since the damaging/hurt entity references can differ.
    const isSelfInflicted = damagingEntity?.nameTag && hurtEntity?.nameTag && damagingEntity.nameTag === hurtEntity.nameTag

    // Treat magic damage from a witch, a player, self-inflicted, or with no attributable
    // damaging entity (e.g. a lingering cloud) as Potion of Harming - since undead entities
    // are healed (not hurt) by it, cancel the damage and heal instead.
    if (hurtEntity.hasTag(`udc_zombified`) && cause === `magic`) {
        const isFromWitch = damagingEntity?.typeId === `minecraft:witch`
        const isFromPlayer = damagingEntity?.typeId === `minecraft:player`
        const hasNoDamagingEntity = !damagingEntity

        if (isFromWitch || isFromPlayer || isSelfInflicted || hasNoDamagingEntity) {
            e.cancel = true

            // Deferred because before-events run in read-only mode; health mutation isn't allowed here.
            system.run(() => {
                if (!hurtEntity.isValid) return
                const health = hurtEntity.getComponent(`minecraft:health`)
                if (health) {
                    const newValue = Math.min(health.currentValue + damage, health.effectiveMax)
                    health.setCurrentValue(newValue)
                }
            })
            return
        }
    }

    // Call external helper for Friendly Fire
    if (!isSelfInflicted && checkZombieFriendlyFire(hurtEntity, damagingEntity)) {
        e.cancel = true;
        return;
    }

    // Call external helper for Slime Split Logic
    if (handleSlimeSplit(hurtEntity, Math.ceil(damage), cause, e)) {
        return; // Early return to bypass zombification checks since it split
    }

    // Call external helper for Fatal Zombification Logic
    if (handleFatalZombification(hurtEntity, damagingEntity, damage, cause)) {
        e.cancel = true;
    }
})


// ---------------------------------------------------------
// AFTER ENTITY DIE (CONSOLIDATED)
// ---------------------------------------------------------
world.afterEvents.entityDie.subscribe((event) => {
    const { damageSource, deadEntity } = event
    if (!deadEntity) return;
    if (damageSource.cause === `selfDestruct`) return
    if(!deadEntity?.isValid) return

    const typeId = deadEntity.typeId
    const { dimension, location } = deadEntity

    // Call Helper to handle infection chance on non-zombie players
    if (typeId === "minecraft:player" && !deadEntity.hasTag("udc_zombified")) {
        handlePlayerDeathInfection(deadEntity, damageSource);
    }

    // General (non-typeId dependent checks)
    try {
        if (deadEntity.matches({ families: [`undead`] }) && typeId != `minecraft:player` && typeId != `udc:slime` && (deadEntity.getComponent(`minecraft:health`).effectiveMax > 10)) {
            const player = dimension.getPlayers({ location, maxDistance: 40 })[0]
            if (player) {
                const entitySpawn = dimension.spawnEntity(`udc:dead_undead_register`, location)
                if (deadEntity.hasTag(`udc_horde`)) entitySpawn.addTag(`udc_horde`)
                entitySpawn.setDynamicProperty(`udcDeadEntityId`, typeId)
            }
            if (deadEntity.matches({ families: [`zombie`] }) && Math.random() <= 0.25) {
                const silverfishAmount = Math.floor(1 + Math.random() * 3.5)
                for (let i = 0; i < silverfishAmount; i++) {
                    let silverfish = dimension.spawnEntity(`udc:silverfish`, location, { initialEvent: `minecraft:entity_transformed` })
                    silverfish.applyKnockback({ x: Math.random() * 0.5, z: Math.random() * 0.5 }, 0.25)
                }
            }
        }
    } catch { }

    // Switch for Specific TypeIDs
    switch (typeId) {
        case "udc:spider_head_hitbox": {
            deadEntity.remove()
            break;
        }
        case "udc:haunted_zombie_head": {
            deadEntity.runCommand(`playsound trial_spawner.spawn_mob @a[r=15] ~~~ 8 1`)
            dimension.spawnParticle(`udc:soulfire_haunted_head_death`, location)
            dimension.getEntities({ location, maxDistance: 3, excludeFamilies: [`undead`] }).forEach((e) => {
                e.applyDamage(5, { cause: `entityAttack`, damagingEntity: deadEntity })
            })
            deadEntity.remove()
            break;
        }
        case "udc:rotten_flesh_mound": {
            if (damageSource?.damagingEntity?.typeId === `udc:rotten_flesh_mound`) {
                deadEntity.remove()
                damageSource.damagingEntity.triggerEvent(`transform`)
            }
            break;
        }
        case "minecraft:player": {
            const zombieHitBoxId = deadEntity.getDynamicProperty(`udc:zombie_hitbox_id`)
            const zombieHitbox = zombieHitBoxId ? world.getEntity(zombieHitBoxId) : undefined
            if (zombieHitbox) {
                try { zombieHitbox.remove() } catch { }
            }
            break;
        }
        case "udc:iron_golem": {
            deadEntity.triggerEvent(`decrease_silverifish_count`)
            const silerfish_count = deadEntity.getProperty(`udc:silverfish_count`)
            for (let i = 0; i < silerfish_count; i++) {
                let silverfish = dimension.spawnEntity(`udc:silverfish`, location, { initialEvent: `minecraft:entity_transformed` })
                silverfish.applyKnockback({ x: Math.random() * 0.25, z: Math.random() * 0.25 }, 0.25)
            }
            break;
        }
    }
})


// ---------------------------------------------------------
// PLAYER SPAWN (NEW: Handles infections on respawn)
// ---------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    
    if (event.initialSpawn === false && player.getDynamicProperty(`udc_pending_infection`)) {
        player.addTag(`udc_zombified`);
        player.setDynamicProperty(`udc_pending_infection`, false);
        player.sendMessage("§cYou have joined the undead horde...");
        player.playSound("mob.zombie.say");
    }
});


// ---------------------------------------------------------
// PLAYER LEAVE (CONSOLIDATED)
// ---------------------------------------------------------
world.beforeEvents.playerLeave.subscribe((event) => {
    const player = event.player;
    const zombieHitBoxId = player.getDynamicProperty(`udc:zombie_hitbox_id`);
    if (zombieHitBoxId) {
        system.run(() => {
            const hitbox = world.getEntity(zombieHitBoxId);
            if (hitbox) {
                hitbox.remove();
            }
        });
    }
});