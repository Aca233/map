import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import sharp from 'sharp';
import { parseHeaders, decodeDds } from 'dds-parser';
import { Hoi4Parser } from './hoi4_parser.mjs';

const ROOT_DIR = process.cwd();
const DEFAULT_HOI4_DIR = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV';
const HOI4_DIR = process.argv[2] || process.env.HOI4_DIR || DEFAULT_HOI4_DIR;

const DATA_DIR = path.join(ROOT_DIR, 'public', 'assets', 'data');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'assets', 'hoi4_ui', 'gfx', 'interface', 'ideas_exported');
const OUTPUT_JSON = path.join(DATA_DIR, 'spirit_icon_map.json');

const IDEAS_DIR = path.join(HOI4_DIR, 'common', 'ideas');
const MIO_ORGANIZATION_DIR = path.join(HOI4_DIR, 'common', 'military_industrial_organization', 'organizations');
const GFX_SEARCH_DIRS = [
  path.join(HOI4_DIR, 'gfx', 'interface', 'ideas'),
  path.join(HOI4_DIR, 'gfx', 'interface'),
  path.join(HOI4_DIR, 'dlc'),
  path.join(HOI4_DIR, 'integrated_dlc'),
];
const SPRITE_DEF_DIRS = [
  path.join(HOI4_DIR, 'interface'),
  path.join(HOI4_DIR, 'dlc'),
  path.join(HOI4_DIR, 'integrated_dlc'),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function collectTargetIdeaTokens(taxonomy) {
  return new Set(Object.keys(taxonomy?.ideas || {}));
}

function isIdeaDefinition(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;

  const ideaKeys = [
    'picture',
    'modifier',
    'research_bonus',
    'research_bonus_factor',
    'equipment_bonus',
    'equipment_bonus_factor',
    'traits',
    'cost',
    'removal_cost',
    'ledger',
    'allowed',
    'allowed_civil_war',
    'available',
    'visible',
    'cancel',
    'cancel_if_invalid',
    'do_effect',
    'rule',
  ];

  return ideaKeys.some((key) => Object.prototype.hasOwnProperty.call(node, key));
}

function collectAllIdeaTokens(node, tokenSet) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectAllIdeaTokens(item, tokenSet));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (isIdeaDefinition(value)) {
      tokenSet.add(key);
    }
    collectAllIdeaTokens(value, tokenSet);
  }
}

function buildAllIdeaTokenSet() {
  const tokenSet = new Set();
  const files = fs.readdirSync(IDEAS_DIR).filter((name) => name.endsWith('.txt'));

  for (const fileName of files) {
    const filePath = path.join(IDEAS_DIR, fileName);
    const parsed = Hoi4Parser.parseFile(filePath);
    collectAllIdeaTokens(parsed, tokenSet);
  }

  return tokenSet;
}

function collectIdeaPictures(node, targetSet, pictureMap) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectIdeaPictures(item, targetSet, pictureMap));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (targetSet.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.picture === 'string' && value.picture.trim()) {
        pictureMap.set(key, value.picture.trim());
      }
    }
    collectIdeaPictures(value, targetSet, pictureMap);
  }
}

function buildIdeaPictureMap(targetSet) {
  const pictureMap = new Map();
  const files = fs.readdirSync(IDEAS_DIR).filter((name) => name.endsWith('.txt'));

  for (const fileName of files) {
    const filePath = path.join(IDEAS_DIR, fileName);
    const parsed = Hoi4Parser.parseFile(filePath);
    collectIdeaPictures(parsed, targetSet, pictureMap);
  }

  return pictureMap;
}

function collectOrganizationIcons(node, iconMap) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectOrganizationIcons(item, iconMap));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.icon === 'string' && value.icon.trim()) {
      iconMap.set(key, value.icon.trim());
    }
    collectOrganizationIcons(value, iconMap);
  }
}

function buildOrganizationIconMap() {
  const iconMap = new Map();
  const files = walkFiles(MIO_ORGANIZATION_DIR).filter((filePath) => path.extname(filePath).toLowerCase() === '.txt');

  for (const filePath of files) {
    try {
      const parsed = Hoi4Parser.parseFile(filePath);
      collectOrganizationIcons(parsed, iconMap);
    } catch (error) {
      console.warn(`Failed to parse organization file: ${filePath}`, error);
    }
  }

  return iconMap;
}

function walkFiles(dirPath, out = []) {
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

function buildSourceIndex() {
  const index = new Map();
  for (const dirPath of GFX_SEARCH_DIRS) {
    for (const filePath of walkFiles(dirPath)) {
      const ext = path.extname(filePath).toLowerCase();
      if (!['.dds', '.tga', '.png'].includes(ext)) continue;
      const baseName = path.basename(filePath, ext).toLowerCase();
      if (!index.has(baseName)) {
        index.set(baseName, filePath);
      }
    }
  }
  return index;
}

function collectSpriteDefsFromText(content, spriteMap) {
  const spriteRegex = /spriteType\s*=\s*\{([\s\S]*?)\}/gi;

  for (const match of content.matchAll(spriteRegex)) {
    const block = match[1] || '';
    const nameMatch = block.match(/\bname\s*=\s*"([^"]+)"/i);
    const textureMatch = block.match(/\btexturefile\s*=\s*"([^"]+)"/i);
    if (!nameMatch || !textureMatch) continue;

    const spriteName = String(nameMatch[1]).trim();
    const textureFile = String(textureMatch[1]).trim();
    if (!spriteName || !textureFile) continue;

    spriteMap.set(spriteName.toLowerCase(), textureFile);
  }
}

function buildSpriteTextureMap() {
  const spriteMap = new Map();

  for (const dirPath of SPRITE_DEF_DIRS) {
    for (const filePath of walkFiles(dirPath)) {
      if (path.extname(filePath).toLowerCase() !== '.gfx') continue;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        collectSpriteDefsFromText(content, spriteMap);
      } catch (error) {
        console.warn(`Failed to parse sprite definitions: ${filePath}`, error);
      }
    }
  }

  return spriteMap;
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^GFX_idea_/i, '')
    .replace(/^GFX_/i, '')
    .replace(/[\\/]/g, '_');
}

function normalizeTexturePath(textureFile) {
  return String(textureFile || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function resolveSpriteTexturePath(candidate, spriteMap, sourceIndex) {
  const spriteCandidates = [];
  const normalized = sanitizeName(candidate);
  if (!normalized) return null;

  if (/^gfx_/i.test(normalized)) {
    spriteCandidates.push(normalized);
  } else {
    spriteCandidates.push(`GFX_idea_${normalized}`);
    spriteCandidates.push(`GFX_${normalized}`);
    spriteCandidates.push(normalized);
  }

  for (const spriteName of spriteCandidates) {
    const textureFile = spriteMap.get(spriteName.toLowerCase());
    if (!textureFile) continue;

    const normalizedTexture = normalizeTexturePath(textureFile);
    const absolutePath = path.join(HOI4_DIR, ...normalizedTexture.split('/'));
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }

    const ext = path.extname(normalizedTexture);
    const baseName = path.basename(normalizedTexture, ext).toLowerCase();
    const indexedPath = sourceIndex.get(baseName);
    if (indexedPath) {
      return indexedPath;
    }
  }

  return null;
}

function resolveIconSource(token, picture, sourceIndex, spriteMap) {
  const candidates = [picture, token]
    .map(sanitizeName)
    .filter(Boolean);

  for (const candidate of candidates) {
    const spriteTexturePath = resolveSpriteTexturePath(candidate, spriteMap, sourceIndex);
    if (spriteTexturePath) {
      return { sourcePath: spriteTexturePath, pictureKey: candidate };
    }

    const sourcePath = sourceIndex.get(candidate.toLowerCase());
    if (sourcePath) return { sourcePath, pictureKey: candidate };
  }

  return { sourcePath: null, pictureKey: candidates[0] || sanitizeName(token) };
}

function bufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function countMaskBits(mask) {
  let bits = 0;
  let value = mask >>> 0;
  while (value !== 0) {
    bits += (value & 1);
    value >>>= 1;
  }
  return bits;
}

function countTrailingZeros(mask) {
  let shift = 0;
  let value = mask >>> 0;
  while (shift < 32 && (value & 1) === 0) {
    value >>>= 1;
    shift += 1;
  }
  return shift;
}

function decodeMaskedChannel(pixelValue, mask) {
  if (!mask) return 0;
  const shift = countTrailingZeros(mask);
  const normalizedMask = mask >>> shift;
  const bitCount = countMaskBits(normalizedMask);
  if (bitCount <= 0) return 0;

  const raw = (pixelValue & mask) >>> shift;
  const maxValue = (1 << bitCount) - 1;
  return Math.round((raw / maxValue) * 255);
}

function parseDds(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'DDS ') {
    throw new Error(`Invalid DDS file: ${filePath}`);
  }

  const headerSize = buf.readUInt32LE(4);
  const width = buf.readUInt32LE(16);
  const height = buf.readUInt32LE(12);
  const pitchOrLinearSize = buf.readUInt32LE(20);

  const pfFlags = buf.readUInt32LE(80);
  const fourCC = buf.readUInt32LE(84);
  const rgbBitCount = buf.readUInt32LE(88);
  const rMask = buf.readUInt32LE(92);
  const gMask = buf.readUInt32LE(96);
  const bMask = buf.readUInt32LE(100);
  const aMask = buf.readUInt32LE(104);

  const DDPF_FOURCC = 0x4;
  const isFourCC = (pfFlags & DDPF_FOURCC) !== 0;

  if (isFourCC && fourCC !== 0) {
    const arrayBuffer = bufferToArrayBuffer(buf);
    const info = parseHeaders(arrayBuffer);
    const image = info.images[0];
    const encoded = new Uint8Array(arrayBuffer, image.offset, image.length);
    const decoded = decodeDds(encoded, info.format, image.shape.width, image.shape.height);
    return {
      width: image.shape.width,
      height: image.shape.height,
      pixels: Buffer.from(decoded),
      channels: 4,
    };
  }

  if (rgbBitCount !== 32) {
    throw new Error(`Unsupported DDS bit depth ${rgbBitCount}: ${filePath}`);
  }

  const dataOffset = headerSize + 4;
  const minRowBytes = width * 4;
  const availableBytes = Math.max(0, buf.length - dataOffset);
  const derivedRowBytes = height > 0
    ? Math.floor(availableBytes / height)
    : minRowBytes;
  // 部分 HOI4 DDS 会把 pitch/linear size 写成整张图大小，不能直接拿来当逐行跨度。
  const rowBytes = derivedRowBytes >= minRowBytes
    ? derivedRowBytes
    : minRowBytes;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const srcRow = dataOffset + y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const src = srcRow + x * 4;
      if (src + 4 > buf.length) {
        throw new Error(`DDS pixel data out of range: ${filePath}`);
      }
      const packed = buf.readUInt32LE(src);
      const dst = (y * width + x) * 4;
      pixels[dst] = decodeMaskedChannel(packed, rMask);
      pixels[dst + 1] = decodeMaskedChannel(packed, gMask);
      pixels[dst + 2] = decodeMaskedChannel(packed, bMask);
      pixels[dst + 3] = aMask ? decodeMaskedChannel(packed, aMask) : 255;
    }
  }

  return { width, height, pixels, channels: 4 };
}

async function convertImage(sourcePath, outputPath) {
  const ext = path.extname(sourcePath).toLowerCase();
  ensureDir(path.dirname(outputPath));

  if (ext === '.dds') {
    const pillowScript = 'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2])';
    const attempts = [
      process.env.PYTHON ? [process.env.PYTHON, ['-c', pillowScript, sourcePath, outputPath]] : null,
      ['python', ['-c', pillowScript, sourcePath, outputPath]],
      ['py', ['-3', '-c', pillowScript, sourcePath, outputPath]],
    ].filter(Boolean);

    for (const [command, args] of attempts) {
      const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
      if (!result.error && result.status === 0) {
        return;
      }
    }

    const dds = parseDds(sourcePath);
    await sharp(dds.pixels, {
      raw: {
        width: dds.width,
        height: dds.height,
        channels: dds.channels,
      },
    })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    return;
  }

  await sharp(sourcePath)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function main() {
  if (!fs.existsSync(HOI4_DIR)) {
    throw new Error(`HOI4 directory not found: ${HOI4_DIR}`);
  }

  const taxonomy = readJson(path.join(DATA_DIR, 'political_taxonomy.json'));
  const taxonomyIdeaTokens = collectTargetIdeaTokens(taxonomy);
  const discoveredIdeaTokens = buildAllIdeaTokenSet();
  const ideaTokens = new Set([
    ...taxonomyIdeaTokens,
    ...discoveredIdeaTokens,
  ]);
  const organizationIcons = buildOrganizationIconMap();
  const pictureMap = buildIdeaPictureMap(ideaTokens);
  const sourceIndex = buildSourceIndex();
  const spriteMap = buildSpriteTextureMap();
  const targetTokens = new Set([
    ...ideaTokens,
    ...organizationIcons.keys(),
  ]);

  ensureDir(OUTPUT_DIR);

  const exportedByPicture = new Map();
  const outMap = {};
  let exportedCount = 0;
  let missingCount = 0;

  for (const token of Array.from(targetTokens).sort()) {
    const picture = pictureMap.get(token) || organizationIcons.get(token) || token;
    const { sourcePath, pictureKey } = resolveIconSource(token, picture, sourceIndex, spriteMap);

    if (!sourcePath) {
      outMap[token] = { picture: pictureKey };
      missingCount += 1;
      continue;
    }

    let relativeOutputPath = exportedByPicture.get(sourcePath);
    if (!relativeOutputPath) {
      const fileBase = path.basename(sourcePath, path.extname(sourcePath));
      const outputFileName = `${fileBase}.png`;
      const absoluteOutputPath = path.join(OUTPUT_DIR, outputFileName);
      relativeOutputPath = `assets/hoi4_ui/gfx/interface/ideas_exported/${outputFileName}`;

      if (!fs.existsSync(absoluteOutputPath)) {
        await convertImage(sourcePath, absoluteOutputPath);
      }

      exportedByPicture.set(sourcePath, relativeOutputPath);
      exportedCount += 1;
    }

    outMap[token] = {
      picture: pictureKey,
      iconPath: relativeOutputPath,
    };
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(outMap, null, 2));

  console.log(`Idea tokens: ${ideaTokens.size}`);
  console.log(`Organization tokens: ${organizationIcons.size}`);
  console.log(`Total mapped tokens: ${targetTokens.size}`);
  console.log(`Exported icon files: ${exportedCount}`);
  console.log(`Missing icon mappings: ${missingCount}`);
  console.log(`Wrote: ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
