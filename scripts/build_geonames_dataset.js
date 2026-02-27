const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.dirname(__dirname);
const RAW_DIR = path.join(ROOT, "data", "geonames", "raw");
const OUT_DIR = path.join(ROOT, "data");
const CITIES_DIR = path.join(OUT_DIR, "cities");

const ALT_TXT = path.join(RAW_DIR, "alternateNamesV2.txt");
const CITIES_TXT = path.join(RAW_DIR, "cities1000.txt");
const COUNTRY_INFO = path.join(RAW_DIR, "countryInfo.txt");

function loadCountryInfo() {
  const countries = new Map();
  const lines = fs.readFileSync(COUNTRY_INFO, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 17) continue;
    const code = parts[0];
    const name = parts[4];
    const geonameId = Number(parts[16]) || null;
    countries.set(code, { code, name, geonameId });
  }
  return countries;
}

async function loadKoreanAltNames() {
  const koMap = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(ALT_TXT),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const lang = parts[2];
    if (lang !== "ko") continue;
    const geonameId = Number(parts[1]);
    if (!geonameId) continue;
    const name = parts[3]?.trim();
    if (!name) continue;
    const isPreferred = parts[4] === "1";
    if (!koMap.has(geonameId) || isPreferred) {
      koMap.set(geonameId, name);
    }
  }
  return koMap;
}

async function loadCities(koMap) {
  const citiesByCountry = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(CITIES_TXT),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 15) continue;
    const geonameId = Number(parts[0]);
    if (!geonameId) continue;
    const name = parts[1];
    const ascii = parts[2];
    const lat = parts[4] ? Number(parts[4]) : null;
    const lon = parts[5] ? Number(parts[5]) : null;
    const featureClass = parts[6];
    const countryCode = parts[8];
    const population = Number(parts[14]) || 0;

    if (featureClass !== "P") continue;
    if (!countryCode) continue;

    const entry = {
      id: geonameId,
      name,
      nameKo: koMap.get(geonameId) || undefined,
      ascii,
      lat,
      lon,
      population,
    };

    if (!citiesByCountry.has(countryCode)) citiesByCountry.set(countryCode, []);
    citiesByCountry.get(countryCode).push(entry);
  }

  return citiesByCountry;
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(CITIES_DIR, { recursive: true });

  if (!fs.existsSync(ALT_TXT) || !fs.existsSync(CITIES_TXT) || !fs.existsSync(COUNTRY_INFO)) {
    console.error("Required raw files are missing. Download/extract them first.");
    process.exit(1);
  }

  console.log("Loading country info...");
  const countries = loadCountryInfo();

  console.log("Loading Korean alternate names...");
  const koMap = await loadKoreanAltNames();

  for (const [code, meta] of countries.entries()) {
    if (meta.geonameId && koMap.has(meta.geonameId)) {
      meta.nameKo = koMap.get(meta.geonameId);
    }
  }

  console.log("Loading cities...");
  const citiesByCountry = await loadCities(koMap);

  console.log("Writing city files...");
  for (const [code, cities] of citiesByCountry.entries()) {
    cities.sort((a, b) => (b.population || 0) - (a.population || 0) || a.name.localeCompare(b.name));
    const outPath = path.join(CITIES_DIR, `${code}.json`);
    fs.writeFileSync(outPath, JSON.stringify(cities), "utf8");
  }

  const countriesList = Array.from(countries.values()).sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT_DIR, "countries.json"), JSON.stringify(countriesList), "utf8");

  console.log(`Wrote ${countriesList.length} countries`);
  console.log(`Wrote cities for ${citiesByCountry.size} countries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
