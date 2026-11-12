import { copyFileSync, mkdirSync } from "node:fs";

const sourceDirectory = new URL("../src/cliplab/", import.meta.url);
const destinationDirectory = new URL("../dist/cliplab/", import.meta.url);

mkdirSync(destinationDirectory, { recursive: true });
for (const file of ["LICENSE", "PROVENANCE.md"]) {
  copyFileSync(new URL(file, sourceDirectory), new URL(file, destinationDirectory));
}
