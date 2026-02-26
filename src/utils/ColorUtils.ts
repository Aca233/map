/**
 * 颜色工具函数：RGB -> Province ID 的转换
 */

/** 将 RGB 三个通道值编码为一个唯一整数 ID */
export function rgbToId(r: number, g: number, b: number): number {
  return r * 65536 + g * 256 + b;
}

/** 将 Province ID 解码回 RGB */
export function idToRgb(id: number): [number, number, number] {
  const r = (id >> 16) & 0xff;
  const g = (id >> 8) & 0xff;
  const b = id & 0xff;
  return [r, g, b];
}

/** 将 0-255 RGB 转换为 0-1 归一化值 */
export function rgbNormalize(r: number, g: number, b: number): [number, number, number] {
  return [r / 255, g / 255, b / 255];
}
