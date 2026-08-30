; Small square smoke test for the CoreXY pen plotter.
; Before running: manually move the toolhead to bottom-left home.
; The sender can send G28 P1 after you confirm home.

G21
G90
M17
M204 S1200
G0 X100 Y100 F600
M3
G1 X150 Y100 F300
G1 X150 Y150
G1 X100 Y150
G1 X100 Y100
M5
M2
