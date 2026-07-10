const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ---- Load all JSON data once at server startup ----
function loadJSON(filename) {
    const raw = fs.readFileSync(path.join(__dirname, filename), 'utf-8');
    return JSON.parse(raw);
}

const troopMeta = loadJSON('troops.json');
const troopLevels = loadJSON('troopsLevel.json');
const heroMeta = loadJSON('hero.json');
const heroLevels = loadJSON('heroLevel.json');
const localization = loadJSON('localization.json');
const en = loadJSON('en.json');

// ---- Build troopList / heroList, same logic as your old client-side code ----
function buildUnitList(metaObj, levelsObj, idField) {
    let levelsByUnit = {};
    for (let k in levelsObj) {
        let entry = levelsObj[k];
        let uid = entry[idField];
        if (!levelsByUnit[uid]) levelsByUnit[uid] = [];
        levelsByUnit[uid].push(entry);
    }
    for (let uid in levelsByUnit) {
        levelsByUnit[uid].sort((a, b) => a.level - b.level);
    }

    let list = [];
    for (let key in metaObj) {
        let meta = metaObj[key];
        let nameKey = meta.name;
        let locEntry = localization[nameKey];
        let displayName = locEntry ? (en[locEntry.value] || nameKey) : (nameKey || key);

        if (!levelsByUnit[key]) continue;
        if (meta.isDisplayed === false) continue;

        list.push({
            key: key,
            displayName: displayName,
            rarity: (meta.rarityId || "common").toLowerCase(),
            meta: meta,
            levels: levelsByUnit[key]
        });
    }
    list.sort((a, b) => (a.meta.order || 99) - (b.meta.order || 99));
    return list;
}

const troopList = buildUnitList(troopMeta, troopLevels, 'troopId');
const heroList = buildUnitList(heroMeta, heroLevels, 'heroId');

console.log(`Loaded ${troopList.length} troops and ${heroList.length} heroes.`);

// ---- Static assets (images, css) ----
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/LAUNCHstyle.css', express.static(path.join(__dirname, 'LAUNCHstyle.css')));

// ---- Gallery page (home) ----
app.get('/', (req, res) => {
    function renderGalleryItem(unit) {
        return `
            <div class="gallery-item ${unit.rarity}">
                <a href="/troop/${unit.key}">
                    <img src="/images/${unit.key.toUpperCase()}.jpg" alt="${unit.displayName}">
                    <span>${unit.displayName}</span>
                </a>
            </div>
        `;
    }

    const html = `
        <!doctype html>
        <html>
        <head>
            <title>Keazyea's Intelligence Hub</title>
            <link rel="stylesheet" href="/LAUNCHstyle.css">
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body>
            <h1>🏠 Troops & Heroes</h1>
            <div class="gallery-section-label">Troops</div>
            <div class="unit-gallery">
                ${troopList.map(renderGalleryItem).join('')}
            </div>
            <div class="gallery-section-label">Heroes</div>
            <div class="unit-gallery">
                ${heroList.map(renderGalleryItem).join('')}
            </div>
        </body>
        </html>
    `;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});