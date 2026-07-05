# AutoCut CB2 Project Status 10-6-2026

## Projectdoel

AutoCut is een handheld plasmatoortsmodulator gebaseerd op:

* BIGTREETECH Manta M4P
* BIGTREETECH CB2 (32GB eMMC)
* Klipper
* Moonraker
* Mainsail
* Eigen AutoCut UI

Het uiteindelijke product moet een compacte XYZ-plasmatoortsmodulator worden waarbij de machine zelf draait op de CB2/M4P en bediend kan worden via een webinterface. Op termijn wordt een goedkope mini-tablet als draadloze bediening overwogen.

---

## Huidige hardware

### Controller

* Manta M4P
* CB2
* TMC2209 drivers

### Aandrijving

* X-as
* Y-as links
* Y-as rechts (tweede motor)
* Z-as

### Huidige driverindeling

| As       | Driver |
| -------- | ------ |
| X        | X      |
| Y links  | Y      |
| Y rechts | E0     |
| Z        | Z      |

---

## Softwarestatus

Werkend:

* CB2 draait succesvol
* Klipper start correct
* Moonraker start correct
* Mainsail bereikbaar
* AutoCut UI draait op CB2
* Project succesvol gemigreerd vanaf Raspberry Pi

Projectlocaties:

```text
/home/biqu/autocut-ui
/home/biqu/printer_data
```

Backup van originele printer_data:

```text
/home/biqu/printer_data_old
```

---

## GitHub

Actieve repository:

```text
autocut-cb2
```

Oude Raspberry Pi omgeving dient uitsluitend als backup.

---

## Huidig probleem

### Tweede Y-motor (E0)

Wanneer E0 wordt aangestuurd ontstaat een storing.

Symptomen:

* Machine valt direct in storing.
* X, Y en Z functioneren.
* Probleem treedt specifiek op bij bewegen van E0.
* E0 wordt gebruikt als tweede Y-motor.

Doel:

* Dual-Y configuratie werkend krijgen.
* Vaststellen of probleem wordt veroorzaakt door:

  * Klipper configuratie
  * Driver configuratie
  * UART communicatie
  * TMC2209 instellingen
  * Bekabeling
  * M4P pinconfiguratie

---

## Wat een nieuwe chatbot eerst moet controleren

### Klipper configuratie

Bestanden:

```text
/home/biqu/printer_data/config/printer.cfg
```

Controleren:

* [stepper_y]
* [stepper_y1]
* [extruder]
* [tmc2209 stepper_y]
* [tmc2209 stepper_y1]

---

### Klipper logs

Controleren:

```bash
cat ~/printer_data/logs/klippy.log
```

Zoeken naar:

```text
shutdown
mcu shutdown
tmc
stepper
uart
```

---

### Hardware

Controleren:

* Driver in E0-slot
* Driver in Y-slot
* Jumpers UART
* Driver type TMC2209
* Bekabeling motoren
* Stroominstellingen

---

## Toekomstige productrichting

### Bedieningsconcept

Machine:

* CB2
* M4P
* Moonraker
* AutoCut backend

Bediening:

* Goedkope mini-tablet
* AutoCut webinterface

Toekomst:

* Eigen 2D tekenprogramma
* Automatische G-code generatie

Veiligheidskritische functies blijven fysiek op de machine:

* Start
* Stop
* Veiligheidsfuncties

---

## Prioriteit

1. Dual-Y werkend krijgen.
2. AutoCut stabiel op CB2 laten draaien.
3. Migratie naar eMMC afronden.
4. Verdere UI ontwikkeling.
5. G-code generatie.
6. Productontwikkeling.
