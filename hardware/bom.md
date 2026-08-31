# Bill of Materials

This BOM is split into purchase groups and itemized build parts. Some rows in
the machine are bought together, so the price belongs to the kit/link, not every
individual part inside it.

Prices are rough USD estimates and should be checked before ordering.

## Purchase Groups

| ID | Buy / source | Approx. price | Covers |
| --- | --- | ---: | --- |
| P01 | [Arduino Uno + CNC Shield + DRV8825 kit](https://www.amazon.com/dp/B08KFYKKN4) | ~$18-25 | Arduino-compatible Uno, CNC Shield V3, DRV8825 drivers, heatsinks, USB cable, jumper caps. |
| P02 | [NEMA 17 stepper motor 2-pack](https://www.amazon.com/s?k=NEMA+17+stepper+motor+2+pack) | ~$18-28 | Two XY motors. |
| P03 | [20kg metal gear servo](https://www.amazon.com/s?k=DS3218+20kg+servo) | ~$8-15 | Pen lift servo and servo horn. |
| P04 | [GT2 belt, 20T pulley, and idler pulley parts](https://www.amazon.com/s?k=GT2+timing+belt+5m+20T+pulley+idler+kit) | ~$15-30 | Timing belt, drive pulleys, toothed idlers, toothless idlers. You may need more than one kit depending on the listing. |
| P05 | [625ZZ bearing pack](https://www.amazon.com/s?k=625ZZ+bearing+5x16x5mm+24+pack) | ~$10-16 | All 625 bearings used in rollers and pulley stacks. |
| P06 | [3030 aluminum extrusion, 1000mm](https://www.amazon.com/s?k=3030+aluminum+extrusion+1000mm) | ~$45-70 | Four frame/gantry extrusion pieces before cutting. |
| P07 | [3030 corner/extrusion brackets](https://www.amazon.com/s?k=3030+aluminum+extrusion+corner+bracket) | ~$8-15 | Metal brackets for extrusion joints. |
| P08 | [3030 M6 T-nuts and M6 bolts](https://www.amazon.com/s?k=3030+M6+T+nut+M6x12+bolt) | ~$10-18 | T-nuts and most M6 frame fasteners. |
| P09 | [M3/M4/M5 screw, nut, and washer assortment](https://www.amazon.com/s?k=M3+M4+M5+screw+nut+washer+assortment) | ~$18-35 | Small fasteners throughout the carts, rollers, belt clamp, and toolhead. |
| P10 | [GT2 aluminum timing belt clamp](https://www.amazon.com/s?k=GT2+aluminum+timing+belt+clamp) | ~$6-10 | Purchased belt clamps. |
| P11 | [Breadboard, jumper wires, resistors, MOSFET parts](https://www.amazon.com/s?k=breadboard+jumper+wire+resistor+IRLZ44N+kit) | ~$12-25 | Servo anti-twitch wiring circuit. |
| P12 | [12V bench power supply](https://www.amazon.com/s?k=12V+bench+power+supply) | ~$35-60 | Motor/CNC shield supply. |
| P13 | [External 5V servo power supply](https://www.amazon.com/s?k=5V+3A+USB+power+supply) | ~$8-15 | Servo power. Do not power the servo from the Arduino 5V pin. |
| P14 | [Pen/pencil, spring, and zip ties](https://www.amazon.com/s?k=pen+spring+zip+ties) | ~$5-12 | Drawing consumables and small toolhead consumables. |
| P15 | [Aluminum cutting blade and paraffin wax](https://www.amazon.com/s?k=aluminum+cutting+blade+paraffin+wax) | ~$10-25 | Optional extrusion cutting helpers. |
| P16 | [PLA, ABS, and PETG filament](https://www.amazon.com/s?k=PLA+ABS+PETG+filament) | ~$45-75 | Printed parts. Price assumes buying full spools, not actual material consumed. |

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
| GT2 timing belt | 2x 5m | P04 | One belt path per motor. |
| GT2 20T drive pulley, 6mm belt width | 2 | P04 | Mounted to the two stepper shafts. |
| GT2 toothed idler pulley | 6 | P04 | Pulley stacks in the CoreXY path. |
| GT2 toothless idler pulley | 2 | P04 | First reverse wind of belt from motor. |
| GT2 aluminum timing belt clamp | 2 | P10 | Bought belt clamps mounted to printed belt clamp mount. |
| 625 bearing | 24 | P05 | Used in rollers and bearing stacks. |
| 3030 aluminum extrusion, length pieces | 2 | P06 | 1m pieces before cutting. |
| 3030 aluminum extrusion, width pieces | 2 | P06 | 1m pieces before cutting. |
| 3030 aluminum extrusion, gantry piece | 1 | P06 | Cut from extrusion stock. Use the gantry jig or cut off 58.2mm. |
| 3030 T-nut | 30 | P08 | Use one with each M6 x 12 frame bolt. Gantry extrusion mount ones are optional and not counted. |
| Extrusion bracket | 4 | P07 | Metal brackets for frame corners. |
| M6 x 12 bolt | 30 | P08 | Used wherever a T-nut is used. |
| M6 x 30 bolt | 4 | P08/P09 | Optional if additional gantry-to-cart T-nuts are not desired. |
| M6 washer | 4 | P08/P09 | Optional, used with M6 x 30. |
| M5 x 45 bolt | 8 | P09 | Back corner brackets, bottom of toolhead cart, and Y-cart pulleys. |
| M5 x 50 bolt | 10 | P09 | Y-cart rollers and upper rollers of the toolhead. |
| M5 nut | 18 | P09 | On cart bottoms and roller stacks. |
| M5 washer | 18 | P09 | Used with M5 roller hardware. |
| M4 x 12 bolt | 2 | P09 | Secures belt clamp onto belt clamp mount. |
| M4 nut | 2 | P09 | Behind belt clamp mount. |
| M4 washer | 2 | P09 | Behind belt clamp. |
| M3 x 6 bolt | 1 | P09 | Pencil block pencil clamp. |
| M3 x 10 bolt | 10 | P09 | Stepper motors and belt clamp mount. |
| M3 x 16 bolt | 9 | P09 | Servo/toolhead hardware; 8 rigidity screws are optional. |
| M3 x 25 bolt | 4 | P09 | Y carts for securing upper mold. Optional. |
| M3 nut | 4 | P09 | Two embedded in belt mount, two on M3 x 16 servo mount. |
| M3 washer | 18 | P09 | Small fastener washers. |
| Breadboard | 1 | P11 | Easier interface for servo/MOSFET wiring. |
| Jumper wires | as needed | P11 | Servo power circuit and CNC shield to breadboard wiring. |
| IRLZ44N logic-level N-channel MOSFET | 1 | P11 | Switches servo ground/power to prevent boot twitch. Logic-level equivalent is okay. |
| 220 ohm resistor | 1 | P11 | Between D11/Z-limit signal and MOSFET gate. |
| 10k ohm resistor | 1 | P11 | Gate pulldown to ground. |
| External 5V power source | 1 | P13 | Powers servo through breadboard rails. |
| 12V bench power supply | 1 | P12 | Powers the CNC shield/motors. |
| Pen or pencil | 1 | P14 | For pens, remove the ink cartridge and use the pen adapter. |
| Spring for pencil mount | 1 | P14 | OD less than 12mm, height around 30mm. |
| Zip tie | 1 | P14 | 4 inch zip tie for securing servo wire onto aligner. |
| Aluminum cutting blade | optional | P15 | Optional, cleaner extrusion cuts. Prefer negative-angle TCG for nonferrous aluminum. |
| Paraffin wax block | optional | P15 | Optional cutting helper for extrusion. |

## Printed Parts

| Part | Qty. | Material | STL |
| --- | ---: | --- | --- |
| 0.5 mm Spacer for Y Cart | 2 | PLA | [STL](exports/stl/0.5-mm-Spacer-for-Y-Cart.stl) |
| 1 mm Spacer for Y Cart | 6 | PLA | [STL](exports/stl/1-mm-Spacer-for-Y-Cart.stl) |
| 1.5 mm M+U Spacer for Corner Brackets | 4 | PLA | [STL](exports/stl/1.5-mm-M-U-Spacer-for-Corner-Brackets.stl) |
| 7.25 mm L Spacer for Corner Brackets | 2 | PLA | [STL](exports/stl/7.25-mm-L-Spacer-for-Corner-Brackets.stl) |
| Back Corner Brackets | 2 | ABS | [STL](exports/stl/Back-Corner-Brackets.stl) |
| Bearing-to-Bearing Internal Roller Spacer | 12 | PLA | [STL](exports/stl/Bearing-to-Bearing-Internal-Roller-Spacer.stl) |
| Belt Clamp Mount | 1 | ABS | [STL](exports/stl/Belt-Clamp-Mount.stl) |
| Cart Cart Plate | 2 | ABS | [STL](exports/stl/Cart-Cart-Plate.stl) |
| Cart-to-Bearing Spacer | 24 | PLA | [STL](exports/stl/Cart-to-Bearing-Spacer.stl) |
| Gantry Extrusion Jig | 1 | PLA | [STL](exports/stl/Gantry-Extrusion-Jig.stl) |
| Left Corner Bracket | 1 | ABS | [STL](exports/stl/Left-Corner-Bracket.stl) |
| Left Lower Cart Plate | 1 | ABS | [STL](exports/stl/Left-Lower-Cart-Plate.stl) |
| Left Upper Cart Plate | 1 | ABS | [STL](exports/stl/Left-Upper-Cart-Plate.stl) |
| Left Upper Cart Upper Mold | 1 | ABS | [STL](exports/stl/Left-Upper-Cart-Upper-Mold.stl) |
| Modified Surface Roller | 2 | PLA | [STL](exports/stl/Modified-Surface-Roller.stl) |
| Pen Adapter | optional | PETG | [STL](exports/stl/Pen-Adapter.stl) |
| Pencil Block | 1 | PLA | [STL](exports/stl/Pencil-Block.stl) |
| Pencil Housing | 1 | PLA | [STL](exports/stl/Pencil-Housing.stl) |
| Pencil Housing Cap | 1 | PLA | [STL](exports/stl/Pencil-Housing-Cap.stl) |
| Right Corner Bracket | 1 | ABS | [STL](exports/stl/Right-Corner-Bracket.stl) |
| Right Lower Cart Bottom | 1 | ABS | [STL](exports/stl/Right-lower-Cart-Bottom.stl) |
| Right Upper Cart Plate | 1 | ABS | [STL](exports/stl/Right-Upper-Cart-Plate.stl) |
| Right Upper Cart Upper Mold | 1 | ABS | [STL](exports/stl/Right-Upper-Cart-Upper-Mold.stl) |
| Servo Wire Aligner | 1 | PLA | [STL](exports/stl/Servo-Wire-Aligner.stl) |
| Stepper to Drive Pulley Spacer | 2 | PLA | [STL](exports/stl/Stepper-to-Drive-Pulley-Spacer.stl) |
| Surface Roller | 10 | ABS | [STL](exports/stl/Surface-Roller.stl) |
| Toolhead Cart Back | 1 | ABS | [STL](exports/stl/Toolhead-Cart-Back.stl) |
| Toolhead Cart Connector | 1 | PETG | [STL](exports/stl/Toolhead-Cart-connector.stl) |
| Toolhead Front Cart | 1 | ABS | [STL](exports/stl/Toolhead-Front-Cart.stl) |

## Cost Notes

The purchase-group total is only a rough build estimate because many links are
kits, leftovers, or optional tools. If someone already has filament, fasteners,
a power supply, jumper wires, or cutting tools, the real extra cost will be much
lower than buying every source group from scratch.

For reimbursement/shipping forms, use the purchase group rows as the buying
list. Use the itemized tables to explain where each kit part goes in the build.
