import { world, system, EntityDamageCause } from "@minecraft/server";

// ───────── Configuración (cambia aquí tu namespace, ritual y números) ─────────
const BOSS = "udaw:headless_rider";
const MUSIC_ID = "udaw.ghosts_n_heroes";
const MUSIC_NOTICE = "§e» Ghosts n' Heroes §7— §fComposer / Compositor: §eBOBJT";
const HAY = "minecraft:hay_block"; // base del espantapájaros
const FACES = ["minecraft:carved_pumpkin", "minecraft:lit_pumpkin"]; // cabeza del espantapájaros
const MINION_TAG = "udaw_headless_rider_minion";
const MAX_MINIONS = 6;
const THINK_EVERY = 5; // ticks entre decisiones (un solo bucle, solo recorre jefes vivos)

// ───────── Utilidades ─────────
const bosses = new Map(); // id -> estado
const later = (t, fn) =>
  system.runTimeout(() => {
    try { fn(); } catch (e) { console.warn(`[jinete] ${e}`); }
  }, t);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dirTo = (a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
};
const key = (l) => `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
const players = (boss, r) => boss.dimension.getPlayers({ location: boss.location, maxDistance: r });
const say = (boss, msg) => { for (const p of players(boss, 64)) p.onScreenDisplay.setActionBar(msg); };
const sound = (boss, id, vol = 3, pitch = 0.8) => { try { boss.runCommand(`playsound ${id} @a ~ ~ ~ ${vol} ${pitch}`); } catch { /* sin efecto */ } };
let laughFlip = false;
function laugh(boss, which = 0) {
  if (!which) { laughFlip = !laughFlip; which = laughFlip ? 1 : 2; }
  sound(boss, which === 1 ? "udaw.headless_rider.laugh1" : "udaw.headless_rider.laugh2", 4, 1);
}
const fx = (boss, id, loc) => { try { boss.dimension.spawnParticle(id, loc ?? boss.location); } catch { /* sin efecto */ } };
const fxAt = (dim, id, loc) => { try { dim.spawnParticle(id, loc); } catch { /* sin efecto */ } };
const ring = (dim, c, r, n, id, dy = 0.3) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    fxAt(dim, id, { x: c.x + Math.cos(a) * r, y: c.y + dy, z: c.z + Math.sin(a) * r });
  }
};
const hurt = (p, boss, n) => {
  try { p.applyDamage(n, { cause: EntityDamageCause.entityAttack, damagingEntity: boss }); } catch { /* sin efecto */ }
};
// Si cambias la versión del módulo, solo toca esta función (la firma cambió en 2.x)
const knock = (p, dx, dz, h, v) => { try { p.applyKnockback({ x: dx, z: dz }, h, v); } catch { /* sin efecto */ } };
const phaseOf = (boss) => {
  const h = boss.getComponent("minecraft:health");
  const f = h.currentValue / h.effectiveMax;
  return f > 0.6 ? 1 : f > 0.3 ? 2 : 3;
};
// ═══════════════════════════════════════════════════════════════════════════
//  ANIMACIONES DEL JINETE: lo que hay que añadir al script
//
//  A) Pega este bloque justo ANTES de "// ───────── Movimientos" (cerca de las utilidades).
//  B) Haz los 6 cambios pequeños de abajo.
// ═══════════════════════════════════════════════════════════════════════════

const ANIM_NS = "animation.udaw_headless_rider";
const play = (boss, name) => {
  try { boss.playAnimation(`${ANIM_NS}.${name}`); } catch { /* sin efecto */ }
};

// ataque -> [[ticks de espera, animación], ...]
// (tajo y galope reproducen la suya dentro de su propia función, ver cambios 1 y 2)
const ANIMS = {
  onda:         [[0, "stomp"]],
  calabazas:    [[8, "pumpkin"]],   // los lanzamientos de la animación caen en 15, 25 y 35 ticks
  salto:        [[0, "jump"]],
  torbellino:   [[0, "spin"]],
  gancho:       [[0, "chain"]],
  meteoros:     [[0, "sky"]],
  suelo:        [[0, "curse"]],
  aparicion:    [[0, "vanish"], [20, "appear"]],
  cabeza:       [[0, "stunned"]],
  convocatoria: [[0, "summon"]],
};
function playMove(boss, name) {
  for (const [wait, anim] of ANIMS[name] ?? []) {
    if (wait) later(wait, () => { if (boss.isValid) play(boss, anim); });
    else play(boss, anim);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  B) CAMBIOS
//
//  1. En `tajo`, primera línea de la función:
//         play(boss, "slash");
//
//  2. En `galope`, justo después de `sound(boss, "mob.horse.angry");`:
//         play(boss, "chargue");
//         later(24, () => play(boss, "gallop"));   // 24 ticks = cuando empieza la embestida
//     (la doble embestida llama a `galope` dos veces, así que se anima sola)
//
//  3. En `think`, justo después de `const dur = ab.run(boss, t, s, ph);`:
//         playMove(boss, name);
//
//  4. En `think`, dentro del `if (ph > s.phase) {`, junto al `sound(...)`:
//         play(boss, "roar");
//
//  5. En `endHead`, justo después de `s.headless = false;`:
//         play(boss, "recover");
//
//  6. En el registro del cliente (headless_rider.entity.json, "animations"), añade
//     las animaciones nuevas, con la clave corta que quieras:
//         "stomp":   "animation.udaw_headless_rider.stomp",
//         "chain":   "animation.udaw_headless_rider.chain",
//         "spin":    "animation.udaw_headless_rider.spin",
//         "sky":     "animation.udaw_headless_rider.sky",
//         "curse":   "animation.udaw_headless_rider.curse",
//         "vanish":  "animation.udaw_headless_rider.vanish",
//         "appear":  "animation.udaw_headless_rider.appear",
//         "summon":  "animation.udaw_headless_rider.summon",
//         "stunned": "animation.udaw_headless_rider.stunned",
//         "recover": "animation.udaw_headless_rider.recover",
//         "roar":    "animation.udaw_headless_rider.roar",
//         "gallop":  "animation.udaw_headless_rider.gallop"
//     (slash, chargue, pumpkin y jump ya los tienes; si no los registraste así, hazlo igual)
// ═════════════                  ══════════════════════════════════════════════════════════════                                                                                                                         
                                        
// ─────────                                         Movimientos (cada uno devuelve cuántos ticks dura) ─────────

// 1) Tajo en arco: golpe frontal con derribo
function tajo(boss, t) {
  play(boss, "slash");
  boss.teleport(boss.location, { facingLocation: t.location });
  sound(boss, "mob.horse.angry");
  later(12, () => {
    if (!boss.isValid) return;
    const v = boss.getViewDirection();
    const l = Math.hypot(v.x, v.z) || 1;
    const f = { x: v.x / l, z: v.z / l };
    for (const p of players(boss, 5.5)) {
      const d = dirTo(boss.location, p.location);
      if (d.x * f.x + d.z * f.z > 0.25) { hurt(p, boss, 8); knock(p, d.x, d.z, 1.6, 0.5); }
    }
    fx(boss, "minecraft:large_explosion", { x: boss.location.x + f.x * 2.5, y: boss.location.y + 1.2, z: boss.location.z + f.z * 2.5 });
    fx(boss, "udaw:headless_slash", { x: boss.location.x + f.x * 2.5, y: boss.location.y + 1.3, z: boss.location.z + f.z * 2.5 });
    for (let k = -4; k <= 4; k++) {
      const a = k * 0.3, c = Math.cos(a), sn = Math.sin(a);
      const rx = f.x * c - f.z * sn, rz = f.x * sn + f.z * c;
      for (const r of [2, 3.5, 5]) {
        const point = { x: boss.location.x + rx * r, y: boss.location.y + 1.3, z: boss.location.z + rz * r };
        if (k % 2 === 0) fx(boss, "minecraft:basic_flame_particle", point);
      }
    }
  });
  return 20;
}

// 2) Galope: línea de aviso y embestida en línea recta
function galope(boss, t, s) {
  const d = dirTo(boss.location, t.location);
  const o = boss.location;
  boss.teleport(o, { facingLocation: t.location });
  sound(boss, "mob.horse.angry");
  play(boss, "chargue");
  later(24, () => play(boss, "gallop"));
  for (const w of [0, 8, 16]) {
    later(w, () => {
      for (let i = 1; i <= 12; i++) fx(boss, "udaw:headless_charge_trail", { x: o.x + d.x * i * 2, y: o.y + 0.3, z: o.z + d.z * i * 2 });
    });
  }
  later(24, () => {
    const hit = new Set();
    let n = 0;
    const run = system.runInterval(() => {
      if (!boss.isValid || n++ >= 14) { system.clearRun(run); return; }
      const sv = boss.getVelocity();
      if (n > 5 && Math.hypot(sv.x, sv.z) < 0.12) { system.clearRun(run); crash(boss, s); return; }
      boss.applyImpulse({ x: d.x * 0.55, y: 0, z: d.z * 0.55 });
      fx(boss, "udaw:headless_charge_trail");
      fx(boss, "minecraft:basic_smoke_particle", { x: boss.location.x, y: boss.location.y + 0.8, z: boss.location.z });
      for (const p of players(boss, 2.6)) {
        if (hit.has(p.id)) continue;
        hit.add(p.id);
        hurt(p, boss, 10);
        knock(p, d.x, d.z, 2.2, 0.6);
      }
    }, 2);
  });
  return 54;
}

// 3) Calabazas ardientes: ráfaga de proyectiles con modelo propio
function calabazas(boss, t, s, ph) {
  const shots = ph === 3 ? 5 : 3;
  laugh(boss, 1);
  for (let i = 0; i < shots; i++) {
    later(15 + i * 8, () => {
      if (!boss.isValid || !t.isValid) return;
      const b = boss.location, to = t.location;
      fx(boss, "minecraft:large_explosion", { x: b.x, y: b.y + 2.4, z: b.z });
      const d = { x: to.x - b.x, y: to.y + 1 - (b.y + 2.4), z: to.z - b.z };
      const l = Math.hypot(d.x, d.y, d.z) || 1;
      const u = { x: d.x / l, y: d.y / l, z: d.z / l };
      const projectileLoc = { x: b.x + u.x * 1.6, y: b.y + 2.4 + u.y * 1.6, z: b.z + u.z * 1.6 };
      const pumpkinProjectile = boss.dimension.spawnEntity("udaw:headless_pumpkin_projectile", projectileLoc);
      const pr = pumpkinProjectile.getComponent("minecraft:projectile");
      pr.owner = boss;
      pr.shoot({ x: u.x * 1.6, y: u.y * 1.6, z: u.z * 1.6 });
      let trailTicks = 0;
      const trail = system.runInterval(() => {
        if (!pumpkinProjectile.isValid || trailTicks++ >= 60) {
          system.clearRun(trail);
          return;
        }
        fxAt(boss.dimension, "udaw:headless_pumpkin_trail", pumpkinProjectile.location);
      }, 2);
    });
  }
  return 15 + shots * 8;
}

// 4) Relincho y salto: onda expansiva e invocación de zombis
function salto(boss) {
  sound(boss, "mob.horse.angry");
  boss.applyImpulse({ x: 0, y: 1.1, z: 0 });
  later(22, () => {
    if (!boss.isValid) return;
    fx(boss, "minecraft:huge_explosion_emitter");
    fx(boss, "udaw:headless_hoof_impact", { x: boss.location.x, y: boss.location.y + 0.1, z: boss.location.z });
    ring(boss.dimension, boss.location, 7, 32, "minecraft:basic_flame_particle");
    ring(boss.dimension, boss.location, 3.5, 20, "minecraft:basic_smoke_particle", 0.5);
    sound(boss, "random.explode");
    for (const p of players(boss, 7)) {
      const d = dirTo(boss.location, p.location);
      hurt(p, boss, 9);
      knock(p, d.x, d.z, 2.0, 0.9);
    }
    const alive = boss.dimension.getEntities({ tags: [MINION_TAG], location: boss.location, maxDistance: 40 }).length;
    for (let i = alive; i < Math.min(MAX_MINIONS, alive + 3); i++) {
      const a = Math.random() * Math.PI * 2;
      const z = boss.dimension.spawnEntity("minecraft:zombie", { x: boss.location.x + Math.cos(a) * 4, y: boss.location.y, z: boss.location.z + Math.sin(a) * 4 });
      z.addTag(MINION_TAG);
    }
  });
  return 30;
}

// 5) La cabeza rodante: lanza su calabaza lejos y queda aturdido hasta que la rompan
function cabeza(boss, t, s) {
  const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 4;
  const x = Math.floor(boss.location.x + Math.cos(a) * r), z = Math.floor(boss.location.z + Math.sin(a) * r);
  const top = boss.dimension.getTopmostBlock({ x, z });
  if (!top) return 10;
  const loc = { x, y: top.location.y + 1, z };
  const blk = boss.dimension.getBlock(loc);
  if (!blk) return 10;
  blk.setType("minecraft:carved_pumpkin");
  s.headless = true;
  s.headLoc = key(loc);
  s.headBlock = loc;
  say(boss, "§6¡El Jinete lanzó su calabaza! Rómpela antes de que la recupere.");
  sound(boss, "mob.horse.death");
  laugh(boss, 1);
  boss.addEffect("slowness", 240, { amplifier: 2, showParticles: false });
  let n = 0;
  s.beacon = system.runInterval(() => {
    if (!s.headless || !boss.isValid) { system.clearRun(s.beacon); return; }
    fx(boss, "minecraft:basic_flame_particle", { x: loc.x + 0.5, y: loc.y + 1 + (n++ % 8) * 0.4, z: loc.z + 0.5 });
  }, 4);
  s.headTimer = later(240, () => endHead(s, false));
  return 245;
}

function endHead(s, broken) {
  if (!s.headless) return;
  s.headless = false;
  play(s.boss, "recover");
  system.clearRun(s.beacon);
  system.clearRun(s.headTimer);
  const boss = s.boss;
  try {
    const b = boss.dimension.getBlock(s.headBlock);
    if (b && b.typeId === "minecraft:carved_pumpkin") b.setType("minecraft:air");
  } catch { /* chunk descargado */ }
  if (!boss.isValid) return;
  if (broken) {
    const h = boss.getComponent("minecraft:health");
    boss.applyDamage(h.effectiveMax * 0.08);
    s.busyUntil = system.currentTick + 60;
    s.actUntil = system.currentTick + 60;
    s.stunUntil = system.currentTick + 60;
    s.rideUntil = 0;
    s.speed = 0;
    fx(boss, "minecraft:totem_particle", { x: boss.location.x, y: boss.location.y + 2.5, z: boss.location.z });
    say(boss, "§aLa calabaza se rompió. El Jinete está aturdido.");
  } else {
    boss.addEffect("speed", 200, { amplifier: 1 });
    s.busyUntil = system.currentTick + 10;
    s.actUntil = system.currentTick + 10;
    s.rideUntil = 0;
    say(boss, "§cEl Jinete recuperó su calabaza, ¡y está furioso!");
    laugh(boss, 2);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MOVIMIENTOS NUEVOS DEL JINETE (pegar tal cual)
//
//  1. Borra tu `const ABILITIES = {...};` actual.
//  2. Pega TODO este bloque justo antes de "// ───────── Cerebro del jefe ─────────".
//  3. Opcional (evita que repita el mismo ataque dos veces seguidas): ver el final del archivo.
// ═══════════════════════════════════════════════════════════════════════════

// ───────── Utilidades extra ─────────
// Dibuja una línea de partículas entre dos puntos
const line = (dim, a, b, id, step = 1.2) => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const n = Math.max(1, Math.floor((Math.hypot(dx, dy, dz) || 1) / step));
  for (let i = 0; i <= n; i++) fxAt(dim, id, { x: a.x + (dx * i) / n, y: a.y + (dy * i) / n, z: a.z + (dz * i) / n });
};
// Altura del suelo en (x, z), con respaldo si no se puede calcular
const ground = (dim, x, z, fallbackY) => {
  try {
    const top = dim.getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
    if (top && Math.abs(top.location.y + 1 - fallbackY) < 8) return top.location.y + 1;
  } catch { /* chunk sin cargar */ }
  return fallbackY;
};
const MINION_TYPES = ["minecraft:zombie", "minecraft:skeleton"];

// 6) Onda de choque: pisa el suelo y una ola de fuego avanza en línea recta
function onda(boss, t) {
  const dim = boss.dimension, o = boss.location, d = dirTo(o, t.location);
  boss.teleport(o, { facingLocation: t.location });
  sound(boss, "mob.horse.angry");
  boss.applyImpulse({ x: 0, y: 0.5, z: 0 });
  later(14, () => {
    const hit = new Set();
    let n = 0;
    const run = system.runInterval(() => {
      if (!boss.isValid || n >= 18) { system.clearRun(run); return; }
      n++;
      const c = { x: o.x + d.x * n * 1.3, y: o.y, z: o.z + d.z * n * 1.3 };
      for (const k of [-1, 0, 1]) fxAt(dim, "udaw:headless_charge_trail", { x: c.x - d.z * k, y: c.y + 0.3, z: c.z + d.x * k });
      if (n % 3 === 0) fxAt(dim, "minecraft:large_explosion", { x: c.x, y: c.y + 0.5, z: c.z });
      for (const p of dim.getPlayers({ location: c, maxDistance: 2.2 })) {
        if (hit.has(p.id)) continue;
        hit.add(p.id);
        hurt(p, boss, 7);
        knock(p, d.x, d.z, 1.2, 0.9);
      }
    }, 1);
  });
  return 34;
}

// 7) Cadenas espectrales: engancha a un jugador lejano, lo arrastra y lo remata con un tajo
function gancho(boss, t) {
  const dim = boss.dimension;
  boss.teleport(boss.location, { facingLocation: t.location });
  say(boss, "§5¡Cadenas espectrales!");
  sound(boss, "mob.horse.angry");
  laugh(boss, 2);
  const hand = () => ({ x: boss.location.x, y: boss.location.y + 2, z: boss.location.z });
  const chest = () => ({ x: t.location.x, y: t.location.y + 1, z: t.location.z });
  for (const w of [0, 8]) {
    later(w, () => { if (boss.isValid && t.isValid) line(dim, hand(), chest(), "minecraft:basic_smoke_particle"); });
  }
  later(18, () => {
    if (!boss.isValid || !t.isValid) return;
    const dist = flat(boss.location, t.location);
    if (dist > 36) return;
    line(dim, hand(), chest(), "udaw:grapple_trail", 0.8);
    hurt(t, boss, 4);
    let pulls = 0;
    const pull = system.runInterval(() => {
      if (!boss.isValid || !t.isValid || pulls++ >= 6 || flat(boss.location, t.location) < 3) {
        system.clearRun(pull);
        return;
      }
      const d = dirTo(t.location, boss.location);
      const strength = Math.min(0.55, Math.max(0.3, flat(boss.location, t.location) * 0.025));
      try { t.applyImpulse({ x: d.x * strength, y: 0.04, z: d.z * strength }); } catch { /* el objetivo ya no puede moverse */ }
    }, 2);
  });
  later(32, () => { if (boss.isValid && t.isValid && flat(boss.location, t.location) < 7) tajo(boss, t); });
  return 64;
}

// 8) Torbellino: gira sobre sí mismo castigando a todos los que estén cerca
function torbellino(boss) {
  const dim = boss.dimension;
  sound(boss, "mob.horse.angry");
  laugh(boss, 1);
  ring(dim, boss.location, 2.5, 16, "minecraft:basic_smoke_particle", 0.4);
  later(8, () => {
    let n = 0;
    const last = new Map();
    const run = system.runInterval(() => {
      if (!boss.isValid || n >= 6) { system.clearRun(run); return; }
      n++;
      const c = boss.location;
      try { boss.setRotation({ x: 0, y: boss.getRotation().y + 70 }); } catch { /* sin efecto */ }
      ring(dim, c, 4.5, 24, "minecraft:basic_flame_particle", 1.0);
      ring(dim, c, 2.5, 12, "minecraft:basic_smoke_particle", 1.5);
      for (const p of players(boss, 4.8)) {
        if (n - (last.get(p.id) ?? -9) < 2) continue; // como máximo un golpe cada dos giros
        last.set(p.id, n);
        const d = dirTo(c, p.location);
        hurt(p, boss, 5);
        knock(p, d.x, d.z, 1.4, 0.5);
      }
    }, 4);
  });
  return 36;
}

// 9) Lluvia de fuego: marca varios puntos en el suelo y los bombardea con retraso
function meteoros(boss, t, s, ph) {
  const dim = boss.dimension;
  const count = ph === 3 ? 7 : 5;
  const pool = players(boss, 40);
  sound(boss, "mob.horse.death");
  say(boss, "§6¡Llueve fuego!");
  laugh(boss, 2);
  for (let i = 0; i < count; i++) {
    const target = pool.length ? pool[i % pool.length] : t;
    const l = target.location;
    const x = l.x + (i < pool.length ? 0 : (Math.random() - 0.5) * 9);
    const z = l.z + (i < pool.length ? 0 : (Math.random() - 0.5) * 9);
    const c = { x, y: ground(dim, x, z, l.y), z };
    for (const w of [i * 5, i * 5 + 8, i * 5 + 16]) later(w, () => {
      fxAt(dim, "udaw:headless_warning_rune", { x: c.x, y: c.y + 0.04, z: c.z });
      ring(dim, c, 3, 18, "minecraft:basic_flame_particle", 0.2);
    });
    later(i * 5 + 22, () => { for (let h = 1; h <= 10; h++) fxAt(dim, "udaw:headless_charge_trail", { x: c.x, y: c.y + h, z: c.z }); });
    later(i * 5 + 28, () => {
      fxAt(dim, "udaw:headless_meteor_impact", { x: c.x, y: c.y + 0.5, z: c.z });
      ring(dim, c, 3, 20, "minecraft:basic_flame_particle", 0.3);
      for (const p of dim.getPlayers({ location: c, maxDistance: 3.2 })) {
        const d = dirTo(c, p.location);
        hurt(p, boss, 11);
        knock(p, d.x, d.z, 1.5, 0.8);
      }
    });
  }
  return 28 + count * 5;
}

// 10) Suelo maldito: deja un círculo ardiente bajo el jugador que daña y ralentiza (máximo 2 a la vez)
function sueloMaldito(boss, t, s) {
  if ((s.zones ?? 0) >= 2) return 5;
  s.zones = (s.zones ?? 0) + 1;
  const dim = boss.dimension, l = t.location;
  const c = { x: l.x, y: ground(dim, l.x, l.z, l.y), z: l.z };
  sound(boss, "mob.horse.angry");
  fxAt(dim, "udaw:headless_curse_ground", { x: c.x, y: c.y + 0.03, z: c.z });
  ring(dim, c, 5, 28, "minecraft:basic_smoke_particle", 0.3);
  later(20, () => {
    let n = 0;
    const run = system.runInterval(() => {
      if (n++ >= 12 || !boss.isValid) {
        system.clearRun(run);
        s.zones = Math.max(0, (s.zones ?? 1) - 1);
        return;
      }
      ring(dim, c, 5, 28, "minecraft:basic_flame_particle", 0.2);
      ring(dim, c, 2.5, 14, "minecraft:basic_flame_particle", 0.2);
      fxAt(dim, "udaw:headless_curse_ground", { x: c.x, y: c.y + 0.03, z: c.z });
      for (const p of dim.getPlayers({ location: c, maxDistance: 5 })) {
        if (Math.abs(p.location.y - c.y) > 3) continue;
        hurt(p, boss, 3);
        try { p.addEffect("slowness", 30, { amplifier: 0, showParticles: false }); } catch { /* sin efecto */ }
      }
    }, 10);
  });
  return 25;
}

// 11) Aparición fantasma: desaparece y reaparece a la espalda del jugador con un tajo
function aparicion(boss, t) {
  const dim = boss.dimension;
  sound(boss, "mob.endermen.portal");
  laugh(boss, 1);
  fx(boss, "udaw:headless_teleport_out", { x: boss.location.x, y: boss.location.y + 1, z: boss.location.z });
  ring(dim, boss.location, 1.5, 16, "minecraft:basic_smoke_particle", 1);
  boss.addEffect("invisibility", 24, { showParticles: false });
  later(20, () => {
    if (!boss.isValid || !t.isValid) return;
    const l = t.location, v = t.getViewDirection();
    const hl = Math.hypot(v.x, v.z) || 1;
    const free = (p) => [0, 1, 2].every((dy) => dim.getBlock({ x: p.x, y: p.y + dy, z: p.z })?.typeId === "minecraft:air");
    let dest = { x: l.x - (v.x / hl) * 3.5, y: l.y, z: l.z - (v.z / hl) * 3.5 };
    if (!free(dest)) dest = { x: l.x + (v.x / hl) * 3.5, y: l.y, z: l.z + (v.z / hl) * 3.5 };
    if (!free(dest)) return;
    fxAt(dim, "udaw:headless_teleport_in", { x: dest.x, y: dest.y + 1, z: dest.z });
    ring(dim, dest, 1.5, 16, "minecraft:basic_smoke_particle", 1);
    boss.teleport(dest, { facingLocation: l });
    sound(boss, "mob.endermen.portal");
    later(8, () => { if (boss.isValid && t.isValid) tajo(boss, t); });
  });
  return 62;
}

// 12) Llamada de los caídos: levanta zombis y esqueletos (respeta MAX_MINIONS)
function convocatoria(boss) {
  const dim = boss.dimension;
  say(boss, "§8¡Alzaos, caídos!");
  sound(boss, "mob.horse.death");
  laugh(boss, 2);
  ring(dim, boss.location, 5, 28, "minecraft:basic_smoke_particle", 0.3);
  later(20, () => {
    if (!boss.isValid) return;
    const alive = dim.getEntities({ tags: [MINION_TAG], location: boss.location, maxDistance: 40 }).length;
    const n = Math.min(4, MAX_MINIONS - alive);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const pos = { x: boss.location.x + Math.cos(a) * 5, y: boss.location.y, z: boss.location.z + Math.sin(a) * 5 };
      const m = dim.spawnEntity(MINION_TYPES[i % MINION_TYPES.length], pos);
      m.addTag(MINION_TAG);
      try { m.addEffect("fire_resistance", 12000, { showParticles: false }); } catch { /* sin efecto */ }
      fxAt(dim, "udaw:headless_summon_rune", { x: pos.x, y: pos.y + 0.04, z: pos.z });
      for (let h = 0; h < 6; h++) fxAt(dim, "minecraft:basic_flame_particle", { x: pos.x, y: pos.y + h * 0.4, z: pos.z });
    }
  });
  return 40;
}

// 13) Doble embestida: dos galopes seguidos, el segundo se reorienta hacia el jugador
function galopeDoble(boss, t, s, ph) {
  const d1 = galope(boss, t, s);
  later(d1 + 10, () => { if (boss.isValid && t.isValid) galope(boss, t, s); });
  return d1 * 2 + 10;
}

const ABILITIES = {
  // Fase 1 (más del 60 %)
  tajo:         { min: 0,  max: 5.5, cd: 50,  phase: 1, w: 5, run: tajo },
  galope:       { min: 7,  max: 30,  cd: 160, phase: 1, w: 4, run: galope },
  onda:         { min: 4,  max: 24,  cd: 140, phase: 1, w: 3, run: onda },
  // Fase 2 (60 % a 30 %)
  calabazas:    { min: 5,  max: 35,  cd: 200, phase: 2, w: 4, run: calabazas },
  salto:        { min: 0,  max: 12,  cd: 260, phase: 2, w: 3, run: salto },
  torbellino:   { min: 0,  max: 5,   cd: 180, phase: 2, w: 4, run: torbellino },
  gancho:       { min: 10, max: 34,  cd: 220, phase: 2, w: 3, run: gancho },
  meteoros:     { min: 6,  max: 40,  cd: 300, phase: 2, w: 3, run: meteoros },
  suelo:        { min: 0,  max: 30,  cd: 260, phase: 2, w: 2, run: sueloMaldito },
  aparicion:    { min: 8,  max: 35,  cd: 280, phase: 2, w: 3, run: aparicion },
  // Fase 3 (menos del 30 %)
  cabeza:       { min: 0,  max: 99,  cd: 900, phase: 3, w: 6, run: cabeza },
  convocatoria: { min: 0,  max: 40,  cd: 500, phase: 3, w: 3, run: convocatoria },
  doble:        { min: 8,  max: 30,  cd: 340, phase: 3, w: 4, run: galopeDoble },
};

// ═══════════════════════════════════════════════════════════════════════════
//  OPCIONAL: no repetir el mismo ataque dos veces seguidas. En `think`, cambia:
//
//    if (!opts.length) return;
//    let r = Math.random() * opts.reduce((acc, [, a]) => acc + a.w, 0);
//    let pick = opts[0];
//    for (const o of opts) { r -= o[1].w; if (r <= 0) { pick = o; break; } }
//    const [name, ab] = pick;
//
//  por:
//
//    if (!opts.length) return;
//    const fresh = opts.filter(([n]) => n !== s.lastMove);
//    const pool = fresh.length ? fresh : opts;
//    let r = Math.random() * pool.reduce((acc, [, a]) => acc + a.w, 0);
//    let pick = pool[0];
//    for (const o of pool) { r -= o[1].w; if (r <= 0) { pick = o; break; } }
//    const [name, ab] = pick;
//    s.lastMove = name;
// ═══════════════════════════════════════════════════════════════════════════
//  CABALGATA: que el Jinete se mueva como un jinete y no como un mob rápido
//
//   · Inercia: acelera y frena poco a poco (trote → medio galope → galope).
//   · Radio de giro: no puede girar en seco; hace arcos amplios.
//   · Caracolea alrededor del jugador y de vez en cuando hace una PASADA:
//     lo embiste de frente, lo tajea al cruzar y sigue de largo antes de dar la vuelta.
//   · Salta vallas y obstáculos de hasta 2 bloques.
//   · Cascos con ritmo: sonido y polvo (y fuego a galope) según la velocidad real.
//   · Si en la embestida (`galope`) choca contra un muro, se estrella y queda aturdido.
// ═══════════════════════════════════════════════════════════════════════════

// ───────── Ajustes (todo lo que se siente se cambia aquí) ─────────
const RIDE_EVERY = 2;                                  // ticks entre pasos
const SPEED = { canter: 0.34, gallop: 0.52 };          // bloques/tick (un jugador corriendo ≈ 0.28)
const R_ACCEL = 0.03, R_DECEL = 0.05;                  // por paso
const TURN_SLOW = 12, TURN_FAST = 5;                   // grados por paso: parado / a galope (menos = arco más amplio)
const GRIP = 0.5;                                      // cuánto corrige la velocidad (1 = sobre rieles)
const ORBIT_R = { 1: 13, 2: 11, 3: 9 };                // radio del caracoleo por fase
const PASS_EVERY = [100, 180];                         // ticks entre pasadas (mín, máx); fase 3 las acorta
const RIDE_DURING = new Set(["calabazas", "meteoros"]); // ataques que hace sin dejar de cabalgar

const wrapYaw = (y) => ((y + 540) % 360) - 180;
const fwdOf = (yaw) => ({ x: -Math.sin((yaw * Math.PI) / 180), z: Math.cos((yaw * Math.PI) / 180) });

//#steer-begin
// Decide hacia dónde ir y a qué velocidad (función pura, sin API del juego)
function steer(s, pos, tp, ph, now) {
  const dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
  const l = dist || 1;
  const to = { x: (tp.x - pos.x) / l, z: (tp.z - pos.z) / l };
  let dx, dz, target;

  if (s.mode === "pass") {
    dx = to.x; dz = to.z;
    const f = fwdOf(s.yaw);
    const facing = f.x * to.x + f.z * to.z;
    target = facing > 0.82 ? SPEED.gallop : SPEED.canter - 0.04;  // primero se encara, luego galopa
    if (facing < -0.2 || now > s.passEnd) {                       // ya cruzó al jugador: da la vuelta
      s.mode = "orbit";
      s.dir = Math.random() < 0.5 ? -1 : 1;
      s.speed = Math.min(s.speed, SPEED.canter + 0.06);              // frena al cruzar
      const [a, b] = PASS_EVERY;
      s.nextPass = now + (a + Math.random() * (b - a)) * (ph === 3 ? 0.6 : 1);
    }
  } else {
    const R = ORBIT_R[ph] ?? 11;
    const rad = { x: -to.x, z: -to.z };                           // del jugador hacia el jinete
    const tang = { x: -rad.z * s.dir, z: rad.x * s.dir };
    const k = Math.max(-1, Math.min(1.5, (dist - R) / R));        // >0 si está lejos
    dx = tang.x - rad.x * k * 1.6;
    dz = tang.z - rad.z * k * 1.6;
    target = dist > R * 2 ? SPEED.gallop : SPEED.canter;
    if (now >= s.nextPass && dist < R * 1.8) { s.mode = "pass"; s.passEnd = now + 110; s.neighed = false; }
  }
  return { yawTo: (Math.atan2(-dx, dz) * 180) / Math.PI, target };
}
//#steer-end

// Salta obstáculos de 1 o 2 bloques; si es un muro más alto, se desvía
function hop(s, boss, f, now) {
  if (now < s.nextHop || !boss.isOnGround) return;
  const p = boss.location, dim = boss.dimension;
  const bx = p.x + f.x * 1.8, bz = p.z + f.z * 1.8, by = Math.floor(p.y + 0.05);
  const solid = (y) => {
    try {
      const b = dim.getBlock({ x: bx, y, z: bz });
      return !!b && (b.isSolid || /fence|wall|stairs|slab/.test(b.typeId));
    } catch { return false; }
  };
  if (!solid(by)) return;
  const h = !solid(by + 1) ? 1 : !solid(by + 2) ? 2 : 3;
  s.nextHop = now + 10;
  if (h === 3) { s.yaw = wrapYaw(s.yaw + (s.dir > 0 ? 55 : -55)); return; }
  boss.applyImpulse({ x: f.x * 0.12, y: h === 1 ? 0.5 : 0.72, z: f.z * 0.12 });
  sound(boss, "mob.horse.jump");
}

// Cascos: sonido y polvo con el ritmo de la velocidad real; fuego a galope
function hoof(boss, sp) {
  try { boss.runCommand(`playsound mob.horse.gallop @a ~ ~ ~ ${sp > 0.45 ? 3 : 2} ${(0.75 + sp * 0.5).toFixed(2)}`); } catch { /* sin efecto */ }
  const l = boss.location;
  fx(boss, "minecraft:basic_smoke_particle", { x: l.x, y: l.y + 0.2, z: l.z });
  if (sp > 0.45) fx(boss, "minecraft:basic_flame_particle", { x: l.x, y: l.y + 0.1, z: l.z });
}

// Tajo al cruzar: lo hace de pasada, sin detenerse
function flyby(s, boss, t, now) {
  s.nextSlash = now + 40;
  play(boss, "slash");
  sound(boss, "mob.horse.angry");
  const d = dirTo(boss.location, t.location);
  hurt(t, boss, 8);
  knock(t, d.x, d.z, 1.6, 0.5);
  fx(boss, "minecraft:large_explosion", { x: t.location.x, y: t.location.y + 1, z: t.location.z });
  fx(boss, "udaw:headless_slash", { x: t.location.x, y: t.location.y + 1, z: t.location.z });
}

// Choque contra un muro durante la embestida
function crash(boss, s) {
  const now = system.currentTick;
  s.stunUntil = now + 70;
  s.actUntil = now + 70;
  s.busyUntil = Math.max(s.busyUntil, now + 70);
  s.speed = 0;
  play(boss, "roar");
  sound(boss, "mob.horse.land");
  laugh(boss, 2);
  fx(boss, "minecraft:huge_explosion_emitter");
  fx(boss, "udaw:headless_hoof_impact", { x: boss.location.x, y: boss.location.y + 0.1, z: boss.location.z });
  ring(boss.dimension, boss.location, 3, 20, "minecraft:basic_smoke_particle", 0.5);
  boss.addEffect("slowness", 60, { amplifier: 4, showParticles: false });
  boss.applyDamage(boss.getComponent("minecraft:health").effectiveMax * 0.04);
  say(boss, "§a¡El Jinete se estrelló!");
}

function rideStep(s) {
  const boss = s.boss, now = system.currentTick;
  s.mode ??= "orbit"; s.dir ??= 1; s.speed ??= 0; s.actUntil ??= 0; s.rideUntil ??= 0;
  s.stunUntil ??= 0; s.nextPass ??= now + 80; s.nextSlash ??= 0; s.nextHop ??= 0; s.stride ??= 0;

  const free = (now >= s.actUntil || now < s.rideUntil) && !s.headless && now >= s.stunUntil;
  const v = boss.getVelocity();
  const [t] = boss.dimension.getPlayers({ location: boss.location, maxDistance: 48, closest: 1 });

  if (!free || !t) {
    s.riding = false;
    s.speed = Math.hypot(v.x, v.z);
    return;
  }
  if (!s.riding) {                       // recién vuelve a cabalgar tras un ataque
    s.riding = true;
    s.yaw = boss.getRotation().y;
    s.speed = Math.hypot(v.x, v.z);
  }

  const ph = phaseOf(boss);
  const { yawTo, target } = steer(s, boss.location, t.location, ph, now);

  const sp = Math.min(1, s.speed / SPEED.gallop);
  const maxTurn = TURN_SLOW + (TURN_FAST - TURN_SLOW) * sp;
  s.yaw = wrapYaw(s.yaw + Math.max(-maxTurn, Math.min(maxTurn, wrapYaw(yawTo - s.yaw))));
  s.speed += Math.max(-R_DECEL, Math.min(R_ACCEL, target - s.speed));

  const f = fwdOf(s.yaw);
  boss.setRotation({ x: 0, y: s.yaw });
  boss.applyImpulse({ x: (f.x * s.speed - v.x) * GRIP, y: 0, z: (f.z * s.speed - v.z) * GRIP });

  hop(s, boss, f, now);

  const real = Math.hypot(v.x, v.z);
  s.stride += real * RIDE_EVERY;
  if (real > 0.12 && s.stride > 1.7) { s.stride = 0; hoof(boss, real); }

  if (s.mode === "pass") {
    if (!s.neighed) { s.neighed = true; sound(boss, "mob.horse.angry"); }
    if (now >= s.nextSlash && flat(boss.location, t.location) < 3.6) flyby(s, boss, t, now);
  }
}

system.runInterval(() => {
  for (const s of bosses.values()) {
    if (!s.boss.isValid) continue;
    try { rideStep(s); } catch (e) { console.warn(`[jinete] ${e}`); }
  }
}, RIDE_EVERY);

// ───────── Cerebro del jefe ─────────
function think(s) {
  const boss = s.boss;
  const now = system.currentTick;
  const ph = phaseOf(boss);
  const l = boss.location;
  fx(boss, "minecraft:basic_flame_particle", { x: l.x, y: l.y + 2.8, z: l.z });
  if (Math.random() < 0.5) fx(boss, "minecraft:basic_smoke_particle", { x: l.x, y: l.y + 3.1, z: l.z });
  if (ph > s.phase) {
    s.phase = ph;
    s.busyUntil = now + 30;
    s.actUntil = now + 30;
    s.rideUntil = 0;
    sound(boss, "mob.horse.death");
    laugh(boss, ph === 2 ? 1 : 2);
    play(boss, "roar");
    ring(boss.dimension, boss.location, 3, 24, "minecraft:basic_flame_particle", 0.5);
    say(boss, ph === 2 ? "§6El Jinete invoca a los muertos..." : "§4¡El Jinete cabalga con furia!");
    return;
  }
  if (now < s.busyUntil || s.headless) return;
  const [t] = boss.dimension.getPlayers({ location: boss.location, maxDistance: 40, closest: 1 });
  if (!t) return;
  const d = flat(boss.location, t.location);
  const opts = Object.entries(ABILITIES).filter(([n, a]) => ph >= a.phase && d >= a.min && d <= a.max && now >= (s.cd[n] ?? 0));
  if (!opts.length) return;
  let r = Math.random() * opts.reduce((acc, [, a]) => acc + a.w, 0);
  let pick = opts[0];
  for (const o of opts) { r -= o[1].w; if (r <= 0) { pick = o; break; } }
  const [name, ab] = pick;
  const m = ph === 3 ? 0.65 : 1;
  const dur = ab.run(boss, t, s, ph);
  playMove(boss, name);
  s.actUntil = now + dur;
  s.rideUntil = RIDE_DURING.has(name) ? now + dur : 0;
  s.cd[name] = now + ab.cd * m;
  s.busyUntil = Math.max(s.busyUntil, now + dur + Math.round(25 * m));
}

// ───────── Música de la pelea ─────────
// playMusic es por jugador: se limita el alcance a 100 bloques y se corta al morir,
// despawnear o descargarse el chunk.
function stopBossMusic(s) {
  if (!s || !s.music || !s.music.size) return;
  for (const p of world.getAllPlayers()) {
    if (!s.music.has(p.id)) continue;
    try { p.stopMusic(); } catch { /* sin efecto */ }
  }
  s.music.clear();
}

function updateBossMusic(s) {
  const boss = s.boss;
  if (!s.music) s.music = new Set();
  if (!boss.isValid) { stopBossMusic(s); return; }
  const h = boss.getComponent("minecraft:health");
  if (!h || h.currentValue <= 0) { stopBossMusic(s); return; }
  try {
    const l = boss.location;
    if (!boss.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) })) { stopBossMusic(s); return; }
  } catch { stopBossMusic(s); return; }

  const near = boss.dimension.getPlayers({ location: boss.location, maxDistance: 100 });
  const inRange = new Set(near.map((p) => p.id));
  for (const p of near) {
    if (s.music.has(p.id)) continue;
    try { p.playMusic(MUSIC_ID, { loop: true, volume: 1, fade: 0.5 }); } catch { continue; }
    s.music.add(p.id);
    try { p.onScreenDisplay.setActionBar(MUSIC_NOTICE); } catch { /* sin efecto */ }
  }

  if (!s.music.size) return;
  const all = world.getAllPlayers();
  for (const id of [...s.music]) {
    if (inRange.has(id)) continue;
    const p = all.find((x) => x.id === id);
    if (p) { try { p.stopMusic(); } catch { /* sin efecto */ } }
    s.music.delete(id);
  }
}

// ───────── Registro de jefes ─────────
function register(e) {
  if (e.typeId !== BOSS || bosses.has(e.id)) return;
  bosses.set(e.id, { boss: e, busyUntil: system.currentTick + 40, cd: {}, phase: 1, headless: false, music: new Set() });
}
world.afterEvents.entitySpawn.subscribe((ev) => register(ev.entity));
world.afterEvents.entityRemove.subscribe((ev) => {
  const s = bosses.get(ev.removedEntityId);
  if (s) stopBossMusic(s);
  bosses.delete(ev.removedEntityId);
});

system.runInterval(() => {
  for (const s of bosses.values()) {
    try { updateBossMusic(s); } catch (e) { console.warn(`[jinete] ${e}`); }
  }
}, 20);

// Recupera jefes ya existentes al recargar el mundo (barato: cada 10 s)
system.runInterval(() => {
  for (const id of ["overworld", "nether", "the_end"]) {
    for (const e of world.getDimension(id).getEntities({ type: BOSS })) register(e);
  }
}, 200);

// Único bucle: solo recorre jefes vivos
system.runInterval(() => {
  for (const [id, s] of bosses) {
    if (!s.boss.isValid) { stopBossMusic(s); bosses.delete(id); continue; }
    try { think(s); } catch (e) { console.warn(`[jinete] ${e}`); }
  }
}, THINK_EVERY);

// Romper la calabaza termina el aturdimiento
world.afterEvents.playerBreakBlock.subscribe((ev) => {
  const k = key(ev.block.location);
  for (const s of bosses.values()) if (s.headless && s.headLoc === k) endHead(s, true);
});

// ───────── Ritual del espantapájaros ─────────
// Bloque de paja + calabaza tallada encima. El jefe aparece alrededor, no sobre la estructura.
const ritualBusy = new Set();

function cackle(dim, loc) {
  [0, 12, 26].forEach((t, i) => later(t, () => {
    const id = i % 2 ? "udaw.headless_rider.laugh2" : "udaw.headless_rider.laugh1";
    try { dim.runCommand(`playsound ${id} @a ${loc.x} ${loc.y} ${loc.z} 4 ${0.55 + i * 0.12}`); } catch { /* sin efecto */ }
  }));
}

function findSpot(dim, c) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 4;
    const x = Math.floor(c.x + Math.cos(a) * r), z = Math.floor(c.z + Math.sin(a) * r);
    try {
      const top = dim.getTopmostBlock({ x, z });
      if (!top) continue;
      const y = top.location.y + 1;
      if (Math.abs(y - c.y) > 5) continue;
      return { x: x + 0.5, y, z: z + 0.5 };
    } catch { /* chunk sin cargar */ }
  }
  return { x: c.x + 5, y: c.y, z: c.z + 0.5 };
}

function startRitual(dim, hayLoc, faceLoc) {
  const k = key(hayLoc);
  if (ritualBusy.has(k)) return;
  if (dim.getEntities({ type: BOSS, location: hayLoc, maxDistance: 120 }).length) return;
  ritualBusy.add(k);
  const c = { x: hayLoc.x + 0.5, y: hayLoc.y + 1, z: hayLoc.z + 0.5 };
  const spot = findSpot(dim, c);
  cackle(dim, c);
  for (const p of dim.getPlayers({ location: c, maxDistance: 40 })) p.sendMessage("§6§oUna risa resuena entre los campos...");
  let n = 0;
  const swirl = system.runInterval(() => {
    n++;
    ring(dim, c, 0.8 + n * 0.12, 14, "minecraft:basic_flame_particle", 0.6);
    ring(dim, c, 1.4, 8, "minecraft:basic_smoke_particle", 1 + (n % 5) * 0.3);
    fxAt(dim, "minecraft:basic_flame_particle", { x: spot.x, y: spot.y + (n % 6) * 0.5, z: spot.z });
  }, 4);
  later(60, () => {
    system.clearRun(swirl);
    ritualBusy.delete(k);
    const h = dim.getBlock(hayLoc), f = dim.getBlock(faceLoc);
    if (h?.typeId !== HAY || !FACES.includes(f?.typeId)) return; // lo destruyeron antes de tiempo
    h.setType("minecraft:air");
    f.setType("minecraft:air");
    ring(dim, c, 1.5, 24, "minecraft:large_explosion", 0.8);
    dim.spawnEntity("minecraft:lightning_bolt", spot);
    const boss = dim.spawnEntity(BOSS, spot);
    boss.addEffect("resistance", 100, { amplifier: 4, showParticles: false });
    cackle(dim, spot);
    world.sendMessage("§6§l¡El Jinete sin Cabeza cabalga esta noche!");
  });
}

function checkScarecrow(block) {
  const dim = block.dimension, { x, y, z } = block.location;
  let hay, face;
  if (block.typeId === HAY) { hay = block; face = dim.getBlock({ x, y: y + 1, z }); }
  else if (FACES.includes(block.typeId)) { face = block; hay = dim.getBlock({ x, y: y - 1, z }); }
  else return;
  if (hay?.typeId !== HAY || !FACES.includes(face?.typeId)) return;
  startRitual(dim, hay.location, face.location);
}
world.afterEvents.playerPlaceBlock.subscribe((ev) => checkScarecrow(ev.block));

// Muerte del jefe: estallido de partículas
world.afterEvents.entityDie.subscribe((ev) => {
  const e = ev.deadEntity;
  const s = bosses.get(e.id);
  if (s) stopBossMusic(s);
  bosses.delete(e.id);
  try {
    const l = e.location;
    ring(e.dimension, l, 2, 24, "minecraft:totem_particle", 1);
    fxAt(e.dimension, "minecraft:huge_explosion_emitter", { x: l.x, y: l.y + 1, z: l.z });
    world.sendMessage("§aEl Jinete sin Cabeza ha sido derrotado.");
  } catch { /* entidad ya no válida */ }
}, { entityTypes: [BOSS] });
