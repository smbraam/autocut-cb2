# AutoCut – Ontwerpvisie en Intentie

BELANGRIJK:
Lees dit bestand altijd volledig voordat je wijzigingen aanbrengt in de code.

Dit document beschrijft hoe de software bedoeld is door de eigenaar van het project.
Het doel is niet om technische details uit te leggen, maar om duidelijk te maken
hoe de software zich moet gedragen en eruit moet zien.

Wanneer je code schrijft of aanpast moet je altijd deze visie respecteren.


--------------------------------------------------
PROJECT OVERZICHT
--------------------------------------------------

AutoCut is een touchscreen interface voor een kleine CNC-achtige snijmachine.

De machine draait op:

- BTT M4P + CB2
- Klipper firmware
- Moonraker API
- SvelteKit frontend

De software moet functioneren als een eenvoudige industriële machinebediening.

De gebruiker moet de machine kunnen bedienen zonder technische kennis.


--------------------------------------------------
ALGEMENE FILOSOFIE
--------------------------------------------------

De software moet altijd prioriteit geven aan:

1. eenvoud
2. betrouwbaarheid
3. duidelijkheid
4. veiligheid

De interface moet voelen als een dedicated machine controller,
niet als een gewone webapplicatie.

Vermijd:

- complexe instellingen
- diepe menu structuren
- onnodige opties
- onduidelijk gedrag

De gebruiker moet altijd begrijpen wat de machine gaat doen.


--------------------------------------------------
TOUCHSCREEN DESIGN
--------------------------------------------------

De interface draait op een touchscreen dat op de machine gemonteerd is.

Daarom moet de UI:

- grote knoppen gebruiken
- veel ruimte tussen elementen hebben
- eenvoudig te bedienen zijn met vingers
- weinig tekst bevatten
- duidelijke visuele feedback geven

Vermijd kleine UI elementen of complexe interacties.


--------------------------------------------------
VISUELE STIJL
--------------------------------------------------

De interface gebruikt een donkere industriële stijl.

Belangrijke kenmerken:

- donkere achtergrond
- blauwe accentkleur
- afgeronde panelen
- duidelijke typografie
- hoge contrastwaarden

De interface moet modern en professioneel ogen.

Gebruik SVG iconen.

Gebruik geen emoji’s.

De UI moet strak en minimalistisch blijven.


--------------------------------------------------
UI KWALITEIT EN AFWERKING
--------------------------------------------------

De interface moet extreem strak en professioneel aanvoelen.

Het doel is dat de UI eruitziet alsof hij hoort bij een high-end industriële machine.

De afwerking moet:

- visueel consistent zijn
- rustig ogen
- professioneel aanvoelen
- modern zijn
- duidelijk gestructureerd zijn

De UI moet "super gelikt" zijn.


--------------------------------------------------
INSPIRATIE
--------------------------------------------------

De UI mag geïnspireerd worden door high-end 3D printer interfaces.

Vooral:

Bambu Lab printers

Deze interfaces staan bekend om:

- zeer duidelijke statusinformatie
- strakke layout
- duidelijke visuele hiërarchie
- minimalistisch ontwerp
- duidelijke machine feedback

Wanneer je UI componenten ontwerpt, stel jezelf de vraag:

“Zou dit passen op een high-end machine interface?”


--------------------------------------------------
NAVIGATIE STRUCTUUR
--------------------------------------------------

De interface heeft een verticale zijbalk met iconen.

Pagina's:

Home  
Manual  
Shape  
DXF  
Settings  

De zijbalk moet slank blijven.

Er mag geen tekst naast de iconen staan.

De navigatie moet eenvoudig en duidelijk zijn.


--------------------------------------------------
HOME PAGINA
--------------------------------------------------

De home pagina is het hoofdscherm van de machine.

Hier moet zichtbaar zijn:

- machine status
- foutmeldingen
- of de machine klaar is
- beschikbare macros

Macros worden automatisch uit printer.cfg gelezen.

De home pagina is een kritisch onderdeel en mag nooit kapot gemaakt worden.


--------------------------------------------------
HANDMATIGE BEDIENING
--------------------------------------------------

De manual pagina laat de gebruiker de machine handmatig bewegen.

De bediening bestaat uit:

X+  
X-  
Y+  
Y-  
Z+  
Z-

Daarnaast kan de gebruiker de stapgrootte aanpassen.

De machine mag nooit buiten de fysieke grenzen bewegen.


--------------------------------------------------
VORM SNIJDEN
--------------------------------------------------

Op de shape pagina kan de gebruiker eenvoudige vormen snijden.

De gebruiker kiest een vorm door horizontaal te swipen.

Ondersteunde vormen:

- cirkel
- rechthoek
- sleufgat
- zeskant

Elke vorm heeft een grafische weergave.

Wanneer een vorm geselecteerd wordt opent een configuratiescherm.


--------------------------------------------------
VORM PARAMETERS
--------------------------------------------------

De gebruiker kan maten invoeren via een touchscreen numpad.

Alle maten zijn in millimeters.

Voorbeelden:

Cirkel  
diameter

Rechthoek  
lengte  
breedte

Sleuf  
lengte  
breedte  
radius = breedte / 2

Zeskant  
steekmaat


--------------------------------------------------
WERKBEREIK MACHINE
--------------------------------------------------

De machine heeft een maximaal werkgebied van:

100 mm x 100 mm

De software moet voorkomen dat bewegingen buiten dit bereik plaatsvinden.

Wanneer een gebruiker een te grote waarde invoert moet deze automatisch worden begrensd.


--------------------------------------------------
GCODE GENERATIE
--------------------------------------------------

De software genereert automatisch G-code voor vormen.

De code gebruikt:

G21 (millimeters)  
G90 (absolute positioning)

De gebruiker hoeft nooit handmatig G-code te schrijven.


--------------------------------------------------
SNIJ WORKFLOW
--------------------------------------------------

De workflow van het systeem moet als volgt zijn:

1 machine wordt gehomed  
2 gebruiker kiest een vorm  
3 gebruiker vult maten in  
4 software genereert G-code  
5 G-code wordt naar Moonraker gestuurd  
6 status wordt “klaar om te snijden”  
7 gebruiker drukt fysieke start knop  
8 snijproces begint  


--------------------------------------------------
MOONRAKER COMMUNICATIE
--------------------------------------------------

Alle communicatie met Klipper verloopt via Moonraker.

Gebruik altijd de nginx proxy:

/moonraker/

Voorbeelden:

/moonraker/printer/info  
/moonraker/printer/gcode/script  
/moonraker/server/files/upload  

Gebruik nooit directe localhost poorten.


--------------------------------------------------
STATUS WEERGAVE
--------------------------------------------------

De machine status moet duidelijk zichtbaar zijn.

Mogelijke statussen:

ready  
busy  
error  
disconnected  

Foutmeldingen van Moonraker moeten duidelijk zichtbaar zijn.


--------------------------------------------------
VEILIGHEID
--------------------------------------------------

De machine moet altijd eerst gehomed zijn voordat snijden mogelijk is.

Als de machine niet gehomed is moeten snijacties geblokkeerd worden.

De software mag nooit onveilige bewegingen genereren.


--------------------------------------------------
REGELS VOOR AI ONTWIKKELING
--------------------------------------------------

Wanneer je code aanpast:

- wijzig zo min mogelijk bestanden tegelijk
- breek nooit bestaande werkende functionaliteit
- refactor geen grote delen van de code zonder reden
- behoud de huidige UI structuur

Voeg liever kleine uitbreidingen toe dan grote herschrijvingen.


--------------------------------------------------
BELANGRIJK
--------------------------------------------------

Respecteer altijd de ontwerpfilosofie van eenvoud.

De machine moet voelen als een eenvoudig gereedschap,
niet als een complex softwaresysteem.
