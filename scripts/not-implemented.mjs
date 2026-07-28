// Placeholder for scripts that land in later phases (see docs/QODER_MASTER_SPEC.md §9).
// Always exits with status 2 — never 0 — so CI and humans cannot mistake a
// placeholder for a passing gate. No spawning, no filesystem access.

const PHASE_MAP = {
  "test:a11y": "P05",
  "test:security": "P06",
  "test:e2e": "P07",
  "demo:verify": "P07",
};

const name = process.argv[2];

if (name !== undefined && Object.hasOwn(PHASE_MAP, name)) {
  process.stderr.write(
    `${name}: not implemented until ${PHASE_MAP[name]} (see docs/QODER_MASTER_SPEC.md §9)\n`,
  );
} else {
  process.stderr.write(
    "usage: node scripts/not-implemented.mjs <script-name>\n" +
      `known script names: ${Object.keys(PHASE_MAP).join(", ")}\n`,
  );
}

process.exit(2);
