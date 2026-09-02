tellraw @s {"rawtext": [{"translate": "text.notices.blend_materials_demo.order"}]}

execute if entity @s[rym = -180, ry = 0] rotated -90 ~ run function blend_materials_demo/reposition
execute if entity @s[rym = 0, ry = 180] rotated 90 ~ run function blend_materials_demo/reposition