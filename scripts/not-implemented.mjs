// Legacy placeholder. Always exits 2 so it cannot be mistaken for a gate.

const name = process.argv[2];

if (name !== undefined) {
  process.stderr.write(
    `${name}: no implementation is wired to this placeholder\n`,
  );
} else {
  process.stderr.write(
    "usage: node scripts/not-implemented.mjs <script-name>\n",
  );
}

process.exit(2);
