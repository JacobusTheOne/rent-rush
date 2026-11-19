// Prints the board artwork list (game/art.ts) as JSON for scripts/make-art-templates.py.
import { ALL_ART } from "../game/art";

process.stdout.write(JSON.stringify(ALL_ART));
