import { world, system } from "@minecraft/server";
console.warn("[infection] entityHurt+Hit actionbar");

const PLUS1 = new Set(["udaw:zombiecomun","udaw:zombierange"]);
const PLUS3 = new Set(["udaw:zombie_shovel","udaw:zombieminer","udaw:zombiewc","udaw:plzombie"]);
const map = new Map();
function getInf(p){ return map.get(p.id) ?? 0; }
function setInf(p,v){
    const c=Math.max(0,Math.min(100,v|0));
    map.set(p.id,c);
    return c;
}
function bar(v){
    const f=Math.round(v/10);
    return "Infeccion ["+"I".repeat(f)+"-".repeat(10-f)+"] "+v+"/100";
}
function addInf(player, zid){
    let pts=5;
    if(PLUS1.has(zid)) pts=1;
    else if(PLUS3.has(zid)) pts=3;
    const nxt=setInf(player, getInf(player)+pts);
    console.warn("[infection] "+player.name+" "+zid+" -> "+nxt);
    try{ player.onScreenDisplay.setActionBar(bar(nxt)); }catch(e){ console.warn("[infection] bar fail "+e); }
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
    try{ p.onScreenDisplay.setActionBar(bar(nxt)); }catch(_){}
    console.warn("[infection] food "+id+" "+d+" -> "+nxt);
}
try{
    world.afterEvents.itemCompleteUse.subscribe(ev=>{
        const p=ev.source;
        if(!p || p.typeId!=="minecraft:player") return;
        const id=ev.itemStack?.typeId;
        if(!id) return;
        let isFood=false;
        try{ if(ev.itemStack.getComponent("minecraft:food")!==undefined) isFood=true; }catch(_){}
        if(!isFood) return;
        handleFood(p,id);
    });
    console.warn("[infection] food ok");
}catch(e){ console.warn("[infection] food fail "+e); }

try{
    world.afterEvents.playerPlaceBlock.subscribe(ev=>{
        const p=ev.player;
        if(!p) return;
        if(Math.random()<0.5){
            const nxt=setInf(p,getInf(p)-1);
            try{ p.onScreenDisplay.setActionBar(bar(nxt)); }catch(_){}
            console.warn("[infection] place -1 -> "+nxt);
        }
    });
    console.warn("[infection] place ok");
}catch(e){ console.warn("[infection] place fail "+e); }

try{
    system.afterEvents.scriptEventReceive.subscribe(ev=>{
        if(ev.id==="udaw:get_infection"){
            const p=ev.sourceEntity;
            if(p) try{ p.onScreenDisplay.setActionBar(bar(getInf(p))); }catch(_){}
        }
    });
    console.warn("[infection] scriptEvent ok");
}catch(e){ console.warn("[infection] scriptEvent fail "+e); }

console.warn("[infection] ready entityHurt");
