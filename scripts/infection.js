import { world, system, InputButton, ButtonState } from "@minecraft/server";
console.warn("[infection] entityHurt+Hit actionbar");

const map = new Map();
function getInf(p){
    if(map.has(p.id)) return map.get(p.id);
    let value=0;
    try{ value=Math.max(0,Math.min(100,Number(p.getDynamicProperty("udaw:infection"))||0)); }catch(_){ }
    map.set(p.id,value);
    return value;
}
function hudState(value){
    if(value<=0) return "INFECTION_OFF";
    if(value<=25) return "INFECTION_LVL1";
    if(value<=50) return "INFECTION_LVL2";
    if(value<=75) return "INFECTION_LVL3";
    return "INFECTION_LVL4";
}
function setInf(p,v){
    const c=Math.max(0,Math.min(100,v|0));
    map.set(p.id,c);
    try{ p.setDynamicProperty("udaw:infection", c); }catch(_){}
    updateDebuffs(p,c);
    try{ p.onScreenDisplay.setActionBar(hudState(c)); }catch(_){ }
    return c;
}

world.afterEvents.playerSpawn.subscribe(ev=>{
    system.run(()=>{
        const player=ev.player;
        setInf(player,getInf(player));
    });
});

world.afterEvents.entityDie.subscribe(ev=>{
    const player=ev.deadEntity;
    if(!player || player.typeId!=="minecraft:player") return;
    setInf(player,0);
});

function updateDebuffs(player, lvl){
    try{
        try{ player.removeEffect("slowness"); }catch(_){}
        try{ player.removeEffect("weakness"); }catch(_){}
        try{ player.removeEffect("nausea"); }catch(_){}
        try{ player.removeEffect("wither"); }catch(_){}
        try{ player.removeEffect("mining_fatigue"); }catch(_){}
        const DUR = 1000000;
        if(lvl>=91){
            try{ player.addEffect("wither", DUR, {amplifier:0, showParticles:false}); }catch(_){}
            try{ player.addEffect("slowness", DUR, {amplifier:1, showParticles:false}); }catch(_){}
            try{ player.addEffect("weakness", DUR, {amplifier:1, showParticles:false}); }catch(_){}
            try{ player.addEffect("mining_fatigue", DUR, {amplifier:0, showParticles:false}); }catch(_){}
        }else if(lvl>=81){
            try{ player.addEffect("slowness", DUR, {amplifier:1, showParticles:false}); }catch(_){}
            try{ player.addEffect("weakness", DUR, {amplifier:1, showParticles:false}); }catch(_){}
            try{ player.addEffect("nausea", 100, {amplifier:0, showParticles:false}); }catch(_){}
        }else if(lvl>=61){
            try{ player.addEffect("slowness", DUR, {amplifier:1, showParticles:false}); }catch(_){}
            try{ player.addEffect("weakness", DUR, {amplifier:0, showParticles:false}); }catch(_){}
        }else if(lvl>=41){
            try{ player.addEffect("slowness", DUR, {amplifier:0, showParticles:false}); }catch(_){}
            try{ player.addEffect("weakness", DUR, {amplifier:0, showParticles:false}); }catch(_){}
        }else if(lvl>=21){
            try{ player.addEffect("slowness", DUR, {amplifier:0, showParticles:false}); }catch(_){}
        }
        // HUD overlay gris via hud_screen.json alpha = q.get_dynamic_property('udaw:infection')/200 (0-0.5)
    }catch(e){ console.warn("[infection] debuff fail "+e); }
}
function bar(v){
    const f=Math.round(v/10);
    return "Infeccion ["+"I".repeat(f)+"-".repeat(10-f)+"] "+v+"/100";
}
function addInf(player, zid){
    const pts=2;
    const nxt=setInf(player, getInf(player)+pts);
    console.warn("[infection] "+player.name+" "+zid+" -> "+nxt);
    return nxt;
}

// melee fiable
try{
    world.afterEvents.entityHitEntity.subscribe(ev=>{
        const hit=ev.hitEntity, dam=ev.damagingEntity;
        if(!hit || hit.typeId!=="minecraft:player") return;
        if(!dam) return;
        const zid=dam.typeId;
        if(zid.indexOf("zombie")===-1 && zid.indexOf("plzombie")===-1) return;
        addInf(hit, zid);
    });
    console.warn("[infection] hitEntity ok");
}catch(e){ console.warn("[infection] hitEntity fail "+e); }

// daño general + proyectiles
try{
    world.afterEvents.entityHurt.subscribe(ev=>{
        const hurt=ev.hurtEntity;
        if(!hurt || hurt.typeId!=="minecraft:player") return;
        let src=ev.damageSource?.damagingEntity;
        if(!src) return;
        let zid=src.typeId;
        if(zid==="minecraft:arrow" || zid==="minecraft:snowball"){
            try{
                const comp=src.getComponent("minecraft:projectile");
                const own=comp&&comp.owner;
                if(own) zid=own.typeId;
            }catch(_){}
        }
        if(zid.indexOf("zombie")===-1) return;
        // evitar doble conteo melee ya contado por hitEntity: solo contar proyectil aquí
        if(ev.damageSource?.cause==="entityAttack") return;
        addInf(hurt, zid);
    });
    console.warn("[infection] hurt ok");
}catch(e){ console.warn("[infection] hurt fail "+e); }

function handleFood(p,id){
    let d=0;
    if(id==="minecraft:golden_apple"||id==="minecraft:enchanted_golden_apple") d=-15;
    else if(id==="minecraft:golden_carrot") d=-20;
    else if(id==="minecraft:rotten_flesh") d=5;
    else d=-3;
    const nxt=setInf(p,getInf(p)+d);
    console.warn("[infection] food "+id+" "+d+" -> "+nxt);
}
try{
    world.afterEvents.itemCompleteUse.subscribe(ev=>{
        try{
            console.warn("[infection] itemCompleteUse "+ev.itemStack?.typeId+" by "+ev.source?.name);
            const p=ev.source;
            if(!p || p.typeId!=="minecraft:player") return;
            const id=ev.itemStack?.typeId;
            if(!id) return;
            // específicos primero
            if(id==="minecraft:golden_apple"||id==="minecraft:enchanted_golden_apple"){ handleFood(p,id); return; }
            if(id==="minecraft:golden_carrot"){ handleFood(p,id); return; }
            if(id==="minecraft:rotten_flesh"){ handleFood(p,id); return; }
            // genérico: lista + componente
            const foods=new Set(["minecraft:apple","minecraft:bread","minecraft:cooked_beef","minecraft:cooked_chicken","minecraft:cooked_porkchop","minecraft:cooked_mutton","minecraft:cooked_rabbit","minecraft:baked_potato","minecraft:cookie","minecraft:melon_slice","minecraft:beetroot","minecraft:beetroot_soup","minecraft:mushroom_stew","minecraft:rabbit_stew","minecraft:pumpkin_pie","minecraft:potato","minecraft:carrot","minecraft:sweet_berries","minecraft:glow_berries","minecraft:dried_kelp","minecraft:chorus_fruit","minecraft:honey_bottle","minecraft:carrot","minecraft:potato","minecraft:beetroot"]);
            let isFood=foods.has(id);
            if(!isFood){
                try{ if(ev.itemStack.getComponent("minecraft:food")!==undefined) isFood=true; }catch(_){}
            }
            if(isFood) handleFood(p,id);
            else console.warn("[infection] not food "+id);
        }catch(e){ console.warn("[infection] food handler err "+e); }
    });
    console.warn("[infection] food ok");
}catch(e){ console.warn("[infection] food fail "+e); }

    try{
        world.afterEvents.playerBreakBlock.subscribe(ev=>{
            const p=ev.player;
            if(!p || Math.random()>=0.2) return;
            const nxt=setInf(p,getInf(p)-4);
            console.warn("[infection] break -4 -> "+nxt);
        });
        console.warn("[infection] break ok");
    }catch(e){ console.warn("[infection] break fail "+e); }

    try{
        world.afterEvents.playerButtonInput.subscribe(ev=>{
            if(ev.button!==InputButton.Sneak || ev.newButtonState!==ButtonState.Pressed) return;
            const p=ev.player;
            if(!p || Math.random()>=0.2) return;
            const nxt=setInf(p,getInf(p)-2);
            console.warn("[infection] sneak -2 -> "+nxt);
        });
        console.warn("[infection] sneak ok");
    }catch(e){ console.warn("[infection] sneak fail "+e); }

try{
    world.afterEvents.playerPlaceBlock.subscribe(ev=>{
        const p=ev.player;
        if(!p) return;
        if(Math.random()<0.5){
            const nxt=setInf(p,getInf(p)-1);
            console.warn("[infection] place -1 -> "+nxt);
        }
    });
    console.warn("[infection] place ok");
}catch(e){ console.warn("[infection] place fail "+e); }

try{
    system.afterEvents.scriptEventReceive.subscribe(ev=>{
        if(ev.id==="udaw:get_infection"){
            const p=ev.sourceEntity;
            if(p) try{ p.sendMessage(bar(getInf(p))); }catch(_){}
        }
    });
    console.warn("[infection] scriptEvent ok");
}catch(e){ console.warn("[infection] scriptEvent fail "+e); }

console.warn("[infection] ready entityHurt");
