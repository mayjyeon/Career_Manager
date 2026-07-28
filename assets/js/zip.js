/**
 * ZIP 읽기·쓰기.
 *
 * 엑셀(.xlsx)과 한글(.hwpx)은 둘 다 ZIP 안에 XML 이 들어 있는 형식이라
 * 명렬표 읽기와 상담기록 내보내기가 이 모듈을 함께 씁니다.
 *
 * 압축/해제는 브라우저에 내장된 CompressionStream / DecompressionStream 을 씁니다.
 * (Chrome 103+, Edge 103+, Firefox 113+, Safari 16.4+)
 */

/* =========================================================
   CRC-32
   ========================================================= */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* =========================================================
   압축 / 해제
   ========================================================= */
export function supportsCompressionStreams() {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function pipeThrough(bytes, stream) {
  const blob = new Blob([bytes]);
  const piped = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

const inflateRaw = (bytes) => pipeThrough(bytes, new DecompressionStream("deflate-raw"));
const deflateRaw = (bytes) => pipeThrough(bytes, new CompressionStream("deflate-raw"));

/* =========================================================
   읽기
   ========================================================= */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** 뒤에서부터 훑어 End Of Central Directory 위치를 찾습니다. */
function findEndOfCentralDirectory(view) {
  // EOCD 는 최소 22바이트이고, 주석이 붙어도 65535바이트를 넘지 않습니다.
  const limit = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= limit; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * ZIP 을 풀어 { 파일이름 → 바이트 } 로 돌려줍니다.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("ZIP 형식이 아니거나 파일이 손상되었습니다.");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder("utf-8");
  const files = new Map();

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // 폴더 항목은 건너뜁니다.
    if (name.endsWith("/")) continue;
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) continue;

    // 로컬 헤더의 이름/부가정보 길이는 중앙 디렉터리와 다를 수 있습니다.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    if (method === 0) {
      files.set(name, raw);
    } else if (method === 8) {
      files.set(name, await inflateRaw(raw));
    } else {
      throw new Error(`지원하지 않는 압축 방식입니다(${method}). 파일을 다시 저장해 주세요.`);
    }
  }

  return files;
}

/* =========================================================
   쓰기
   ========================================================= */
const encoder = new TextEncoder();

const toBytes = (data) => (typeof data === "string" ? encoder.encode(data) : data);

function writeUint32(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * ZIP 파일을 만듭니다.
 *
 * @param {Array<{ name: string, data: string|Uint8Array, store?: boolean }>} entries
 *        store 가 true 면 압축하지 않고 그대로 넣습니다.
 *        (hwpx 의 mimetype 은 규격상 맨 앞에 압축 없이 들어가야 합니다.)
 * @param {string} [mimeType] 결과 Blob 의 MIME 타입
 * @returns {Promise<Blob>}
 */
export async function writeZip(entries, mimeType = "application/zip") {
  const prepared = [];

  for (const entry of entries) {
    const data = toBytes(entry.data);
    const compressed = entry.store ? data : await deflateRaw(data);

    // 압축이 오히려 커지면 그대로 담습니다.
    const useStore = entry.store || compressed.length >= data.length;

    prepared.push({
      nameBytes: encoder.encode(entry.name),
      crc: crc32(data),
      size: data.length,
      payload: useStore ? data : compressed,
      method: useStore ? 0 : 8,
    });
  }

  const localSize = prepared.reduce(
    (sum, e) => sum + 30 + e.nameBytes.length + e.payload.length,
    0
  );
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);

  const out = new Uint8Array(localSize + centralSize + 22);
  let pos = 0;

  for (const entry of prepared) {
    entry.offset = pos;

    writeUint32(out, pos, SIG_LOCAL);
    writeUint16(out, pos + 4, 20); // 필요 버전
    writeUint16(out, pos + 6, 0x0800); // 이름이 UTF-8 임을 표시
    writeUint16(out, pos + 8, entry.method);
    writeUint16(out, pos + 10, 0); // 시각
    writeUint16(out, pos + 12, 0x21); // 날짜(1980-01-01)
    writeUint32(out, pos + 14, entry.crc);
    writeUint32(out, pos + 18, entry.payload.length);
    writeUint32(out, pos + 22, entry.size);
    writeUint16(out, pos + 26, entry.nameBytes.length);
    writeUint16(out, pos + 28, 0);
    pos += 30;

    out.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
    out.set(entry.payload, pos);
    pos += entry.payload.length;
  }

  const centralStart = pos;

  for (const entry of prepared) {
    writeUint32(out, pos, SIG_CENTRAL);
    writeUint16(out, pos + 4, 20); // 만든 버전
    writeUint16(out, pos + 6, 20); // 필요 버전
    writeUint16(out, pos + 8, 0x0800);
    writeUint16(out, pos + 10, entry.method);
    writeUint16(out, pos + 12, 0);
    writeUint16(out, pos + 14, 0x21);
    writeUint32(out, pos + 16, entry.crc);
    writeUint32(out, pos + 20, entry.payload.length);
    writeUint32(out, pos + 24, entry.size);
    writeUint16(out, pos + 28, entry.nameBytes.length);
    writeUint16(out, pos + 30, 0); // 부가정보 길이
    writeUint16(out, pos + 32, 0); // 주석 길이
    writeUint16(out, pos + 34, 0); // 디스크 번호
    writeUint16(out, pos + 36, 0); // 내부 속성
    writeUint32(out, pos + 38, 0); // 외부 속성
    writeUint32(out, pos + 42, entry.offset);
    pos += 46;

    out.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
  }

  writeUint32(out, pos, SIG_EOCD);
  writeUint16(out, pos + 4, 0);
  writeUint16(out, pos + 6, 0);
  writeUint16(out, pos + 8, prepared.length);
  writeUint16(out, pos + 10, prepared.length);
  writeUint32(out, pos + 12, centralSize);
  writeUint32(out, pos + 16, centralStart);
  writeUint16(out, pos + 20, 0);

  return new Blob([out], { type: mimeType });
}
