import { describe, expect, it } from "vitest";
import { watermarkPosition } from "./watermark";

describe("watermarkPosition", () => {
  it("places the watermark at bottom-right with default margin", () => {
    expect(watermarkPosition(1000, 800, 220, 52)).toEqual({ x: 756, y: 724 });
  });

  it("accepts a custom margin", () => {
    expect(watermarkPosition(1000, 800, 220, 52, 10)).toEqual({
      x: 770,
      y: 738,
    });
  });

  it("never returns negative coordinates when base is smaller than watermark", () => {
    expect(watermarkPosition(100, 40, 220, 52)).toEqual({ x: 0, y: 0 });
  });
});
