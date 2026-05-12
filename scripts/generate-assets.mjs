#!/usr/bin/env node
// Generate all city screensaver assets via OpenAI gpt-image-2.
//
// Requires OPENAI_API_KEY in the environment.
//
//   export OPENAI_API_KEY=sk-...
//   node scripts/generate-assets.mjs
//
// Generated PNGs have a solid lime-green (#00FF00) background where transparency
// is wanted — gpt-image-2 doesn't support transparent backgrounds yet, so the
// bg is removed downstream (Figma's AI bg remover works well).
//
// Flags:
//   --only=skyline-near,blimp   regenerate just these assets
//   --force                      regenerate even if the output file exists
//
// Cost: roughly $0.20-0.30 per image at high quality. Full run (~13 assets) ≈ $4.
//
// Tip: at ~140s per image and concurrency 3, the full batch takes ~10 minutes.

import { writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

const MODEL = 'gpt-image-2';
const API_URL = 'https://api.openai.com/v1/images/generations';
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in env. Export it first, e.g.:');
  console.error('  export OPENAI_API_KEY=sk-...');
  console.error('  node scripts/generate-assets.mjs');
  process.exit(1);
}

// All asset specs. Background transparency will be done downstream in Figma,
// so prompts ask for a clean uniform background that an AI bg-remover can
// reliably isolate from the subject.
//
// Skylines: solid flat sky color (lime/green-screen) above buildings so it's
//   easy to magic-wand and delete.
// Sprites:  flat mid-gray background — neutral, no overlap with synthwave palette.
// Street:   no transparency needed.
const ASSETS_SPEC = [
  {
    name: 'skyline-far',
    size: '1536x1024',
    prompt:
      'Wide horizontal panorama of a distant San Francisco skyline ' +
      'silhouette, 1980s synthwave aesthetic. On the right side of the ' +
      'frame, the unmistakable silhouette of the Bay Bridge with twin ' +
      'suspension towers and curving cables stretching across. Rolling ' +
      'hills covered in tiny scattered dots of cyan and hot-pink lit ' +
      'windows. Small, dense, dark navy and deep purple boxy buildings ' +
      'filling the bottom 50% of the frame, hazy purple atmospheric ' +
      'perspective. Above the skyline, the entire upper 50% of the image ' +
      'is a SOLID FLAT LIME GREEN COLOR (#00FF00, completely uniform pure ' +
      'flat green, no gradient, no clouds, no stars). Flat 2D vector ' +
      'illustration style, pure side view, no perspective distortion. ' +
      'Seamlessly tileable horizontally — left edge matches right edge.',
  },
  {
    name: 'skyline-mid',
    size: '1536x1024',
    prompt:
      'Wide horizontal panorama of mid-distance San Francisco buildings on ' +
      'rolling hills, retro 1980s synthwave style. A row of iconic Painted ' +
      'Ladies Victorian houses with peaked rooflines silhouetted on a ' +
      'hill, the silhouette of Coit Tower (a cylindrical tower with ' +
      'rounded top) on another hill, and several mid-rise buildings ' +
      'between them. A large glowing neon rooftop billboard above one ' +
      'building reads "NOTION" in clean white sans-serif letters on a ' +
      'black background. Another rooftop sign reads "LINEAR" in clean ' +
      'magenta neon letters. A smaller cyan billboard reads "SCALE". Lit ' +
      'windows in magenta and hot pink dot the buildings. Hills and ' +
      'buildings fill the bottom 65% of the frame. Above them, the entire ' +
      'upper 35% of the image is a SOLID FLAT LIME GREEN COLOR (#00FF00, ' +
      'completely uniform pure flat green, no gradient, no clouds, no ' +
      'stars). Flat 2D vector illustration style, pure side view, no ' +
      'perspective distortion. Seamlessly tileable horizontally.',
  },
  {
    name: 'skyline-near',
    size: '1536x1024',
    prompt:
      'Wide horizontal panorama of foreground San Francisco buildings, ' +
      'retro 1980s synthwave aesthetic, iconic SF skyscrapers reimagined ' +
      'with AI startup branding. Three distinct prominent buildings: on ' +
      'the left, a tall narrow Salesforce-Tower-style cylindrical ' +
      'skyscraper with a tapered rounded top, near-black silhouette, ' +
      'displaying the glowing white neon wordmark "OPENAI" in clean ' +
      'sans-serif letters across the upper portion. In the center, the ' +
      'distinctive four-sided triangular Transamerica Pyramid silhouette ' +
      'with a glowing warm-orange neon wordmark "ANTHROPIC" running ' +
      'vertically down one side. On the right, a rectangular skyscraper ' +
      'with a massive illuminated billboard reading "CURSOR" in white ' +
      'sans-serif letters on a black background. Between these landmarks, ' +
      'smaller mid-rise buildings carry additional glowing neon signs: a ' +
      'bright orange square billboard with a white letter "Y" inside (the ' +
      'Y Combinator logo), a cyan neon rooftop sign reading "PERPLEXITY", ' +
      'and a sign showing a small black upward-pointing triangle next to ' +
      'the word "VERCEL". All buildings show grids of lit windows in cyan ' +
      'and hot pink. Buildings fill the bottom 75% of the frame. Above ' +
      'them, the entire upper 25% of the image is a SOLID FLAT LIME GREEN ' +
      'COLOR (#00FF00, completely uniform pure flat green, no gradient, ' +
      'no clouds, no stars). Flat 2D vector illustration style, pure side ' +
      'view, no perspective distortion. Seamlessly tileable horizontally.',
  },
  {
    name: 'street',
    size: '1536x1024',
    prompt:
      'A retro synthwave road surface viewed straight-on from a low angle. ' +
      'Dark almost-black wet asphalt with a glowing hot-pink and magenta ' +
      'perspective grid receding to a vanishing point at the top center. ' +
      'Cyan horizon line at the top. Subtle wet reflective shine on the ' +
      'asphalt. Flat 2D illustration style. The entire frame is filled — ' +
      'no transparency, no separate background. Seamlessly tileable ' +
      'horizontally.',
  },
  {
    name: 'moon',
    size: '1024x1024',
    prompt:
      'A large retro synthwave sun, centered on a SOLID FLAT LIME GREEN ' +
      'background (#00FF00, completely uniform pure green, no gradient). ' +
      'The sun is a perfect circle with a smooth vertical gradient from ' +
      'hot pink at the top to bright orange and yellow at the bottom, ' +
      'broken by three horizontal black scanline stripes through the lower ' +
      'half. Subtle soft pink outer glow halo. Classic 1980s sunset sun ' +
      'design, flat 2D illustration. The sun should fill about 70% of the ' +
      'frame, centered.',
  },
  {
    name: 'cloud',
    size: '1536x1024',
    prompt:
      'A long horizontal layer of rolling San Francisco fog (Karl the ' +
      'Fog), centered on a SOLID FLAT LIME GREEN background (#00FF00, ' +
      'completely uniform pure green, no gradient). The fog is voluminous ' +
      'and billowing, low and wide, with soft feathered edges and several ' +
      'lobed rolls along its top. Subtle hot-pink and magenta neon tint ' +
      'catches the underside of the fog, faint cool purple core. 1980s ' +
      'synthwave aesthetic, flat 2D illustration. The fog spans ' +
      'horizontally across the middle of the frame.',
  },
  {
    name: 'blimp',
    size: '1536x1024',
    prompt:
      'A retro 1980s advertising airship blimp, pure side view, body ' +
      'oriented horizontally facing right, centered on a SOLID FLAT LIME ' +
      'GREEN background (#00FF00, completely uniform pure green, no ' +
      'gradient). Chrome metallic silver body with the wordmark "CURSOR" ' +
      'in bold glowing white sans-serif letters across the side, cyan ' +
      'neon horizontal stripes along the length, glowing neon underside, ' +
      'a small gondola cabin underneath with two yellow lit windows, ' +
      'three rear stabilizer fins. Classic synthwave aesthetic, flat 2D ' +
      'vector illustration. The blimp fills the center of the frame.',
  },
  {
    name: 'car-1',
    size: '1024x1024',
    prompt:
      'A single modern Waymo-style autonomous self-driving car shown in ' +
      'pure flat side view, body facing right, centered on a SOLID FLAT ' +
      'LIME GREEN background (#00FF00, completely uniform pure green, no ' +
      'gradient). White car body with subtle blue and green accent ' +
      'stripes along the side matching the Waymo brand identity, a ' +
      'distinctive cylindrical LIDAR sensor pod mounted on the roof, ' +
      'small camera bumps visible on the body, smooth aerodynamic shape ' +
      'like a modern compact electric SUV. The wordmark "WAYMO" in small ' +
      'clean sans-serif letters on the side. Bright cyan neon underglow ' +
      'lighting beneath the car, glowing white headlight on the right ' +
      'side, dark wheels with cyan accents. Flat 2D vector illustration, ' +
      'synthwave / SF tech aesthetic.',
  },
  {
    name: 'car-2',
    size: '1024x1024',
    prompt:
      'A single Tesla Cybertruck shown in pure flat side view, body ' +
      'facing right, centered on a SOLID FLAT LIME GREEN background ' +
      '(#00FF00, completely uniform pure green, no gradient). Brushed ' +
      'metal silver body with the iconic sharp angular geometric ' +
      'Cybertruck shape — flat planar surfaces, no curves, a long sloped ' +
      'roofline that runs from the front to a high back end, exposed ' +
      'wheel arches. Bright magenta neon underglow beneath the truck, a ' +
      'single horizontal light-bar headlight glowing white across the ' +
      'front, dark wheels with magenta accents. Flat 2D vector ' +
      'illustration, synthwave aesthetic.',
  },
  {
    name: 'car-3',
    size: '1024x1024',
    prompt:
      'A single Tesla Model S sleek electric sedan shown in pure flat ' +
      'side view, body facing right, centered on a SOLID FLAT LIME GREEN ' +
      'background (#00FF00, completely uniform pure green, no gradient). ' +
      'Sleek aerodynamic Tesla Model S silhouette, body color deep purple ' +
      'with chrome accents, bright cyan neon underglow beneath, glowing ' +
      'white headlight on the right side, dark wheels with purple ' +
      'hubcaps. Flat 2D vector illustration, synthwave aesthetic.',
  },
  {
    name: 'delivery-bot',
    size: '1024x1024',
    prompt:
      'A modern San Francisco sidewalk delivery robot (Starship / Coco ' +
      'Robotics style), pure flat side view, body facing right, centered ' +
      'on a SOLID FLAT LIME GREEN background (#00FF00, completely uniform ' +
      'pure green, no gradient). The robot is a small cute boxy ' +
      'six-wheeled rover the size of a cooler, with a white-and-cyan ' +
      'plastic body, glowing hot-pink and cyan LED accent strips along ' +
      'the sides, a slim antenna on top, dark rubber wheels with magenta ' +
      'neon hubcap accents and ground underglow. Mounted on a short ' +
      'vertical mast above the body is a flat blank dark rectangular ' +
      'tablet-screen panel acting as the robot\'s face — IMPORTANT: this ' +
      'screen is completely empty, just a plain solid dark rectangle with ' +
      'crisp clean edges, no icons, no text, no graphics inside it, ready ' +
      'for content to be overlaid. Retro 1980s synthwave aesthetic. Flat ' +
      '2D vector illustration. The robot fills the center 65% of the ' +
      'frame.',
  },
  {
    name: 'streetcar',
    size: '1536x1024',
    prompt:
      'A classic San Francisco F-Market Muni heritage PCC streetcar, pure ' +
      'flat side view, body facing right, centered on a SOLID FLAT LIME ' +
      'GREEN background (#00FF00, completely uniform pure green, no ' +
      'gradient). Vintage 1940s PCC streetcar styling with rounded ' +
      'streamlined ends, bright orange-red body with cream trim along the ' +
      'window line, a long row of dark windows showing dim interior ' +
      'lighting, two black doors near the ends, a single round headlight ' +
      'on the front, dark wheels with hot-pink neon underglow, an ' +
      'overhead trolley pole (pantograph) reaching up off the top edge. ' +
      'Above the front window is a flat blank dark rectangular ' +
      'destination panel — IMPORTANT: this panel is completely empty, ' +
      'just a plain solid dark rectangle with crisp clean edges, no text, ' +
      'no graphics inside it, ready for content to be overlaid. Retro ' +
      '1980s synthwave aesthetic with neon cyan and pink accent lighting. ' +
      'Flat 2D vector illustration. The streetcar fills the center 90% ' +
      'of the frame.',
  },
  {
    name: 'drone',
    size: '1024x1024',
    prompt:
      'A small modern quadcopter delivery drone hovering in air, pure ' +
      'flat side view facing right, centered on a SOLID FLAT LIME GREEN ' +
      'background (#00FF00, completely uniform pure green, no gradient). ' +
      'The drone has a sleek matte-black-and-cyan central body, four ' +
      'motor arms each with a rotor shown as a blurred translucent disc ' +
      '(motion blur), a small camera gimbal underneath the body, and ' +
      'glowing hot-pink and cyan LED accent lights on the body. Hanging ' +
      'on two thin taut cables about 80 pixels below the drone is a flat ' +
      'rectangular LED display panel — IMPORTANT: this panel is ' +
      'completely empty, just a plain solid dark rectangle with crisp ' +
      'clean edges, no text, no graphics inside it, ready for content to ' +
      'be overlaid. Retro 1980s synthwave aesthetic. Flat 2D vector ' +
      'illustration. The drone and its hanging panel together fill the ' +
      'center 75% of the frame.',
  },
];

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function generateOne({ name, size, prompt }) {
  const body = {
    model: MODEL,
    prompt,
    size,
    n: 1,
    quality: 'high',
    moderation: 'low',
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const json = await res.json();
  const item = json.data?.[0];
  if (!item) throw new Error(`No data returned: ${JSON.stringify(json)}`);

  let buf;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Failed to fetch image URL: ${imgRes.status}`);
    buf = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error(`Unknown response shape: ${JSON.stringify(item)}`);
  }

  const outPath = path.join(ASSETS, `${name}.png`);
  await writeFile(outPath, buf);
  return outPath;
}

function parseArgs() {
  const args = { only: null, force: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--force') args.force = true;
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map(s => s.trim()).filter(Boolean);
  }
  return args;
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  const { only, force } = parseArgs();

  let queue = ASSETS_SPEC;
  if (only) queue = queue.filter(a => only.includes(a.name));
  if (!force) {
    const filtered = [];
    for (const a of queue) {
      if (await fileExists(path.join(ASSETS, `${a.name}.png`))) {
        console.log(`skip  ${a.name}.png (exists; pass --force to regenerate)`);
      } else {
        filtered.push(a);
      }
    }
    queue = filtered;
  }

  if (queue.length === 0) {
    console.log('Nothing to generate.');
    return;
  }

  console.log(`Generating ${queue.length} asset(s) with ${MODEL}...`);
  const CONCURRENCY = 3;
  let idx = 0;
  const failures = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (idx < queue.length) {
      const spec = queue[idx++];
      const t0 = Date.now();
      try {
        const out = await generateOne(spec);
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`ok    ${spec.name}.png  (${sec}s)  -> ${path.relative(ROOT, out)}`);
      } catch (err) {
        console.error(`FAIL  ${spec.name}: ${err.message}`);
        failures.push(spec.name);
      }
    }
  }));

  if (failures.length) {
    console.error(`\n${failures.length} failure(s): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll done.');
}

main().catch(err => { console.error(err); process.exit(1); });
