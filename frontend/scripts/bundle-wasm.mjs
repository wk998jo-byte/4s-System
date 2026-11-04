import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "assets"), { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    join(root, "node_modules/esbuild-wasm/bin/esbuild"),
    "src/main.tsx",
    "--bundle",
    "--outfile=dist/assets/index.js",
    "--format=esm",
    "--jsx=automatic",
    "--loader:.css=css",
    "--define:import.meta.env.DEV=false",
    "--define:import.meta.env.PROD=true",
    "--define:import.meta.env.SSR=false",
    '--define:import.meta.env.MODE="production"',
    '--define:import.meta.env.VITE_API_BASE_URL="http://127.0.0.1:8000"',
    '--define:process.env.NODE_ENV="production"',
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(
  join(root, "dist/index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SCC Platform — Safety Command Center</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/assets/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>
`,
);
console.log("Latest frontend bundled to dist/");
