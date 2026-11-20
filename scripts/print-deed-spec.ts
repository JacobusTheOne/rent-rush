// Prints the title-deed image list (game/art.ts DEED_ART) as JSON for scripts/import-deeds.py.
import { DEED_ART } from "../game/art";

process.stdout.write(JSON.stringify(Object.values(DEED_ART)));
