# Bill of Materials

This BOM is split into purchase groups and itemized build parts. Some rows in
the machine are bought together, so the price belongs to the kit/link, not every
individual part inside it.

Prices are pulled from the linked listings when available, but should still be
checked before ordering because Amazon prices move around.

## Purchase Groups

| ID | Buy / source | Price | Notes |
| --- | --- | ---: | --- |
| P01 | [DAOKI CNC Shield V3.0 kit](https://www.amazon.com/dp/B08KFYKKN4) | $9.99 | Includes Arduino-compatible Uno, CNC Shield V3, 4 DRV8825 drivers, heatsinks, jumper caps, and USB cable. |
| P02 | [STEPPERONLINE NEMA 17 stepper motor, 3-pack](https://www.amazon.com/dp/B0B38GHRH8) | $10.19 | Build uses 2 motors; this listing includes 3. |
| P03 | [ANNIMOS 20kg metal gear servo](https://www.amazon.com/dp/B0769DFJVK) | $14.99 | Pen lift servo. |
| P04 | [GT2 belt, pulley, idler, tensioner, and clamp kit](https://www.amazon.com/dp/B0D2XXF6H7) | $14.99 each | Buy 2. Each kit has 5m of 6mm GT2 belt, 20T pulleys, idlers, tensioner springs, clamp blocks, and wrench. |
| P05 | [uxcell 625ZZ bearings, 25-pack](https://www.amazon.com/dp/B0CJFRSK7D) | $7.89 | Build uses 24 bearings. |
| P06 | [3030 aluminum extrusion, 39.4 inch, 10-pack](https://www.amazon.com/dp/B0C9WGJNR9) | $46.99 | Cut into the frame and gantry pieces. |
| P07 | [3030 corner bracket + M6 T-nut connector kit](https://www.amazon.com/dp/B0B12FJRQ3) | Check listing | Includes 3030 corner brackets, M6 T-nuts, M6 x 12 bolts, and wrench. |
| P08 | [M3 screw/nut/washer assortment](https://www.amazon.com/dp/B0FGV5FCBN) | $9.99 | Small toolhead, cart, servo, and motor hardware. |
| P09 | [M4 screw/nut/washer assortment](https://www.amazon.com/dp/B0DD79T1CW) | $9.99 | Belt clamp hardware. |
| P10 | [M5 screw/nut/washer assortment](https://www.amazon.com/dp/B0CSY7FMQD) | $9.99 | Roller and pulley stack hardware. |
| P11 | [M6 screw/nut/washer assortment](https://www.amazon.com/dp/B0GHM7GBXF) | $9.99 | Optional/extra M6 hardware. The connector kit already includes the main M6 x 12 frame bolts. |
| P12 | [IRLZ44N logic-level N-channel MOSFET](https://www.amazon.com/IRLZ44N-IRLZ44NPBF-Mosfet-N-Channel-0-02Ohm/dp/B09SV14RX7) | Check listing | Servo anti-twitch power switch. |
| P13 | [Aluminum cutting blade and paraffin wax](https://www.amazon.com/s?k=aluminum+cutting+blade+paraffin+wax) | Check listing | Optional extrusion cutting helpers. |
| A01 | Assumed project supplies | Already owned | Breadboard, 220 ohm resistor, 10k ohm resistor, bench power supply, external 5V source, pen/pencil, spring, zip tie, and jumper wires. |

## Itemized Purchased Parts

| Part | Qty. used | Source group | Notes |
| --- | ---: | --- | --- |
| Arduino Uno-compatible board | 1 | P01 | Included in the electronics kit. |
| CNC Shield V3 | 1 | P01 | Plugs into the Uno. |
| DRV8825 motor driver | 2 | P01 | Kit includes 4; this build uses 2. Set current limit to about 0.45-0.5A. |
| Arduino USB cable | 1 | P01 | Included in the electronics kit. |
| 20kg servo | 1 | P03 | Pen lift servo. |
| Servo horn | 1 | P03 | Use the servo's included horn. |
| NEMA 17 stepper motor | 2 | P02 | CoreXY motor A and motor B. |
| GT2 timing belt | 2x 5m | P04 | Buy 2 kits so each motor gets its own 5m belt. |
| GT2 20T drive pulley, 6mm belt width | 2 | P04 | Mounted to the two stepper shafts. |
| GT2 idler pulley | 8 | P04 | Build uses 6 toothed-style idlers and 2 toothless/smooth-style idlers. Confirm the exact pulley style in the kit before ordering. |
| GT2 aluminum timing belt clamp | 2 | P04 | Included with the GT2 kit. Mounted to the printed belt clamp mount. |
| 625 bearing | 24 | P05 | Used in rollers and bearing stacks. |
| 3030 aluminum extrusion, length pieces | 2 | P06 | 1m pieces before cutting. |
| 3030 aluminum extrusion, width pieces | 2 | P06 | 1m pieces before cutting. |
| 3030 aluminum extrusion, gantry piece | 1 | P06 | Cut from extrusion stock. Use the gantry jig or cut off 58.2mm. |
| 3030 T-nut | 30 | P07 | Use one with each M6 x 12 frame bolt. Gantry extrusion mount ones are optional and not counted. |
| Extrusion bracket | 4 | P07 | Metal brackets for frame corners. |
| M6 x 12 bolt | 30 | P07 | Used wherever a T-nut is used. |
| M6 x 30 bolt | 4 | P11 | Optional if additional gantry-to-cart T-nuts are not desired. |
| M6 washer | 4 | P11 | Optional, used with M6 x 30. |
| M5 x 45 bolt | 8 | P10 | Back corner brackets, bottom of toolhead cart, and Y-cart pulleys. |
| M5 x 50 bolt | 10 | P10 | Y-cart rollers and upper rollers of the toolhead. |
| M5 nut | 18 | P10 | On cart bottoms and roller stacks. |
| M5 washer | 18 | P10 | Used with M5 roller hardware. |
| M4 x 12 bolt | 2 | P09 | Secures belt clamp onto belt clamp mount. |
| M4 nut | 2 | P09 | Behind belt clamp mount. |
| M4 washer | 2 | P09 | Behind belt clamp. |
| M3 x 6 bolt | 1 | P08 | Pencil block pencil clamp. |
| M3 x 10 bolt | 10 | P08 | Stepper motors and belt clamp mount. |
| M3 x 16 bolt | 9 | P08 | Servo/toolhead hardware; 8 rigidity screws are optional. |
| M3 x 25 bolt | 4 | P08 | Y carts for securing upper mold. Optional. |
| M3 nut | 4 | P08 | Two embedded in belt mount, two on M3 x 16 servo mount. |
| M3 washer | 18 | P08 | Small fastener washers. |
| Breadboard | 1 | A01 | Easier interface for servo/MOSFET wiring. |
| Jumper wires | about 40 M-F, about 3 M-M | A01 | Servo power circuit and CNC shield to breadboard wiring. Mostly long male-to-female wires. |
| IRLZ44N logic-level N-channel MOSFET | 1 | P12 | Switches servo ground/power to prevent boot twitch. Logic-level equivalent is okay. |
| 220 ohm resistor | 1 | A01 | Between D11/Z-limit signal and MOSFET gate. |
| 10k ohm resistor | 1 | A01 | Gate pulldown to ground. |
| External 5V power source | 1 | A01 | Powers servo through breadboard rails. |
| 12V bench power supply | 1 | A01 | Powers the CNC shield/motors. Set current low at first during testing. |
| Pen or pencil | 1 | A01 | For pens, remove the ink cartridge and use the pen adapter. |
| Spring for pencil mount | 1 | A01 | OD less than 12mm, height around 30mm. |
| Zip tie | 1 | A01 | 4 inch zip tie for securing servo wire onto aligner. |
| Aluminum cutting blade | optional | P13 | Optional, cleaner extrusion cuts. Prefer negative-angle TCG for nonferrous aluminum. |
| Paraffin wax block | optional | P13 | Optional cutting helper for extrusion. |

## Printed Parts

These parts require PLA, ABS, and PETG filament. The table lists the material
for each part, but no specific filament brand is required.

| Part | Qty. | Material | STL | STEP |
| --- | ---: | --- | --- | --- |
| 0.5 mm Spacer for Y Cart | 2 | PLA | [STL](exports/stl/0.5-mm-Spacer-for-Y-Cart.stl) | [STEP](exports/step/0.5-mm-Spacer-for-Y-Cart.step) |
| 1 mm Spacer for Y Cart | 6 | PLA | [STL](exports/stl/1-mm-Spacer-for-Y-Cart.stl) | [STEP](exports/step/1-mm-Spacer-for-Y-Cart.step) |
| 1.5 mm M+U Spacer for Corner Brackets | 4 | PLA | [STL](exports/stl/1.5-mm-M-U-Spacer-for-Corner-Brackets.stl) | [STEP](exports/step/1.5-mm-M+U-Spacer-for-Corner-Brackets.step) |
| 7.25 mm L Spacer for Corner Brackets | 2 | PLA | [STL](exports/stl/7.25-mm-L-Spacer-for-Corner-Brackets.stl) | [STEP](exports/step/7.25-mm-L-Spacer-for-Corner-Brackets.step) |
| Back Corner Brackets | 2 | ABS | [STL](exports/stl/Back-Corner-Brackets.stl) | [STEP](exports/step/Back-Corner-Brackets.step) |
| Bearing-to-Bearing Internal Roller Spacer | 12 | PLA | [STL](exports/stl/Bearing-to-Bearing-Internal-Roller-Spacer.stl) | [STEP](exports/step/Bearing-to-Bearing-Internal-Roller-Spacer.step) |
| Belt Clamp Mount | 1 | ABS | [STL](exports/stl/Belt-Clamp-Mount.stl) | [STEP](exports/step/Belt-Clamp-Mount.step) |
| Cart Cart Plate | 2 | ABS | [STL](exports/stl/Cart-Cart-Plate.stl) | [STEP](exports/step/Cart-Cart-Plate.step) |
| Cart-to-Bearing Spacer | 24 | PLA | [STL](exports/stl/Cart-to-Bearing-Spacer.stl) | [STEP](exports/step/Cart-to-Bearing-Spacer.step) |
| Gantry Extrusion Jig | 1 | PLA | [STL](exports/stl/Gantry-Extrusion-Jig.stl) | [STEP](exports/step/Gantry-Extrusion-Jig.step) |
| Left Corner Bracket | 1 | ABS | [STL](exports/stl/Left-Corner-Bracket.stl) | [STEP](exports/step/Left-Corner-Bracket.step) |
| Left Lower Cart Plate | 1 | ABS | [STL](exports/stl/Left-Lower-Cart-Plate.stl) | [STEP](exports/step/Left-Lower-Cart-Plate.step) |
| Left Upper Cart Plate | 1 | ABS | [STL](exports/stl/Left-Upper-Cart-Plate.stl) | [STEP](exports/step/Left-Upper-Cart-Plate.step) |
| Left Upper Cart Upper Mold | 1 | ABS | [STL](exports/stl/Left-Upper-Cart-Upper-Mold.stl) | [STEP](exports/step/Left-Upper-Cart-Upper-Mold.step) |
| Modified Surface Roller | 2 | PLA | [STL](exports/stl/Modified-Surface-Roller.stl) | [STEP](exports/step/Modified-Surface-Roller.step) |
| Pen Adapter | optional | PETG | [STL](exports/stl/Pen-Adapter.stl) | [STEP](exports/step/Pen-Adapter.step) |
| Pencil Block | 1 | PLA | [STL](exports/stl/Pencil-Block.stl) | [STEP](exports/step/Pencil-Block.step) |
| Pencil Housing | 1 | PLA | [STL](exports/stl/Pencil-Housing.stl) | [STEP](exports/step/Pencil-Housing.step) |
| Pencil Housing Cap | 1 | PLA | [STL](exports/stl/Pencil-Housing-Cap.stl) | [STEP](exports/step/Pencil-Housing-Cap.step) |
| Right Corner Bracket | 1 | ABS | [STL](exports/stl/Right-Corner-Bracket.stl) | [STEP](exports/step/Right-Corner-Bracket.step) |
| Right Lower Cart Bottom | 1 | ABS | [STL](exports/stl/Right-lower-Cart-Bottom.stl) | [STEP](exports/step/Right-Lower-Cart-Bottom.step) |
| Right Upper Cart Plate | 1 | ABS | [STL](exports/stl/Right-Upper-Cart-Plate.stl) | [STEP](exports/step/Right-Upper-Cart-Plate.step) |
| Right Upper Cart Upper Mold | 1 | ABS | [STL](exports/stl/Right-Upper-Cart-Upper-Mold.stl) | [STEP](exports/step/Right-Upper-Cart-Upper-Mold.step) |
| Servo Wire Aligner | 1 | PLA | [STL](exports/stl/Servo-Wire-Aligner.stl) | [STEP](exports/step/Servo-Wire-Aligner.step) |
| Stepper to Drive Pulley Spacer | 2 | PLA | [STL](exports/stl/Stepper-to-Drive-Pulley-Spacer.stl) | [STEP](exports/step/Stepper-to-Drive-Pulley-Spacer.step) |
| Surface Roller | 10 | ABS | [STL](exports/stl/Surface-Roller.stl) | [STEP](exports/step/Surface-Roller.step) |
| Toolhead Cart Back | 1 | ABS | [STL](exports/stl/Toolhead-Cart-Back.stl) | [STEP](exports/step/Toolhead-Cart-Back.step) |
| Toolhead Cart Connector | 1 | PETG | [STL](exports/stl/Toolhead-Cart-connector.stl) | [STEP](exports/step/Toolhead-Cart-Connector.step) |
| Toolhead Front Cart | 1 | ABS | [STL](exports/stl/Toolhead-Front-Cart.stl) | [STEP](exports/step/Toolhead-Front-Cart.step) |

## Cost Notes

The purchase-group total is only a rough build estimate because many links are
kits, leftovers, or optional tools. If someone already has filament, fasteners,
a power supply, jumper wires, or cutting tools, the real extra cost will be much
lower than buying every source group from scratch.

For reimbursement/shipping forms, use the purchase group rows as the buying
list. Use the itemized tables to explain where each kit part goes in the build.
