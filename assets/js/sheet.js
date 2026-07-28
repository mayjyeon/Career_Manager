/**
 * 스프레드시트 읽기.
 *
 * 명렬표 파일을 표 형태(문자열 2차원 배열)로 바꿔 줍니다.
 * 외부 라이브러리 없이 브라우저 기능만 씁니다.
 *
 *   .xlsx / .xlsm  ZIP 안의 XML 을 직접 읽습니다.
 *   .csv  / .txt   쉼표·탭 구분 텍스트로 읽습니다(UTF-8, 안 되면 EUC-KR).
 *   .xls           나이스에서 받은 파일은 실제로는 HTML 표인 경우가 많아
 *                  그때는 표를 읽고, 진짜 옛 엑셀 형식이면 안내를 띄웁니다.
 *
 * 병합된 칸은 병합 범위 전체에 같은 값을 채워 넣습니다.
 * (명렬표의 '남'/'여' 처럼 여러 열에 걸친 제목을 열마다 읽을 수 있게 하기 위함입니다.)
 */
import { readZip } from "./zip.js";

export class SheetError extends Error {}

/* =========================================================
   공통
   ========================================================= */
/** "BC" 같은 열 이름을 0부터 시작하는 번호로 바꿉니다. */
function columnIndex(ref) {
  let index = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** "B12" 를 { row, col } 로 바꿉니다(둘 다 0부터 시작). */
function cellAddress(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  return { col: columnIndex(match[1]), row: Number.parseInt(match[2], 10) - 1 };
}

function setCell(rows, row, col, value) {
  if (!value) return;
  while (rows.length <= row) rows.push([]);
  const target = rows[row];
  while (target.length <= col) target.push("");
  target[col] = value;
}

/** 뒤쪽의 빈 행을 잘라내고 모든 행의 길이를 맞춥니다. */
function normalize(rows) {
  let last = -1;
  rows.forEach((row, index) => {
    if (row.some((cell) => cell && cell.trim())) last = index;
  });

  const trimmed = rows.slice(0, last + 1);
  const width = trimmed.reduce((max, row) => Math.max(max, row.length), 0);

  return trimmed.map((row) => {
    const filled = row.slice();
    while (filled.length < width) filled.push("");
    return filled.map((cell) => (cell == null ? "" : String(cell)));
  });
}

/* =========================================================
   xlsx
   ========================================================= */
function parseXml(bytes) {
  const text = new TextDecoder("utf-8").decode(bytes);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new SheetError("엑셀 파일의 내용을 읽지 못했습니다. 파일이 손상되었을 수 있습니다.");
  }
  return doc;
}

/** 공유 문자열 테이블을 읽습니다. */
function readSharedStrings(files) {
  const entry = files.get("xl/sharedStrings.xml");
  if (!entry) return [];

  return Array.from(parseXml(entry).getElementsByTagName("si")).map((si) => {
    // <si> 안에 여러 <t> 조각으로 나뉘어 있을 수 있어 이어 붙입니다.
    // 발음 표기(<rPh>)는 본문이 아니므로 제외합니다.
    let text = "";
    for (const t of si.getElementsByTagName("t")) {
      if (t.parentNode?.nodeName === "rPh") continue;
      text += t.textContent ?? "";
    }
    return text;
  });
}

/** 워크북에서 시트 이름과 실제 XML 경로를 찾습니다. */
function readSheetList(files) {
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) throw new SheetError("엑셀 파일 구조가 올바르지 않습니다.");

  const relationships = new Map();
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (rels) {
    for (const node of parseXml(rels).getElementsByTagName("Relationship")) {
      relationships.set(node.getAttribute("Id"), node.getAttribute("Target"));
    }
  }

  const sheets = [];
  for (const node of parseXml(workbook).getElementsByTagName("sheet")) {
    const id = node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let target = relationships.get(id) ?? "";
    target = target.replace(/^\/?xl\//, "").replace(/^\//, "");

    const path = target ? `xl/${target}` : "";
    sheets.push({ name: node.getAttribute("name") || "", path });
  }

  // 관계 정보가 없으면 흔한 이름으로 넘겨짚습니다.
  if (sheets.length && !sheets.some((s) => files.has(s.path))) {
    const fallback = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
    sheets.forEach((sheet, index) => {
      if (fallback[index]) sheet.path = fallback[index];
    });
  }

  return sheets.filter((sheet) => files.has(sheet.path));
}

function readWorksheet(bytes, sharedStrings) {
  const doc = parseXml(bytes);
  const rows = [];

  for (const c of doc.getElementsByTagName("c")) {
    const address = cellAddress(c.getAttribute("r") ?? "");
    if (!address) continue;

    const type = c.getAttribute("t");
    let value = "";

    if (type === "inlineStr") {
      value = Array.from(c.getElementsByTagName("t"))
        .map((t) => t.textContent ?? "")
        .join("");
    } else {
      const v = c.getElementsByTagName("v")[0];
      const raw = v?.textContent ?? "";

      if (type === "s") {
        value = sharedStrings[Number.parseInt(raw, 10)] ?? "";
      } else if (type === "b") {
        value = raw === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        value = ""; // 오류 값(#REF! 등)은 빈칸으로 둡니다.
      } else {
        value = raw;
      }
    }

    setCell(rows, address.row, address.col, value.trim());
  }

  // 병합된 칸의 값을 범위 전체에 채웁니다.
  for (const node of doc.getElementsByTagName("mergeCell")) {
    const [from, to] = (node.getAttribute("ref") ?? "").split(":").map(cellAddress);
    if (!from || !to) continue;

    const value = rows[from.row]?.[from.col] ?? "";
    if (!value) continue;

    for (let row = from.row; row <= to.row; row += 1) {
      for (let col = from.col; col <= to.col; col += 1) {
        setCell(rows, row, col, value);
      }
    }
  }

  return normalize(rows);
}

async function readXlsx(buffer) {
  const files = await readZip(buffer);
  const sharedStrings = readSharedStrings(files);
  const sheets = readSheetList(files);

  if (sheets.length === 0) throw new SheetError("엑셀 파일에서 시트를 찾지 못했습니다.");

  return sheets.map((sheet) => ({
    name: sheet.name,
    rows: readWorksheet(files.get(sheet.path), sharedStrings),
  }));
}

/* =========================================================
   HTML 표 (나이스에서 받은 .xls 가 이 경우가 많습니다)
   ========================================================= */
function readHtmlTables(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");

  return Array.from(doc.querySelectorAll("table")).map((table, index) => {
    const rows = [];

    Array.from(table.rows).forEach((tr) => {
      const row = [];
      Array.from(tr.cells).forEach((cell) => {
        const value = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
        // 병합된 칸은 xlsx 와 똑같이 범위 전체를 같은 값으로 채웁니다.
        for (let i = 0; i < (cell.colSpan || 1); i += 1) row.push(value);
      });
      rows.push(row);
    });

    return { name: table.caption?.textContent?.trim() || `표 ${index + 1}`, rows: normalize(rows) };
  });
}

/* =========================================================
   CSV
   ========================================================= */
function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;

  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function readCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field.trim());
  rows.push(row);

  return normalize(rows);
}

/** UTF-8 로 읽고, 깨지면 EUC-KR(CP949)로 다시 읽습니다. */
function decodeText(bytes) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");

  try {
    return new TextDecoder("euc-kr").decode(bytes);
  } catch {
    return utf8.replace(/^﻿/, "");
  }
}

/* =========================================================
   진입점
   ========================================================= */
const startsWith = (bytes, signature) =>
  signature.every((byte, index) => bytes[index] === byte);

/**
 * 파일을 읽어 시트 목록을 돌려줍니다.
 * @param {File} file
 * @returns {Promise<Array<{ name: string, rows: string[][] }>>}
 */
export async function readSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 8));

  // 옛 엑셀(.xls)과 한글 문서는 OLE 복합 파일이라 브라우저에서 풀 수 없습니다.
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new SheetError(
      "예전 엑셀 형식(.xls)입니다. 엑셀에서 열어 '다른 이름으로 저장 → Excel 통합 문서(.xlsx)' 로 바꾼 뒤 다시 올려주세요."
    );
  }

  if (startsWith(head, [0x50, 0x4b])) {
    return readXlsx(buffer);
  }

  const text = decodeText(new Uint8Array(buffer));

  if (/<\s*(table|html)[\s>]/i.test(text.slice(0, 4000))) {
    const tables = readHtmlTables(text);
    if (tables.length) return tables;
  }

  const rows = readCsv(text);
  if (rows.length === 0) throw new SheetError("파일에서 읽을 내용을 찾지 못했습니다.");

  return [{ name: file.name, rows }];
}
