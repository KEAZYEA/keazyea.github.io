/**
 * api/_media.js
 * How long a video really is, read from the file itself (so a page that says
 * "12 seconds" about a 60-second video is caught). MP4 / MOV — including the
 * fragmented MP4 that browsers record — and WebM. Returns seconds, or null
 * when it can't tell. Not an API route (the leading underscore).
 */

/* ---------------- MP4 / MOV ---------------- */
// Calls cb(type, dataStart, end) for each box between start and end.
function eachBox(buf, start, end, cb) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), head = 8;
    const type = buf.toString("latin1", p + 4, p + 8);
    if (size === 1) {
      if (p + 16 > end) return;
      size = Number(buf.readBigUInt64BE(p + 8)); head = 16;
    } else if (size === 0) size = end - p;
    if (size < head || p + size > end) return;
    if (cb(type, p + head, p + size) === false) return;
    p += size;
  }
}
const child = (buf, start, end, want) => { let hit = null; eachBox(buf, start, end, (t, s, e) => { if (t === want) { hit = [s, e]; return false; } }); return hit; };
const u64 = (buf, at) => Number(buf.readBigUInt64BE(at));

function mp4Duration(buf) {
  const moov = child(buf, 0, buf.length, "moov");
  if (!moov) return null;
  let best = 0;
  // the movie's own length (files from phones and editors)
  const mvhd = child(buf, moov[0], moov[1], "mvhd");
  let movieScale = 0;
  if (mvhd) {
    const v = buf[mvhd[0]];
    movieScale = buf.readUInt32BE(mvhd[0] + (v === 1 ? 20 : 12));
    const dur = v === 1 ? u64(buf, mvhd[0] + 24) : buf.readUInt32BE(mvhd[0] + 16);
    if (movieScale && dur && dur !== 0xffffffff) best = Math.max(best, dur / movieScale);
  }
  // fragmented (what browsers record): the length can be in mehd…
  const mvex = child(buf, moov[0], moov[1], "mvex");
  const trexDur = {};
  if (mvex) {
    const mehd = child(buf, mvex[0], mvex[1], "mehd");
    if (mehd && movieScale) {
      const d = buf[mehd[0]] === 1 ? u64(buf, mehd[0] + 4) : buf.readUInt32BE(mehd[0] + 4);
      if (d) best = Math.max(best, d / movieScale);
    }
    eachBox(buf, mvex[0], mvex[1], (t, s) => { if (t === "trex") trexDur[buf.readUInt32BE(s + 4)] = buf.readUInt32BE(s + 12); });
  }
  // …or only in the fragments: each track's time scale, then where its last fragment ends
  const scale = {};
  eachBox(buf, moov[0], moov[1], (t, s, e) => {
    if (t !== "trak") return;
    const tkhd = child(buf, s, e, "tkhd"), mdia = child(buf, s, e, "mdia");
    const mdhd = mdia && child(buf, mdia[0], mdia[1], "mdhd");
    if (!tkhd || !mdhd) return;
    const id = buf.readUInt32BE(tkhd[0] + (buf[tkhd[0]] === 1 ? 20 : 12));
    scale[id] = buf.readUInt32BE(mdhd[0] + (buf[mdhd[0]] === 1 ? 20 : 12));
    const d = buf[mdhd[0]] === 1 ? u64(buf, mdhd[0] + 24) : buf.readUInt32BE(mdhd[0] + 16);
    if (scale[id] && d && d !== 0xffffffff) best = Math.max(best, d / scale[id]);
  });
  const runningEnd = {};
  eachBox(buf, 0, buf.length, (t, s, e) => {
    if (t !== "moof") return;
    eachBox(buf, s, e, (tt, ts, te) => {
      if (tt !== "traf") return;
      const tfhd = child(buf, ts, te, "tfhd");
      if (!tfhd) return;
      const flags = buf.readUInt32BE(tfhd[0]) & 0xffffff;
      const id = buf.readUInt32BE(tfhd[0] + 4);
      let q = tfhd[0] + 8;
      if (flags & 0x01) q += 8;
      if (flags & 0x02) q += 4;
      const defDur = flags & 0x08 ? buf.readUInt32BE(q) : (trexDur[id] || 0);
      const tfdt = child(buf, ts, te, "tfdt");
      let start = tfdt ? (buf[tfdt[0]] === 1 ? u64(buf, tfdt[0] + 4) : buf.readUInt32BE(tfdt[0] + 4)) : (runningEnd[id] || 0);
      let total = 0;
      eachBox(buf, ts, te, (rt, rs) => {
        if (rt !== "trun") return;
        const f = buf.readUInt32BE(rs) & 0xffffff, n = buf.readUInt32BE(rs + 4);
        let r = rs + 8;
        if (f & 0x01) r += 4;
        if (f & 0x04) r += 4;
        const per = (f & 0x100 ? 4 : 0) + (f & 0x200 ? 4 : 0) + (f & 0x400 ? 4 : 0) + (f & 0x800 ? 4 : 0);
        if (n > 1e6 || r + n * per > buf.length) return;
        for (let k = 0; k < n; k++) { total += f & 0x100 ? buf.readUInt32BE(r) : defDur; r += per; }
      });
      runningEnd[id] = Math.max(runningEnd[id] || 0, start + total);
    });
  });
  for (const [id, end] of Object.entries(runningEnd)) if (scale[id]) best = Math.max(best, end / scale[id]);
  return best > 0 ? best : null;
}

/* ---------------- WebM (Matroska) ---------------- */
function vint(buf, p, keepMarker) {
  const first = buf[p];
  if (first === undefined) return null;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || p + len > buf.length) return null;
  let value = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { value = value * 256 + buf[p + i]; if (buf[p + i] !== 0xff) allOnes = false; }
  return { value, len, unknown: !keepMarker && allOnes };
}
const ID = { SEGMENT: 0x18538067, INFO: 0x1549a966, SCALE: 0x2ad7b1, DURATION: 0x4489, CLUSTER: 0x1f43b675, TIMECODE: 0xe7, SIMPLE: 0xa3, GROUP: 0xa0, BLOCK: 0xa1 };
const TOP_LEVEL = new Set([ID.CLUSTER, 0x1c53bb6b, 0x1254c367, 0x114d9b74, 0x1043a770, 0x1941a469, ID.INFO, 0x1654ae6b]);
function webmDuration(buf) {
  if (buf.readUInt32BE(0) !== 0x1a45dfa3) return null;
  let scale = 1000000, infoDur = 0, maxTime = 0;
  const readUint = (s, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[s + i]; return v; };
  // walk elements between start and end; clusterTc = { tc } of the cluster we're in
  const walk = (start, end, depth, clusterTc) => {
    let p = start;
    while (p < end) {
      const id = vint(buf, p, true); if (!id) return end;
      const size = vint(buf, p + id.len); if (!size) return end;
      const data = p + id.len + size.len;
      // a cluster of unknown size ends where the next top-level element starts
      if (depth > 1 && TOP_LEVEL.has(id.value)) return p;
      let stop = size.unknown ? end : Math.min(end, data + size.value);
      if (id.value === ID.SEGMENT) { walk(data, stop, 1, 0); p = stop; continue; }
      if (id.value === ID.INFO) {
        walk(data, stop, 2, 0);
      } else if (id.value === ID.SCALE) {
        scale = readUint(data, size.value);
      } else if (id.value === ID.DURATION) {
        infoDur = size.value === 4 ? buf.readFloatBE(data) : size.value === 8 ? buf.readDoubleBE(data) : 0;
      } else if (id.value === ID.CLUSTER) {
        // its timecode first, then its blocks (times are counted from the cluster's)
        const after = walk(data, stop, 2, { tc: 0 });
        p = size.unknown ? after : stop;
        continue;
      } else if (id.value === ID.TIMECODE && clusterTc) {
        clusterTc.tc = readUint(data, size.value);
      } else if ((id.value === ID.SIMPLE || id.value === ID.BLOCK) && clusterTc) {
        const track = vint(buf, data);
        if (track) maxTime = Math.max(maxTime, clusterTc.tc + buf.readInt16BE(data + track.len));
      } else if (id.value === ID.GROUP && clusterTc) {
        walk(data, stop, 3, clusterTc);
      }
      p = stop;
    }
    return end;
  };
  try { walk(0, buf.length, 0, 0); } catch (e) { /* a cut-off file: use what was read */ }
  const fromInfo = infoDur * scale / 1e9, fromBlocks = maxTime * scale / 1e9;
  const best = Math.max(fromInfo, fromBlocks);
  return best > 0 ? best : null;
}

// seconds, or null when it can't be read
function videoDurationSeconds(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  try {
    if (buf.readUInt32BE(0) === 0x1a45dfa3) return webmDuration(buf);
    return mp4Duration(buf);
  } catch (e) {
    return null;
  }
}

module.exports = { videoDurationSeconds };
