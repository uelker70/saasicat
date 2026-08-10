---
'@saasicat/ui-vue': patch
---

PilotEditDialog nutzt dieselben Klassennamen wie PilotCreateDialog. Die
Styles sind scoped, die Umbenennung ist damit nach aussen wirkungslos — sie
macht nur sichtbar, dass beide Dialoge dieselben Bausteine zeichnen.
