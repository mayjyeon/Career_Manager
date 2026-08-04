/**
 * 엑셀 파일(.xlsx) 만들기.
 *
 * .xlsx 는 XML 몇 개를 담은 ZIP 이라 외부 라이브러리 없이 만들 수 있습니다.
 * 읽기는 sheet.js 가, ZIP 은 zip.js 가 맡습니다(hwpx 만들 때와 같은 코드).
 *
 * 글자는 공유 문자열 표를 만들지 않고 칸 안에 그대로 넣습니다(inlineStr).
 * 표 하나를 통째로 내보내는 용도라 표를 따로 둘 만큼 이득이 없습니다.
 *
 *   buildXlsx({ sheets: [{ name: "세특", columns: [...], rows: [[...], ...] }] })
 */
import { writeZip } from "./zip.js";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** XML 에 넣을 수 없는 글자를 걸러내고 특수문자를 바꿉니다. */
function escapeXml(value) {
  return String(value ?? "")
    // 제어 문자는 엑셀이 파일 전체를 손상으로 봅니다(탭·줄바꿈은 남깁니다).
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 0부터 시작하는 열 번호를 "A", "B", … "AA" 로 바꿉니다. */
export function columnName(index) {
  let name = "";
  let n = index;

  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** 시트 이름에 쓸 수 없는 글자를 다듬습니다(엑셀 규칙: 31자, : \ / ? * [ ] 금지). */
function safeSheetName(name, index) {
  const cleaned = String(name ?? "")
    .replace(/[:\\/?*[\]]/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || `시트${index + 1}`;
}

/**
 * 칸 하나.
 * 숫자는 숫자로, 나머지는 글자로 넣습니다. 빈 값은 칸 자체를 만들지 않습니다.
 */
function cellXml(ref, value, style) {
  if (value == null || value === "") return "";

  const attrs = `r="${ref}"${style ? ` s="${style}"` : ""}`;

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c ${attrs}><v>${value}</v></c>`;
  }

  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * 스타일.
 *   1  머리글 (굵게 · 가운데 · 연한 바탕 · 테두리)
 *   2  본문 (위쪽 정렬 · 줄바꿈)
 *   3  본문 숫자 (오른쪽 정렬)
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF3F8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD7DEE8"/></left>
      <right style="thin"><color rgb="FFD7DEE8"/></right>
      <top style="thin"><color rgb="FFD7DEE8"/></top>
      <bottom style="thin"><color rgb="FFD7DEE8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="top"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** 열 너비. 지정하지 않으면 엑셀 기본값을 씁니다. */
function colsXml(columns) {
  const entries = columns
    .map((column, index) =>
      column.width
        ? `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`
        : ""
    )
    .join("");

  return entries ? `<cols>${entries}</cols>` : "";
}

function sheetXml({ columns, rows }) {
  const header = columns
    .map((column, index) => cellXml(`${columnName(index)}1`, column.label ?? column, 1))
    .join("");

  const body = rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2;
      const cells = columns
        .map((column, index) =>
          cellXml(`${columnName(index)}${number}`, row[index], column.numeric ? 3 : 2)
        )
        .join("");

      return `<row r="${number}">${cells}</row>`;
    })
    .join("");

  const lastColumn = columnName(Math.max(columns.length - 1, 0));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${rows.length + 1}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="16.5"/>
  ${colsXml(columns)}
  <sheetData><row r="1">${header}</row>${body}</sheetData>
  <autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
</worksheet>`;
}

/**
 * 표를 엑셀 파일로 만듭니다.
 *
 * @param {{ sheets: Array<{
 *   name: string,
 *   columns: Array<{ label: string, width?: number, numeric?: boolean }>,
 *   rows: Array<Array<string|number|null>>,
 * }> }} options
 * @returns {Promise<Blob>}
 */
export function buildXlsx({ sheets }) {
  if (!sheets?.length) throw new Error("내보낼 표가 없습니다.");

  const named = sheets.map((sheet, index) => ({
    ...sheet,
    name: safeSheetName(sheet.name, index),
  }));

  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${named
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("")}
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${named
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join("")}
  </sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${named
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    .join("")}
  <Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...named.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet),
    })),
  ];

  return writeZip(entries, MIME);
}
