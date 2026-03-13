import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { spawnSync } from 'child_process';
import { parseHeaders, decodeDds } from 'dds-parser';
import { Hoi4Parser } from './hoi4_parser.mjs';

const ROOT_DIR = process.cwd();
const DEFAULT_HOI4_DIR = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV';
const HOI4_DIR = process.argv[2] || process.env.HOI4_DIR || DEFAULT_HOI4_DIR;

const DATA_DIR = path.join(ROOT_DIR, 'public', 'assets', 'data');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'assets', 'hoi4_ui', 'gfx', 'interface', 'character_icons_exported');
const OUTPUT_JSON = path.join(DATA_DIR, 'character_icon_map.json');

const CHARACTER_DIR = path.join(HOI4_DIR, 'common', 'characters');
const GFX_SEARCH_DIRS = [
  path.join(HOI4_DIR, 'gfx', 'interface', 'ideas'),
  path.join(HOI4_DIR, 'gfx', 'interface'),
  path.join(HOI4_DIR, 'gfx', 'leaders'),
  path.join(HOI4_DIR, 'dlc'),
  path.join(HOI4_DIR, 'integrated_dlc'),
];
const SPRITE_DEF_DIRS = [
  path.join(HOI4_DIR, 'interface'),
  path.join(HOI4_DIR, 'dlc'),
  path.join(HOI4_DIR, 'integrated_dlc'),
];
const LOCALIZATION_DIRS = [
  path.join(HOI4_DIR, 'localisation', 'simp_chinese'),
  path.join(HOI4_DIR, 'localisation', 'english'),
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function collectRecruitCharacterTokens(startingPolitics) {
  const out = new Set();

  const addToken = (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) out.add(trimmed);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(addToken);
      return;
    }

    if (value && typeof value === 'object') {
      Object.values(value).forEach(addToken);
    }
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'recruit_character') {
        addToken(value);
      }
      walk(value);
    }
  };

  walk(startingPolitics);
  return out;
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[\\/]/g, '_');
}

function normalizeTexturePath(textureFile) {
  return String(textureFile || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
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
    const nameMatch = block.match(/\bname\s*=\s*"?([^\s"}]+)"?/i);
    const textureMatch = block.match(/\btexturefile\s*=\s*"([^"]+)"/i);
    if (!nameMatch || !textureMatch) continue;

    const spriteName = sanitizeName(nameMatch[1]);
    const textureFile = normalizeTexturePath(textureMatch[1]);
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

function collectTraitTokens(value, out = []) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTraitTokens(item, out));
    return out;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectTraitTokens(item, out));
  }

  return out;
}

function collectPortraitCandidates(portraits) {
  const small = [];
  const large = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node.small === 'string' && node.small.trim()) {
      small.push(sanitizeName(node.small));
    }
    if (typeof node.large === 'string' && node.large.trim()) {
      large.push(sanitizeName(node.large));
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  };

  walk(portraits);

  if (small.length > 0) {
    return { sprite: small[0], kind: 'small' };
  }
  if (large.length > 0) {
    return { sprite: large[0], kind: 'large' };
  }
  return null;
}

function buildCharacterMetadataMap(targetSet) {
  const metadataMap = new Map();
  const files = fs.readdirSync(CHARACTER_DIR).filter((name) => name.endsWith('.txt'));

  for (const fileName of files) {
    const filePath = path.join(CHARACTER_DIR, fileName);
    let parsed;
    try {
      parsed = Hoi4Parser.parseFile(filePath);
    } catch (error) {
      console.warn(`Failed to parse character file: ${filePath}`, error);
      continue;
    }

    const characters = parsed?.characters;
    if (!characters || typeof characters !== 'object' || Array.isArray(characters)) {
      continue;
    }

    for (const [token, character] of Object.entries(characters)) {
      if (!targetSet.has(token) || !character || typeof character !== 'object' || Array.isArray(character)) {
        continue;
      }

      const portraits = character.portraits;
      const portraitCandidate = collectPortraitCandidates(portraits);
      const advisor = character.advisor && typeof character.advisor === 'object' && !Array.isArray(character.advisor)
        ? character.advisor
        : null;

      metadataMap.set(token, {
        portrait: portraitCandidate,
        ideaToken: typeof advisor?.idea_token === 'string' ? advisor.idea_token.trim() : null,
        traits: Array.from(new Set(collectTraitTokens(advisor?.traits || []))),
      });
    }
  }

  return metadataMap;
}

function parseLocalisationFile(filePath, outMap) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z0-9_.:-]+):\d*\s+"(.*)"\s*$/);
    if (!match) continue;

    const key = match[1];
    if (outMap[key]) continue;

    outMap[key] = match[2]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, ' ')
      .trim();
  }
}

function parseLocalizationDirectories() {
  const out = {};

  for (const dirPath of LOCALIZATION_DIRS) {
    if (!fs.existsSync(dirPath)) continue;
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!fileName.endsWith('.yml')) continue;
      const filePath = path.join(dirPath, fileName);
      try {
        parseLocalisationFile(filePath, out);
      } catch (error) {
        console.warn(`Failed to parse localisation ${filePath}`, error);
      }
    }
  }

  return out;
}

function buildLocalizationResolver(localizationMap) {
  const resolveValue = (value, depth = 0) => {
    if (!value) return null;
    let text = String(value).trim().replace(/§./g, '');

    const fullRef = text.match(/^\$([^$]+)\$$/);
    if (fullRef && depth < 8) {
      return lookup(fullRef[1], depth + 1);
    }

    if (depth < 8 && text.includes('$')) {
      text = text.replace(/\$([^$]+)\$/g, (_m, refKey) => {
        const nested = lookup(String(refKey), depth + 1);
        return nested || String(refKey);
      });
    }

    return text.trim() || null;
  };

  const lookup = (key, depth = 0) => {
    if (!key) return null;
    const raw = String(key).trim();
    if (!raw) return null;

    const direct = localizationMap[raw];
    if (typeof direct === 'string' && direct.trim()) {
      return resolveValue(direct, depth);
    }

    const lower = localizationMap[raw.toLowerCase()];
    if (typeof lower === 'string' && lower.trim()) {
      return resolveValue(lower, depth);
    }

    return null;
  };

  return { lookup };
}

function collectDescriptionCandidates(baseToken) {
  const out = [];
  const push = (value) => {
    if (value && !out.includes(value)) out.push(value);
  };

  const raw = String(baseToken || '').trim();
  if (!raw) return out;

  push(`${raw}_desc`);
  push(`${raw}_tooltip`);
  push(`${raw}_long`);

  const numericSuffix = raw.match(/^(.*)_([0-9]+)$/);
  if (numericSuffix) {
    const stem = numericSuffix[1];
    push(`${stem}_desc`);
    push(`${stem}_tooltip`);
    push(`${stem}_long`);
    push(`${stem}_1_desc`);
    push(`${stem}_1_tooltip`);
    push(`${stem}_1_long`);
  }

  const withoutTag = raw.match(/^[A-Z0-9]{3}_(.+)$/);
  if (withoutTag) {
    const stem = withoutTag[1];
    push(`${stem}_desc`);
    push(`${stem}_tooltip`);
    push(`${stem}_long`);
  }

  return out;
}

function deriveCharacterDescription(token, metadata, localization) {
  const candidates = [
    ...collectDescriptionCandidates(metadata?.ideaToken),
    ...collectDescriptionCandidates(token),
  ];

  for (const key of candidates) {
    const localized = localization.lookup(key);
    if (localized) return localized;
  }

  const traitNames = (metadata?.traits || [])
    .map((trait) => localization.lookup(trait))
    .filter(Boolean);

  if (traitNames.length > 0) {
    return traitNames.join('、');
  }

  return null;
}

function resolveSpriteTexturePath(spriteName, spriteMap, sourceIndex) {
  const normalized = sanitizeName(spriteName);
  if (!normalized) return null;

  const textureFile = spriteMap.get(normalized.toLowerCase());
  if (textureFile) {
    const normalizedTexture = normalizeTexturePath(textureFile);
    const absolutePath = path.join(HOI4_DIR, ...normalizedTexture.split('/'));
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }

    const textureExt = path.extname(normalizedTexture);
    const textureBaseName = path.basename(normalizedTexture, textureExt).toLowerCase();
    const indexedTexturePath = sourceIndex.get(textureBaseName);
    if (indexedTexturePath) {
      return indexedTexturePath;
    }
  }

  const ext = path.extname(normalized);
  const baseName = path.basename(normalized, ext).toLowerCase();
  return sourceIndex.get(baseName) || null;
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
  const derivedRowBytes = height > 0 ? Math.floor(availableBytes / height) : minRowBytes;
  const rowBytes = derivedRowBytes >= minRowBytes ? derivedRowBytes : minRowBytes;
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
    try {
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
    } catch (error) {
      const pythonSnippet = [
        'from PIL import Image',
        'import sys',
        'Image.open(sys.argv[1]).save(sys.argv[2], format="PNG")',
      ].join('; ');

      const commands = [
        ['python', ['-c', pythonSnippet, sourcePath, outputPath]],
        ['py', ['-3', '-c', pythonSnippet, sourcePath, outputPath]],
      ];

      for (const [command, args] of commands) {
        const result = spawnSync(command, args, { encoding: 'utf8' });
        if (result.status === 0) {
          return;
        }
      }

      throw error;
    }
  }

  await sharp(sourcePath)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

function makeOutputFileName(sourcePath) {
  const relativeSource = path.relative(HOI4_DIR, sourcePath)
    .replace(/\.[^.]+$/i, '')
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');

  return `${relativeSource}.png`;
}

async function main() {
  if (!fs.existsSync(HOI4_DIR)) {
    throw new Error(`HOI4 directory not found: ${HOI4_DIR}`);
  }

  const startingPolitics = readJson(path.join(DATA_DIR, 'starting_politics.json'));
  const recruitTokens = collectRecruitCharacterTokens(startingPolitics);
  const characterMetadataMap = buildCharacterMetadataMap(recruitTokens);
  const spriteMap = buildSpriteTextureMap();
  const sourceIndex = buildSourceIndex();
  const localization = buildLocalizationResolver(parseLocalizationDirectories());

  ensureDir(OUTPUT_DIR);

  const exportedBySource = new Map();
  const outMap = {};
  let exportedCount = 0;
  let mappedCount = 0;
  let missingCount = 0;

  for (const token of Array.from(recruitTokens).sort()) {
    const metadata = characterMetadataMap.get(token) || { portrait: null, ideaToken: null, traits: [] };
    const description = deriveCharacterDescription(token, metadata, localization);
    const portrait = metadata.portrait;
    if (!portrait?.sprite) {
      outMap[token] = {
        ideaToken: metadata.ideaToken || undefined,
        traits: metadata.traits,
        description: description || undefined,
      };
      missingCount += 1;
      continue;
    }

    const sourcePath = resolveSpriteTexturePath(portrait.sprite, spriteMap, sourceIndex);
    if (!sourcePath) {
      outMap[token] = {
        sprite: portrait.sprite,
        kind: portrait.kind,
        ideaToken: metadata.ideaToken || undefined,
        traits: metadata.traits,
        description: description || undefined,
      };
      missingCount += 1;
      continue;
    }

    let relativeOutputPath = exportedBySource.get(sourcePath);
    if (!relativeOutputPath) {
      const outputFileName = makeOutputFileName(sourcePath);
      const absoluteOutputPath = path.join(OUTPUT_DIR, outputFileName);
      relativeOutputPath = `assets/hoi4_ui/gfx/interface/character_icons_exported/${outputFileName}`;

      if (!fs.existsSync(absoluteOutputPath)) {
        await convertImage(sourcePath, absoluteOutputPath);
      }

      exportedBySource.set(sourcePath, relativeOutputPath);
      exportedCount += 1;
    }

    outMap[token] = {
      sprite: portrait.sprite,
      kind: portrait.kind,
      ideaToken: metadata.ideaToken || undefined,
      traits: metadata.traits,
      description: description || undefined,
      iconPath: relativeOutputPath,
    };
    mappedCount += 1;
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(outMap, null, 2));

  console.log(`Recruit character tokens: ${recruitTokens.size}`);
  console.log(`Mapped character icons: ${mappedCount}`);
  console.log(`Exported unique icon files: ${exportedCount}`);
  console.log(`Missing character icons: ${missingCount}`);
  console.log(`Wrote: ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
