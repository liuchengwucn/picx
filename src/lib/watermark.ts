/**
 * 计算水印贴在底图右下角的左上角坐标 (留 margin 边距)。
 * 底图比水印还小时夹到 0, 避免负坐标。
 */
export function watermarkPosition(
  baseWidth: number,
  baseHeight: number,
  markWidth: number,
  markHeight: number,
  margin = 24,
): { x: number; y: number } {
  return {
    x: Math.max(0, baseWidth - markWidth - margin),
    y: Math.max(0, baseHeight - markHeight - margin),
  };
}
