// Location map for settlement infoboxes: one shared base map of Irad (images/Irad_location_map.svg)
// and the position of every settlement on it as a percentage of the frame (images/locators.json),
// so the wiki can draw the red dot itself instead of keeping one map file per settlement.
// Positions come from the Kartalar settlements data (data/kartalar/settlements.json).
import fs from 'node:fs';
import path from 'node:path';
import { loadK, REPO } from './common.mjs';
import { writeSvg } from './svg.mjs';
import { makeMap } from './base.mjs';

const W = 500, H = 430;
const m = makeMap({ W, H });
const body = [m.base(), m.irad(), m.water({ width: 0.9 }), m.qaraChik({ width: 1.2, dash: '4 2' }), m.iradBorder(1.4), m.neighbourNames(undefined, 11)].join('\n');
writeSvg('Irad_location_map.svg', W, H, body, {
  title: 'Location map of Irad',
  desc: 'Irad in its region with the Qara-Chik Demarcation Line; base map for the settlement infoboxes, which add a dot for each place.',
});
const out = {};
for (const s of loadK('settlements.json')) {
  if (!s.wiki) continue;
  const [x, y] = m.xy(s.lon, s.lat);
  if (!m.inView(x, y, 2)) continue;
  out[s.wiki] = [+(100 * x / W).toFixed(2), +(100 * y / H).toFixed(2)];
}
// Mapped features (passes, lakes, peaks, crossings, airports, works …) for the other place infoboxes,
// keyed by the feature's name folded to plain lower case without a bracketed part, as the app looks them up.
const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[’‘]/g, "'").toLowerCase();
const features = {};
for (const f of loadK('features.json')) {
  if (f.lat == null || f.lon == null) continue;
  const [x, y] = m.xy(f.lon, f.lat);
  if (!m.inView(x, y, 2)) continue;
  const key = fold(f.name).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (!features[key]) features[key] = [+(100 * x / W).toFixed(2), +(100 * y / H).toFixed(2)];
}
fs.writeFileSync(path.join(REPO, 'images', 'locators.json'), JSON.stringify({ map: 'Irad_location_map.svg', width: W, height: H, places: out, features }, null, 0) + '\n');
console.log('locators:', Object.keys(out).length, 'features:', Object.keys(features).length);
