import { world, system, EntityEquippableComponent, EquipmentSlot } from "@minecraft/server";

const UNLOADED = ["udaw:arcabuz", "udaw:flintlockgun"];

function isGun(id) {
    return id && (id.startsWith("udaw:arcabuz") || id.startsWith("udaw:flintlockgun"));
}

function getAnim(id, reloading) {
    if (id === "udaw:diamond_sable") return "animation.udaw.arquebus.arm_hold";
    if (reloading) {
        return id.startsWith("udaw:arcabuz")
            ? "animation.udaw.arquebus.arm_reload"
            : "animation.gun.arm_reload";
    }
    return id.startsWith("udaw:arcabuz")
        ? "animation.udaw.arquebus.arm_hold"
        : "animation.gun.arm_hold";
}

const STATE = new Map();

system.runInterval(() => {
    for (const player of world.getPlayers()) {
        try {
            const equip = player.getComponent(EntityEquippableComponent.componentId);
            if (!equip) continue;
            const item = equip.getEquipmentSlot(EquipmentSlot.Mainhand).getItem();
            if (!item || !isGun(item.typeId)) {
                if (STATE.get(player.id)) {
                    player.playAnimation("animation.udaw.arquebus.arm_clear");
                    STATE.set(player.id, null);
                }
                continue;
            }
            const reloading = UNLOADED.includes(item.typeId)
                && player.getComponent("minecraft:using_item") !== undefined;
            const anim = getAnim(item.typeId, reloading);
            if (STATE.get(player.id) !== anim) {
                player.playAnimation(anim, { nextState: "a", blendOutTime: 9999 });
                STATE.set(player.id, anim);
            }
        } catch (e) {}
    }
}, 10);
