/**
 * HOI4 地图数据转换脚本
 * 
 * 手动解析 BMP（包括 8-bit 调色板格式）转换为 PNG
 * 解析 definition.csv / states 目录，并转换 rivers.bmp
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// ===== 配置 =====
const HOI4_DIR = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hearts of Iron IV';
const MAP_DIR = path.join(HOI4_DIR, 'map');
const STATES_DIR = path.join(HOI4_DIR, 'history', 'states');
const STRATEGIC_REGIONS_DIR = path.join(MAP_DIR, 'strategicregions');
const COUNTRY_COLORS_FILE = path.join(HOI4_DIR, 'common', 'countries', 'colors.txt');
const COUNTRY_TAGS_FILE = path.join(HOI4_DIR, 'common', 'country_tags', '00_countries.txt');
const COUNTRIES_DIR = path.join(HOI4_DIR, 'common', 'countries');
const OUTPUT_DIR = path.resolve('public', 'assets');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ===== HSV → RGB 转换 =====
function hsvToRgb(h, s, v) {
  // h: 0-1, s: 0-1, v: 0-1 (HOI4 的 HSV 值域)
  // 返回 [r, g, b]，每个值 0-1
  const c = v * s;
  const hPrime = (h * 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = v - c;

  let r1, g1, b1;
  if (hPrime < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hPrime < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hPrime < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hPrime < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hPrime < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }

  return [
    Math.min(1, r1 + m),
    Math.min(1, g1 + m),
    Math.min(1, b1 + m),
  ];
}

// ===== 解析 common/countries/colors.txt 中的国家颜色 =====
function parseCountryColors() {
  const colorMap = {};

  if (!fs.existsSync(COUNTRY_COLORS_FILE)) {
    console.log('  ⚠️ common/countries/colors.txt 不存在');
    return colorMap;
  }

  const content = fs.readFileSync(COUNTRY_COLORS_FILE, 'utf-8');

  // 解析每个 TAG = { color = rgb/hsv { ... } } 块
  // 格式可能跨多行，也可能在同一行
  // 例如: GER = { color = HSV { 0.1 0.15 0.4 } color_ui = rgb { 138 155 116 } }
  // 或: BEL = { color = rgb { 193 171 8 } color_ui = rgb { 251 222 10 } }
  const tagRegex = /^([A-Z][A-Z0-9]{1,2})\s*=\s*\{/gm;
  let tagMatch;

  while ((tagMatch = tagRegex.exec(content)) !== null) {
    const tag = tagMatch[1];
    const startIdx = tagMatch.index + tagMatch[0].length;

    // 找到这个块的结束大括号
    let depth = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length && depth > 0; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) endIdx = i;
    }

    const block = content.substring(startIdx, endIdx);

    // 查找 color = rgb { R G B } （不匹配 color_ui）
    const rgbMatch = block.match(/(?:^|[^_])color\s*=\s*rgb\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}/);
    if (rgbMatch) {
      colorMap[tag] = [
        parseInt(rgbMatch[1]) / 255,
        parseInt(rgbMatch[2]) / 255,
        parseInt(rgbMatch[3]) / 255,
      ];
      continue;
    }

    // 查找 color = HSV { H S V } 或 color = hsv { H S V }
    const hsvMatch = block.match(/(?:^|[^_])color\s*=\s*[Hh][Ss][Vv]\s*\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}/);
    if (hsvMatch) {
      const h = parseFloat(hsvMatch[1]);
      const s = parseFloat(hsvMatch[2]);
      const v = parseFloat(hsvMatch[3]);
      colorMap[tag] = hsvToRgb(h, s, v);
      continue;
    }
  }

  console.log(`  已从 colors.txt 加载 ${Object.keys(colorMap).length} 个国家颜色`);
  return colorMap;
}

// ===== 回退：从各国家定义文件读取颜色 =====
function readCountryFileColor(tag) {
  // 先从 country_tags 文件获取国家文件路径
  if (!fs.existsSync(COUNTRY_TAGS_FILE)) return null;

  const tagsContent = fs.readFileSync(COUNTRY_TAGS_FILE, 'utf-8');
  const fileMatch = tagsContent.match(new RegExp(`${tag}\\s*=\\s*"([^"]+)"`));
  if (!fileMatch) return null;

  const countryFilePath = path.join(HOI4_DIR, 'common', fileMatch[1]);
  if (!fs.existsSync(countryFilePath)) return null;

  const fileContent = fs.readFileSync(countryFilePath, 'utf-8');

  // 匹配 color = rgb { R G B } 格式
  const rgbMatch = fileContent.match(/color\s*=\s*rgb\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}/);
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1]) / 255,
      parseInt(rgbMatch[2]) / 255,
      parseInt(rgbMatch[3]) / 255,
    ];
  }

  // 匹配 color = { R G B }（纯数字，无 rgb/hsv 前缀的旧格式）
  const colorMatch = fileContent.match(/color\s*=\s*\{\s*(\d+)\s+(\d+)\s+(\d+)\s*\}/);
  if (colorMatch) {
    return [
      parseInt(colorMatch[1]) / 255,
      parseInt(colorMatch[2]) / 255,
      parseInt(colorMatch[3]) / 255,
    ];
  }

  return null;
}

// ===== BMP 手动解析器 =====
function parseBMP(filePath) {
  const buf = fs.readFileSync(filePath);

  // BMP File Header (14 bytes)
  const signature = buf.toString('ascii', 0, 2);
  if (signature !== 'BM') throw new Error('Not a BMP file');

  const dataOffset = buf.readUInt32LE(10);

  // DIB Header
  const headerSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  let height = buf.readInt32LE(22);
  const bitsPerPixel = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);

  const topDown = height < 0;
  height = Math.abs(height);

  console.log(`  BMP: ${width}x${height}, ${bitsPerPixel}bpp, compression=${compression}, headerSize=${headerSize}, topDown=${topDown}`);

  // 读取调色板（如果是 8-bit 或更少）
  let palette = null;
  if (bitsPerPixel <= 8) {
    const paletteOffset = 14 + headerSize;
    const numColors = 1 << bitsPerPixel;
    palette = [];
    for (let i = 0; i < numColors; i++) {
      const offset = paletteOffset + i * 4;
      // BMP 调色板是 BGRA
      palette.push({
        b: buf[offset],
        g: buf[offset + 1],
        r: buf[offset + 2],
        a: buf[offset + 3] || 255,
      });
    }
  }

  // 计算每行的字节数（含 padding，BMP 行必须 4 字节对齐）
  const rowSize = Math.ceil((bitsPerPixel * width) / 32) * 4;

  // 创建 RGBA raw buffer
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    // BMP 默认底部向上存储（除非 topDown）
    const srcY = topDown ? y : (height - 1 - y);
    const rowOffset = dataOffset + srcY * rowSize;

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;

      if (bitsPerPixel === 8) {
        const colorIndex = buf[rowOffset + x];
        if (palette && colorIndex < palette.length) {
          pixels[dstIdx] = palette[colorIndex].r;
          pixels[dstIdx + 1] = palette[colorIndex].g;
          pixels[dstIdx + 2] = palette[colorIndex].b;
          pixels[dstIdx + 3] = 255;
        }
      } else if (bitsPerPixel === 24) {
        const srcIdx = rowOffset + x * 3;
        // BMP 是 BGR
        pixels[dstIdx] = buf[srcIdx + 2]; // R
        pixels[dstIdx + 1] = buf[srcIdx + 1]; // G
        pixels[dstIdx + 2] = buf[srcIdx]; // B
        pixels[dstIdx + 3] = 255;
      } else if (bitsPerPixel === 32) {
        const srcIdx = rowOffset + x * 4;
        // BGRA
        pixels[dstIdx] = buf[srcIdx + 2]; // R
        pixels[dstIdx + 1] = buf[srcIdx + 1]; // G
        pixels[dstIdx + 2] = buf[srcIdx]; // B
        pixels[dstIdx + 3] = buf[srcIdx + 3]; // A
      }
    }
  }

  return { width, height, pixels, channels: 4 };
}

// ===== 1. 转换 heightmap =====
async function convertHeightmap() {
  const inputPath = path.join(MAP_DIR, 'heightmap.bmp');
  const outputPath = path.join(OUTPUT_DIR, 'heightmap.png');

  console.log('[1/5] 正在转换 heightmap.bmp → heightmap.png ...');

  const bmp = parseBMP(inputPath);

  await sharp(bmp.pixels, {
    raw: { width: bmp.width, height: bmp.height, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toFile(outputPath);

  console.log(`  ✅ 已保存 ${bmp.width}x${bmp.height} → ${outputPath}`);
  return { width: bmp.width, height: bmp.height };
}

// ===== 2. 转换 provinces =====
async function convertProvinceMap() {
  const inputPath = path.join(MAP_DIR, 'provinces.bmp');
  const outputPath = path.join(OUTPUT_DIR, 'provinces.png');

  console.log('[2/5] 正在转换 provinces.bmp → provinces.png ...');

  const bmp = parseBMP(inputPath);

  await sharp(bmp.pixels, {
    raw: { width: bmp.width, height: bmp.height, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toFile(outputPath);

  console.log(`  ✅ 已保存 ${bmp.width}x${bmp.height} → ${outputPath}`);
  return { width: bmp.width, height: bmp.height };
}

// ===== 3. 转换 rivers =====
async function convertRiversMap() {
  const inputPath = path.join(MAP_DIR, 'rivers.bmp');
  const outputPath = path.join(OUTPUT_DIR, 'rivers.png');

  console.log('[3/5] 正在转换 rivers.bmp → rivers.png ...');

  const bmp = parseBMP(inputPath);

  await sharp(bmp.pixels, {
    raw: { width: bmp.width, height: bmp.height, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toFile(outputPath);

  console.log(`  ✅ 已保存 ${bmp.width}x${bmp.height} → ${outputPath}`);
  return { width: bmp.width, height: bmp.height };
}

// ===== 4. 解析 definition.csv =====
function parseDefinition() {
  const inputPath = path.join(MAP_DIR, 'definition.csv');
  const outputPath = path.join(OUTPUT_DIR, 'provinces.json');

  console.log('[4/5] 正在解析 definition.csv ...');

  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const provinces = {};
  let landCount = 0, seaCount = 0, lakeCount = 0;

  for (const line of lines) {
    const parts = line.trim().split(';');
    if (parts.length < 8) continue;

    const [idStr, rStr, gStr, bStr, type, isCoastalStr, terrain, continentStr] = parts;
    const id = parseInt(idStr);
    if (isNaN(id) || id === 0) continue;

    const t = type.trim();
    provinces[id] = {
      id,
      r: parseInt(rStr), g: parseInt(gStr), b: parseInt(bStr),
      type: t,
      isCoastal: isCoastalStr.trim() === 'true',
      terrain: terrain.trim(),
      continent: parseInt(continentStr) || 0,
    };

    if (t === 'land') landCount++;
    else if (t === 'sea') seaCount++;
    else if (t === 'lake') lakeCount++;
  }

  console.log(`  地块总数: ${Object.keys(provinces).length} (陆地: ${landCount}, 海洋: ${seaCount}, 湖泊: ${lakeCount})`);

  fs.writeFileSync(outputPath, JSON.stringify(provinces));
  console.log(`  ✅ 已保存到 ${outputPath}`);
  return provinces;
}

// ===== 4. 解析中文本地化 =====
function parseLocalization() {
  const LOC_DIR = path.join(HOI4_DIR, 'localisation', 'simp_chinese');
  const stateNamesFile = path.join(LOC_DIR, 'state_names_l_simp_chinese.yml');
  const countryNamesFile = path.join(LOC_DIR, 'countries_l_simp_chinese.yml');
  const strategicRegionNamesFile = path.join(LOC_DIR, 'strategic_region_names_l_simp_chinese.yml');

  const stateNames = {};
  const countryNames = {};
  const strategicRegionNames = {};

  // 解析 State 中文名（兼容 KEY: "值" 与 KEY:0 "值"）
  if (fs.existsSync(stateNamesFile)) {
    const content = fs.readFileSync(stateNamesFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*STATE_(\d+)\s*:\s*(?:\d+\s*)?"([^"]+)"/);
      if (match) {
        stateNames[parseInt(match[1])] = match[2];
      }
    }
    console.log(`  已加载 ${Object.keys(stateNames).length} 个 State 中文名`);
  } else {
    console.log('  ⚠️ State 中文本地化文件不存在');
  }

  // 解析国家中文名
  if (fs.existsSync(countryNamesFile)) {
    const content = fs.readFileSync(countryNamesFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([A-Z]{3})\s*:\s*(?:\d+\s*)?"([^"]+)"/);
      if (match) {
        countryNames[match[1]] = match[2];
      }
    }
    console.log(`  已加载 ${Object.keys(countryNames).length} 个国家中文名`);
  }

  // 解析 Strategic Region 中文名
  if (fs.existsSync(strategicRegionNamesFile)) {
    const content = fs.readFileSync(strategicRegionNamesFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*STRATEGICREGION_(\d+)\s*:\s*(?:\d+\s*)?"([^"]+)"/);
      if (match) {
        strategicRegionNames[parseInt(match[1])] = match[2];
      }
    }
    console.log(`  已加载 ${Object.keys(strategicRegionNames).length} 个海域中文名`);
  } else {
    console.log('  ⚠️ Strategic Region 中文本地化文件不存在');
  }

  return { stateNames, countryNames, strategicRegionNames };
}

// ===== 5. 解析 Strategic Regions（海域/大战区） =====
function parseStrategicRegions(strategicRegionNames = {}) {
  const strategicRegions = {};
  const provinceToStrategicRegion = {};

  if (!fs.existsSync(STRATEGIC_REGIONS_DIR)) {
    console.log('  ⚠️ strategicregions 目录不存在，跳过');
    return { strategicRegions, provinceToStrategicRegion };
  }

  const files = fs.readdirSync(STRATEGIC_REGIONS_DIR).filter(f => f.endsWith('.txt'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(STRATEGIC_REGIONS_DIR, file), 'utf-8');

    const idMatch = content.match(/id\s*=\s*(\d+)/);
    if (!idMatch) continue;
    const regionId = parseInt(idMatch[1]);

    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `STRATEGICREGION_${regionId}`;
    const localName = strategicRegionNames[regionId] || name;

    const navalTerrainMatch = content.match(/naval_terrain\s*=\s*([A-Za-z0-9_]+)/);
    const navalTerrain = navalTerrainMatch ? navalTerrainMatch[1] : null;

    const provMatch = content.match(/provinces\s*=\s*\{([\s\S]*?)\}/);
    if (!provMatch) continue;
    const provList = provMatch[1].trim().split(/\s+/).map(Number).filter(n => !isNaN(n) && n > 0);

    strategicRegions[regionId] = {
      id: regionId,
      name,
      localName,
      provinces: provList,
      navalTerrain,
      isSeaRegion: !!navalTerrain,
    };

    for (const p of provList) {
      provinceToStrategicRegion[p] = regionId;
    }
  }

  console.log(`  Strategic Regions: ${Object.keys(strategicRegions).length}`);
  console.log(`  省份→Strategic Region 映射: ${Object.keys(provinceToStrategicRegion).length} 条`);

  return { strategicRegions, provinceToStrategicRegion };
}

// ===== 6. 解析 states（增强版）=====
function parseStates() {
  const outputPath = path.join(OUTPUT_DIR, 'states.json');

  console.log('[5/5] 正在解析 states 目录（增强版）...');

  // 先加载本地化数据
  console.log('  正在加载中文本地化...');
  const { stateNames, countryNames, strategicRegionNames } = parseLocalization();

  if (!fs.existsSync(STATES_DIR)) {
    console.log('  ⚠️ states 目录不存在，跳过');
    return;
  }

  const files = fs.readdirSync(STATES_DIR).filter(f => f.endsWith('.txt'));
  const states = {};
  const provinceToOwner = {};
  const provinceToState = {};

  const { strategicRegions, provinceToStrategicRegion } = parseStrategicRegions(strategicRegionNames);

  for (const file of files) {
    const content = fs.readFileSync(path.join(STATES_DIR, file), 'utf-8');

    const idMatch = content.match(/id\s*=\s*(\d+)/);
    if (!idMatch) continue;
    const stateId = parseInt(idMatch[1]);

    // 原始名称（键名，如 STATE_1）
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `STATE_${stateId}`;

    // 中文本地化名称
    const localName = stateNames[stateId] || name;

    // 所有者
    const ownerMatch = content.match(/owner\s*=\s*(\w+)/);
    const owner = ownerMatch ? ownerMatch[1] : 'NONE';

    // 人口
    const manpowerMatch = content.match(/manpower\s*=\s*(\d+)/);
    const manpower = manpowerMatch ? parseInt(manpowerMatch[1]) : 0;

    // 类别
    const categoryMatch = content.match(/state_category\s*=\s*(\w+)/);
    const category = categoryMatch ? categoryMatch[1] : 'wasteland';

    // 胜利点
    const victoryPoints = {};
    const vpRegex = /victory_points\s*=\s*\{\s*(\d+)\s+(\d+)\s*\}/g;
    let vpMatch;
    while ((vpMatch = vpRegex.exec(content)) !== null) {
      victoryPoints[parseInt(vpMatch[1])] = parseInt(vpMatch[2]);
    }

    // 核心领土
    const cores = [];
    const coreRegex = /add_core_of\s*=\s*(\w+)/g;
    let coreMatch;
    while ((coreMatch = coreRegex.exec(content)) !== null) {
      if (!cores.includes(coreMatch[1])) {
        cores.push(coreMatch[1]);
      }
    }

    // 省份列表
    const provMatch = content.match(/provinces\s*=\s*\{([^}]+)\}/);
    if (!provMatch) continue;
    const provList = provMatch[1].trim().split(/\s+/).map(Number).filter(n => !isNaN(n) && n > 0);

    states[stateId] = {
      id: stateId,
      name,
      localName,
      owner,
      provinces: provList,
      manpower,
      category,
      victoryPoints,
      cores,
    };

    for (const p of provList) {
      provinceToOwner[p] = owner;
      provinceToState[p] = stateId;
    }
  }

  // 读取国家颜色（从 common/countries/colors.txt，HOI4 专用颜色文件）
  const countries = {};
  const countryColorMap = parseCountryColors();
  const owners = [...new Set(Object.values(provinceToOwner))];
  for (const tag of owners) {
    const localCountryName = countryNames[tag] || tag;
    if (countryColorMap[tag]) {
      countries[tag] = {
        code: tag, name: localCountryName,
        color: countryColorMap[tag],
      };
    } else {
      // 回退：从各国家定义文件读取颜色
      const fallbackColor = readCountryFileColor(tag);
      if (fallbackColor) {
        countries[tag] = {
          code: tag, name: localCountryName,
          color: fallbackColor,
        };
      } else {
        const h = hashCode(tag);
        countries[tag] = {
          code: tag, name: localCountryName,
          color: [((h >> 16) & 0xFF) / 255, ((h >> 8) & 0xFF) / 255, (h & 0xFF) / 255],
        };
        console.log(`  ⚠️ 国家 ${tag} 未找到颜色定义，使用哈希颜色`);
      }
    }
  }

  const result = {
    states,
    provinceToOwner,
    provinceToState,
    strategicRegions,
    provinceToStrategicRegion,
    countries,
  };
  console.log(`  States: ${Object.keys(states).length}, 国家: ${Object.keys(countries).length}, 海域: ${Object.keys(strategicRegions).length}`);
  console.log(`  省份→State 映射: ${Object.keys(provinceToState).length} 条`);

  // 输出颜色信息用于验证
  const colorSourceStats = { fromColors: 0, fromFile: 0, fallback: 0 };
  for (const tag of owners) {
    if (countryColorMap[tag]) colorSourceStats.fromColors++;
    else if (readCountryFileColor(tag)) colorSourceStats.fromFile++;
    else colorSourceStats.fallback++;
  }
  console.log(`  颜色来源: colors.txt=${colorSourceStats.fromColors}, 国家文件=${colorSourceStats.fromFile}, 哈希回退=${colorSourceStats.fallback}`);

  fs.writeFileSync(outputPath, JSON.stringify(result));
  console.log(`  ✅ 已保存到 ${outputPath}`);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) | 0x404040; // 确保颜色不太暗
}

// ===== Main =====
async function main() {
  console.log('==== HOI4 地图数据转换工具 ====\n');

  const hInfo = await convertHeightmap();
  const pInfo = await convertProvinceMap();
  const rInfo = await convertRiversMap();
  parseDefinition();
  parseStates();

  console.log(`\n==== 完成！heightmap: ${hInfo.width}x${hInfo.height}, provinces: ${pInfo.width}x${pInfo.height}, rivers: ${rInfo.width}x${rInfo.height} ====`);
}

main().catch(console.error);
