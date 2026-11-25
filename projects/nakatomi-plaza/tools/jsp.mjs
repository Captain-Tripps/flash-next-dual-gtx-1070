// jsp.mjs - the voxel run buffer expanded into splat points for the pixel gates.
//
// "jsp" is the point form of the voxel buffer: one entry per voxel, each with a
// position and the palette colour it was drawn with. The gates rasterise these
// points to a screen and assert on the rendered end state, which is how a
// headless test can check that the tower reads as a tower.
//
// Node-side only: it runs in the test harness, never in the page.

export function toSplats(buffer) {
  if (!buffer || !Array.isArray(buffer.runs))
    throw new Error("toSplats wants the buffer view: { runs: [...], hexOf(id) }");
  const points = [];
  const colors = [];
  for (const r of buffer.runs) {
    const hex = buffer.hexOf(r.id);
    if (!hex) throw new Error(`no palette colour for id 0x${Number(r.id).toString(16)}`);
    for (let i = 0; i < r.len; i++) {
      points.push([r.x + i, r.y, r.z]);
      colors.push(hex);
    }
  }
  return { points, colors };
}
