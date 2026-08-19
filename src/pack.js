const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const manifestPath = path.resolve(process.cwd(), "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("manifest.json not found");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const name = manifest.name || "extension";
const version = manifest.version || "0.0.0";
const outName = `${name.replace(/\s+/g, "-")}-${version}.ablx`;

// Ensure dist exists
const distPath = path.resolve(process.cwd(), path.dirname(manifest.entry || "dist/extension.js"));
if (!fs.existsSync(distPath)) {
  console.error("dist output not found. Run `npm run build` first.");
  process.exit(2);
}

// Create a zip (.ablx is a zip-like package for local purposes)
// Use the system `zip` binary (available on macOS / Linux). This keeps this
// script dependency-free. If `zip` is not available, instruct the user.
try {
  // Remove existing file if present
  if (fs.existsSync(outName)) fs.unlinkSync(outName);

  // Build the list of files to include: manifest.json and the dist folder
  const cwd = process.cwd();
  const distRelative = path.relative(cwd, distPath) || path.basename(distPath);

  // zip -r <outName> manifest.json <distRelative>
  execSync(`zip -r ${outName} manifest.json ${distRelative}`, { stdio: "inherit" });
  console.log(`Created ${outName}`);
} catch (e) {
  console.error("Failed to create .ablx package. Ensure 'zip' is installed on your system.");
  process.exit(3);
}
