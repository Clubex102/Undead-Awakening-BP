import { system, world, EntityComponentTypes } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const noBlood = new Set([
 "minecraft:armor_stand","minecraft:iron_golem","minecraft:snow_golem",
 "minecraft:magma_cube","minecraft:slime","minecraft:shulker",
 "minecraft:skeleton","minecraft:stray","minecraft:wither_skeleton","minecraft:wither"
]);

const airborneBleeders = new Set([
 "minecraft:allay","minecraft:vex","minecraft:blaze","minecraft:phantom","minecraft:ghast",
 "minecraft:bee","minecraft:parrot","minecraft:bat","minecraft:ender_dragon"
]);

const passable = new Set([
 "minecraft:short_grass","minecraft:tallgrass","minecraft:fern","minecraft:large_fern",
 "minecraft:deadbush","minecraft:snow_layer","minecraft:vine","minecraft:glow_lichen",
 "minecraft:tripwire","minecraft:seagrass","minecraft:kelp","minecraft:lever"
]);

const blockedPoolTop = new Set([
 "minecraft:short_grass","minecraft:tallgrass","minecraft:fern","minecraft:large_fern",
 "minecraft:deadbush","minecraft:vine","minecraft:glow_lichen","minecraft:seagrass",
 "minecraft:kelp","minecraft:snow_layer"
]);

const hurt = new Map();
const screenHudCache = new Map();
let poolsThisTick = 0;
const screenDefaultMigrationTag = "bloodfx_screen_default_low_v223";

function decoration(id) {
 if (passable.has(id)) return true;
 return ["_flower","_sapling","_mushroom","_roots","_torch","_rail","_carpet","_pressure_plate","_button","_candle"]
   .some(x => id.endsWith(x));
}

function bleeds(e) {
 return !!e && !noBlood.has(e.typeId);
}

function safeType(block) {
 try { return block?.typeId?.toLowerCase() || ""; } catch { return ""; }
}

function blockedTop(block) {
 const id = safeType(block);
 return !!block && (!block.isAir || block.isLiquid || blockedPoolTop.has(id) || decoration(id));
}

function findPoolSurface(dim,pos,maxDepth=48) {
 try {
  const x=Math.floor(pos.x), z=Math.floor(pos.z), sy=Math.floor(pos.y);
  for(let d=0; d<maxDepth; d++) {
   const y=sy-d;
   const ground=dim.getBlock({x,y,z});
   if(!ground) continue;
   const groundId=safeType(ground);
   if(ground.isAir || ground.isLiquid || decoration(groundId)) continue;
   const above=dim.getBlock({x,y:y+1,z});
   if(blockedTop(above)) return null;
   return {x:pos.x,y:y+1.014,z:pos.z};
  }
 } catch {}
 return null;
}

function particle(dim,id,pos) {
 if(!pos) return;
 try { dim.spawnParticle(id,pos); } catch {}
}

function pool(dim,pos,big=false,dead=false) {
 if(poolsThisTick>34) return;
 const center=findPoolSurface(dim,pos,64);
 if(!center) return;
 poolsThisTick++;

 if(dead) {
  const dm=deathMode();
  const deadBase=dm==="small" ? "pool_dead_small" : dm==="large" ? "pool_dead_large" : "pool_dead";
  particle(dim,poolParticle(deadBase),center);
  const ringBase=dm==="small" ? 5 : dm==="large" ? 13 : 9;
  const ring=ringBase+Math.floor(Math.random()*3);
  const maxRadius=dm==="small" ? 0.62 : dm==="large" ? 1.25 : 0.94;
  for(let i=0;i<ring;i++) {
   const a=Math.random()*Math.PI*2;
   const r=0.18+Math.sqrt(Math.random())*maxRadius;
   const p={x:center.x+Math.cos(a)*r,y:center.y,z:center.z+Math.sin(a)*r};
   system.runTimeout(()=>{
    const id=["pool_a","pool_b","pool_c"][Math.floor(Math.random()*3)];
    particle(dim,poolParticle(id),findPoolSurface(dim,p,6));
   },2+i);
  }
  return;
 }

 const ids=["pool_a","pool_b","pool_c"];
 const mult=amountMultiplier();
 const count=Math.max(1,Math.round((big?18:5+Math.floor(Math.random()*5))*mult));
 const radius=big?1.5:0.55+Math.random()*0.45;

 for(let i=0;i<count;i++) {
  const a=Math.random()*Math.PI*2;
  const r=i===0?0:Math.sqrt(Math.random())*radius;
  const p={x:center.x+Math.cos(a)*r,y:center.y,z:center.z+Math.sin(a)*r};
  system.runTimeout(()=>{
   particle(dim,poolParticle(ids[Math.floor(Math.random()*ids.length)]),findPoolSurface(dim,p,6));
  },i*(big?2:3));
 }
}

function sprayFor(damage) {
 if(damage>=9) return "bloodfx:spray_heavy";
 if(damage>=4) return "bloodfx:spray_medium";
 return "bloodfx:spray_light";
}

function directionalDrops(dim,victim,source,damage) {
 if(!source?.location) return;
 const v=victim.location,s=source.location;
 let dx=v.x-s.x,dz=v.z-s.z;
 const len=Math.hypot(dx,dz)||1;
 dx/=len; dz/=len;
 const n=Math.min(24,Math.max(1,Math.ceil(Math.min(10,Math.max(3,Math.ceil(damage/2)))*amountMultiplier())));
 for(let i=1;i<=n;i++) {
  const spread=(Math.random()-.5)*0.68;
  particle(dim,"bloodfx:drop",{
   x:v.x+dx*(i*.13)+(-dz)*spread,
   y:v.y+.58+Math.random()*.58,
   z:v.z+dz*(i*.13)+(dx)*spread
  });
 }
}


function screenMode(player) {
 try {
  if(player.hasTag("bloodfx_screen_low")) return "low";
  if(player.hasTag("bloodfx_screen_medium")) return "medium";
  if(player.hasTag("bloodfx_screen_high")) return "high";
  if(player.hasTag("bloodfx_screen_off")) return "off";
 } catch {}
 try {
  const v=Number(player.getProperty("bloodfx:screen_mode_id"));
  if(v===1) return "low"; if(v===2) return "medium"; if(v===3) return "high"; if(v===0) return "off";
 } catch {}
 return "off";
}

function setScreenMode(player,mode) {
 const id=mode==="low"?1:mode==="medium"?2:mode==="high"?3:0;
 try {
  for(const tag of ["bloodfx_screen_low","bloodfx_screen_medium","bloodfx_screen_high","bloodfx_screen_off"]) {
   if(player.hasTag(tag)) player.removeTag(tag);
  }
  player.addTag(`bloodfx_screen_${mode}`);
 } catch {}
 try { player.setProperty("bloodfx:screen_mode_id",id); } catch {}
 try { player.setProperty("bloodfx:screen_flash",0); } catch {}
}

function worldSetting(key,def="normal") {
 try {
  const v=world.getDynamicProperty(`bloodfx_${key}`);
  return typeof v==="string" ? v : def;
 } catch { return def; }
}

function setWorldSetting(key,value) {
 try { world.setDynamicProperty(`bloodfx_${key}`,value); } catch {}
}


function refreshBloodSettings(player) {
 system.run(()=>openBloodSettings(player));
}

async function chooseScreen(player) {
 const current=screenMode(player);
 const form=new ActionFormData()
  .title("BloodFX - Screen Effects")
  .body(`Current: ${current.toUpperCase()}\n\nDefault: LOW`)
  .button("OFF")
  .button("LOW")
  .button("MEDIUM")
  .button("HIGH")
  .button("Back");
 try {
  const r=await form.show(player);
  if(r.canceled || r.selection===4) return openBloodSettings(player);
  const modes=["off","low","medium","high"];
  if(modes[r.selection]) setScreenMode(player,modes[r.selection]);
  return refreshBloodSettings(player);
 } catch {}
}

async function chooseGlobal(player,key,title,values) {
 const current=worldSetting(key,"normal");
 const form=new ActionFormData().title(`BloodFX - ${title}`).body(`Current: ${current.toUpperCase()}\n\nDefault: NORMAL`);
 for(const value of values) form.button(value==="very_long"?"VERY LONG":value.toUpperCase());
 form.button("Back");
 try {
  const r=await form.show(player);
  if(r.canceled || r.selection===values.length) return refreshBloodSettings(player);
  const value=values[r.selection];
  if(value) setWorldSetting(key,value);
  return refreshBloodSettings(player);
 } catch {}
}

async function resetBloodDefaults(player) {
 setScreenMode(player,"low");
 setWorldSetting("amount","normal");
 setWorldSetting("ground","normal");
 setWorldSetting("death","normal");
 try { player.sendMessage("§7[§cBloodFX§7] §aDefaults restored. Screen Blood is LOW."); } catch {}
 return refreshBloodSettings(player);
}

async function openBloodSettings(player) {
 if(!player || player.typeId!=="minecraft:player") return;

 const screen=screenMode(player);
 const amount=worldSetting("amount","normal");
 const ground=worldSetting("ground","normal");
 const death=worldSetting("death","normal");
 const groundLabel=ground==="very_long"?"VERY LONG":ground.toUpperCase();

 const form=new ActionFormData()
  .title("BloodFX Settings")
  .body(`Screen: ${screen.toUpperCase()}\nBlood Amount: ${amount.toUpperCase()}\nGround Blood: ${groundLabel}\nDeath Effects: ${death.toUpperCase()}`)
  .button("Screen Effects")
  .button("Blood Amount")
  .button("Ground Blood")
  .button("Death Effects")
  .button("Reset to Default")
  .button("Close");
 try {
  const r=await form.show(player);
  if(r.canceled || r.selection===5) return;
  if(r.selection===0) return chooseScreen(player);
  if(r.selection===1) return chooseGlobal(player,"amount","Blood Amount",["low","normal","high","extreme"]);
  if(r.selection===2) return chooseGlobal(player,"ground","Ground Blood",["short","normal","long","very_long"]);
  if(r.selection===3) return chooseGlobal(player,"death","Death Effects",["small","normal","large"]);
  if(r.selection===4) return resetBloodDefaults(player);
 } catch {}
}


function amountMultiplier() {
 const v=worldSetting("amount","normal");
 if(v==="low") return 0.55;
 if(v==="high") return 1.55;
 if(v==="extreme") return 2.25;
 return 1;
}

function groundMode() { return worldSetting("ground","normal"); }
function deathMode() { return worldSetting("death","normal"); }

function poolParticle(base) {
 const mode=groundMode();
 if(mode==="normal") return `bloodfx:${base}`;
 const suffix=mode==="very_long" ? "very_long" : mode;
 return `bloodfx:${base}_${suffix}`;
}
const screenFade = new Map();

function playerScreenHit(player,damage) {
 if(player?.typeId!=="minecraft:player") return;
 const mode=screenMode(player);
 if(mode==="off") return;
 const hitLevel=mode==="low" ? 1 : mode==="high" ? 3 : 2;
 screenFade.set(player.id,{player,level:hitLevel,next:system.currentTick+12});
 updateScreenHud(player,true);
}

function screenBloodLevel(player,mode) {
 let health=20;
 try {
  const h=player.getComponent(EntityComponentTypes.Health);
  health=Number(h?.currentValue ?? 20);
 } catch {}
 if(mode==="low") return health>10?0:(health<=2?5:health<=4?4:health<=6?3:health<=8?2:1);
 if(mode==="medium") return health>11?0:(health<=6?5:health<=8?4:health<=9?3:health<=10?2:1);
 if(mode==="high") return health>16?0:(health<=8?5:health<=10?4:health<=12?3:health<=14?2:1);
 return 0;
}

function screenHudState(player) {
 const flash=screenFade.get(player.id)?.level || 0;
 if(flash>0) return `§0BFX_HIT_${flash}`;
 const mode=screenMode(player);
 const level=screenBloodLevel(player,mode);
 return level>0 ? `§0BFX_${mode.toUpperCase()}_${level}` : "§0BFX_OFF";
}

function updateScreenHud(player,force=false) {
 try {
  const tick=system.currentTick;
  const state=screenHudState(player);
  const old=screenHudCache.get(player.id);
  if(!force && old?.state===state && tick-old.tick<20) return;
  player.onScreenDisplay.setActionBar(state);
  screenHudCache.set(player.id,{state,tick});
 } catch {}
}


system.afterEvents.scriptEventReceive.subscribe(ev=>{
 if(ev.id!=="bloodfx:settings") return;
 const player=ev.sourceEntity;
 if(player?.typeId!=="minecraft:player") return;
 system.run(()=>openBloodSettings(player));
});

function healthRatio(e) {
 try {
  const h=e.getComponent(EntityComponentTypes.Health);
  return h ? h.currentValue/h.effectiveMax : 1;
 } catch { return 1; }
}

function damageCause(ev) {
 return String(ev?.damageSource?.cause || "").toLowerCase();
}

function hasExternalAttacker(ev) {
 return !!(ev?.damageSource?.damagingEntity || ev?.damageSource?.damagingProjectile);
}

function hasGroundNearby(dim,pos,depth=3) {
 try {
  const x=Math.floor(pos.x), z=Math.floor(pos.z), sy=Math.floor(pos.y);
  for(let d=0; d<=depth; d++) {
   const b=dim.getBlock({x,y:sy-d,z});
   if(b && !b.isAir && !b.isLiquid) return true;
  }
 } catch {}
 return false;
}

function suppressAirborneAutoBlood(e,ev) {
 if(!airborneBleeders.has(e?.typeId)) return false;
 if(hasExternalAttacker(ev)) return false;
 const cause=damageCause(ev);
 if(cause && !cause.includes("fire") && !cause.includes("lava") && !cause.includes("void") && !cause.includes("magic") && !cause.includes("none")) return false;
 return !hasGroundNearby(e.dimension,e.location,4);
}

world.afterEvents.playerSpawn.subscribe(ev=>{
 const p=ev.player;
 system.runTimeout(()=>{
  try {
   if(!p.hasTag(screenDefaultMigrationTag)) {
    setScreenMode(p,"low");
    p.addTag(screenDefaultMigrationTag);
    return;
   }
   setScreenMode(p,screenMode(p));
  } catch {}
 },10);
});

system.runInterval(()=>{
 const tick=system.currentTick;
 for(const [id,r] of screenFade) {
  let ok=true; try { ok=r.player.isValid; } catch { ok=false; }
  if(!ok) { screenFade.delete(id); continue; }
  if(tick<r.next) continue;
  r.level=Math.max(0,r.level-1);
  if(r.level<=0) screenFade.delete(id); else r.next=tick+12;
  updateScreenHud(r.player,true);
 }
},1);

system.runInterval(()=>{
 for(const player of world.getAllPlayers()) updateScreenHud(player);
},10);

world.afterEvents.entityHurt.subscribe(ev=>{
 const e=ev.hurtEntity;
 if(!bleeds(e) || suppressAirborneAutoBlood(e,ev)) return;

 const damage=Math.max(0,Number(ev.damage)||0);
 playerScreenHit(e,damage);
 const dim=e.dimension;
 const pos={...e.location};
 const impact={x:pos.x,y:pos.y+Math.min(1.25,0.55+(damage*.025)),z:pos.z};

 const spray=sprayFor(damage);
 const mult=amountMultiplier();
 if(mult>=0.9 || Math.random()<mult) particle(dim,spray,impact);
 if(mult>1.25) particle(dim,"bloodfx:spray_light",{x:impact.x+(Math.random()-.5)*.08,y:impact.y,z:impact.z+(Math.random()-.5)*.08});
 if(mult>2.0) particle(dim,"bloodfx:spray_medium",{x:impact.x+(Math.random()-.5)*.12,y:impact.y,z:impact.z+(Math.random()-.5)*.12});
 directionalDrops(dim,e,ev.damageSource?.damagingEntity,damage);

 const ratio=healthRatio(e);
 if(damage>=1.5) pool(dim,pos,damage>=10,false);

 const gm=groundMode();
 const trailTicks=gm==="short" ? 28 : gm==="long" ? 150 : gm==="very_long" ? 260 : Math.min(100,35+Math.ceil(damage*4));
 hurt.set(e.id,{
  entity:e,dim,
  until:system.currentTick+trailTicks,
  next:system.currentTick+8,
  trail:ratio<=0.5,
  suppress:suppressAirborneAutoBlood(e,ev)
 });
});

world.afterEvents.entityDie.subscribe(ev=>{
 const e=ev.deadEntity;
 if(!bleeds(e) || suppressAirborneAutoBlood(e,ev)) return;
 const rec=hurt.get(e.id);
 hurt.delete(e.id);
 const dim=rec?.dim||e.dimension;
 const pos=e.location || rec?.entity?.location;
 particle(dim,"bloodfx:spray_heavy",{x:pos.x,y:pos.y+.65,z:pos.z});
 pool(dim,pos,true,true);
});

system.runInterval(()=>{
 poolsThisTick=0;
 const tick=system.currentTick;

 for(const [id,r] of hurt) {
  if(tick>r.until) { hurt.delete(id); continue; }

  let ok=true;
  try { ok=r.entity.isValid; } catch { ok=false; }
  if(!ok) { hurt.delete(id); continue; }

  if(r.trail && !r.suppress && tick>=r.next) {
   const p={...r.entity.location};
   particle(r.dim,"bloodfx:drop",{x:p.x+(Math.random()-.5)*.25,y:p.y+.15,z:p.z+(Math.random()-.5)*.25});
   if(Math.random()<Math.min(0.9,0.55*amountMultiplier())) pool(r.dim,p,false,false);
   r.next=tick+10+Math.floor(Math.random()*8);
  }
 }
},1);
