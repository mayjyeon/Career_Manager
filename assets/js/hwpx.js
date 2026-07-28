/**
 * 한글 문서(.hwpx) 만들기.
 *
 * hwpx 는 한글의 공개 표준 형식(OWPML, KS X 6101)으로 ZIP 안에 XML 이 들어 있습니다.
 * 한컴오피스 한글 2010 이상과 한컴독스에서 바로 열리고,
 * 한글에서 '다른 이름으로 저장'하면 .hwp 로도 바꿀 수 있습니다.
 *
 * 비공개 이진 형식인 .hwp 는 브라우저에서 만들 수 없어 .hwpx 로 내보냅니다.
 *
 * 길이 단위는 HWPUNIT 으로 1인치 = 7200, 1mm ≈ 283 입니다.
 * 글자 크기도 HWPUNIT 을 쓰며 10pt = 1000 입니다.
 */
import { writeZip } from "./zip.js";

export const PT = 100; // 글자 크기 1pt

/** B4 세로 (257 × 364 mm) — 학교 서식에서 많이 쓰는 크기입니다. */
export const PAGE_B4 = {
  width: 72852,
  height: 103180,
  margin: { left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252 },
};

/** A4 세로 (210 × 297 mm) */
export const PAGE_A4 = {
  width: 59528,
  height: 84186,
  margin: { left: 8504, right: 8504, top: 5668, bottom: 4252, header: 4252, footer: 4252 },
};

/** 문단 정렬 — buildHeader 의 paraProperties 순서와 같습니다. */
export const ALIGN = {
  justify: 0,
  center: 1,
  left: 2,
  right: 3,
};

/** 표 테두리 굵기 기본값 (mm). */
const DEFAULT_LINES = { outer: 0.4, inner: 0.12, boundary: 0.5 };

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

const NAMESPACES = [
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"',
  'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"',
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:opf="http://www.idpf.org/2007/opf/"',
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"',
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"',
  'xmlns:epub="http://www.idpf.org/2007/ops"',
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"',
].join(" ");

/* =========================================================
   문자열 다듬기
   ========================================================= */
function escapeXml(value) {
  return String(value ?? "")
    // 줄바꿈·탭을 뺀 제어문자는 XML 에 넣을 수 없습니다.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const splitLines = (text) => String(text ?? "").replace(/\r\n?/g, "\n").split("\n");

/**
 * 글 내용을 줄 단위로 정리합니다.
 *
 *   "가\n나"                              두 줄
 *   [{ text, char }, …]                   글자 모양이 섞인 한 줄
 *   [[{ text, char }, …], [{ text }, …]]  글자 모양이 섞인 여러 줄
 *
 * @returns {Array<Array<{ text: string, char?: object }>>} 줄 → 조각 목록
 */
function toLines(content) {
  if (!Array.isArray(content)) {
    return splitLines(content).map((line) => [{ text: line }]);
  }
  if (content.length === 0) return [[{ text: "" }]];
  return Array.isArray(content[0]) ? content : [content];
}

/* =========================================================
   글자 모양 · 테두리 등록기
   ========================================================= */
/** 같은 모양은 한 번만 정의하도록 모아 둡니다. */
function createRegistry(firstId) {
  const keys = new Map();
  const items = [];

  return {
    items,
    id(spec) {
      const key = JSON.stringify(spec);
      if (!keys.has(key)) {
        keys.set(key, firstId + items.length);
        items.push(spec);
      }
      return keys.get(key);
    },
  };
}

/** 글자 모양. 크기는 pt 단위입니다. */
export const font = (size, options = {}) => ({
  size,
  bold: Boolean(options.bold),
  color: options.color ?? "#000000",
});

const BODY_FONT = font(10);

/* =========================================================
   문단 · 표
   ========================================================= */
/** 문단 하나를 만듭니다. 줄바꿈이 있으면 줄을 나눕니다. */
export function paragraph(content, { align = ALIGN.justify, char = BODY_FONT } = {}) {
  return { type: "paragraph", lines: toLines(content), align, char };
}

/**
 * 표를 만듭니다.
 *
 * @param {object} options
 * @param {number[]} options.widths 열 너비 (HWPUNIT)
 * @param {Array<{ height?: number, doubleBottom?: boolean, cells: Array<object> }>} options.rows
 *        각 칸은 { text, colSpan, rowSpan, align, char, fill, slash } 입니다.
 *        fill 은 배경색, slash 는 칸을 가로지르는 사선(빈칸 표시)입니다.
 * @param {object} [options.lines] 테두리 굵기 { outer, inner, boundary } (mm)
 */
export function table({ widths, rows, lines }) {
  return { type: "table", widths, rows, lines: { ...DEFAULT_LINES, ...lines } };
}

/** 병합된 칸을 고려해 각 칸이 실제로 놓이는 자리를 계산합니다. */
function layoutTable({ widths, rows }) {
  const colCount = widths.length;
  const heights = rows.map((row) => row.height ?? 1282);
  const occupied = rows.map(() => new Array(colCount).fill(false));
  const placed = [];

  rows.forEach((row, rowIndex) => {
    let col = 0;

    for (const cell of row.cells) {
      while (col < colCount && occupied[rowIndex][col]) col += 1;
      if (col >= colCount) break;

      const colSpan = Math.min(cell.colSpan ?? 1, colCount - col);
      const rowSpan = Math.min(cell.rowSpan ?? 1, rows.length - rowIndex);

      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) occupied[r][c] = true;
      }

      placed.push({
        ...cell,
        rowIndex,
        colIndex: col,
        colSpan,
        rowSpan,
        width: widths.slice(col, col + colSpan).reduce((a, b) => a + b, 0),
        height: heights.slice(rowIndex, rowIndex + rowSpan).reduce((a, b) => a + b, 0),
      });

      col += colSpan;
    }
  });

  return {
    placed,
    colCount,
    rowCount: rows.length,
    width: widths.reduce((a, b) => a + b, 0),
    height: heights.reduce((a, b) => a + b, 0),
  };
}

/**
 * 칸이 표의 어디에 있는지 보고 테두리 굵기를 정합니다.
 * 바깥 테두리는 굵게, 안쪽은 가늘게, 머리글과 본문 사이는 두 줄로 그립니다.
 */
function cellBorder(cell, layout, block) {
  const { outer, inner, boundary } = block.lines;
  const lastRow = cell.rowIndex + cell.rowSpan - 1;
  const lastCol = cell.colIndex + cell.colSpan - 1;

  const solid = (mm) => ({ type: "SOLID", width: `${mm} mm` });

  return {
    left: solid(cell.colIndex === 0 ? outer : inner),
    right: solid(lastCol === layout.colCount - 1 ? outer : inner),
    top: solid(cell.rowIndex === 0 ? outer : inner),
    bottom: block.rows[lastRow]?.doubleBottom
      ? { type: "DOUBLE_SLIM", width: `${boundary} mm` }
      : solid(lastRow === layout.rowCount - 1 ? outer : inner),
    slash: Boolean(cell.slash),
    fill: cell.fill ?? block.rows[cell.rowIndex]?.fill ?? null,
  };
}

/* =========================================================
   본문(section0.xml)
   ========================================================= */
function renderRuns(line, defaultChar, chars) {
  if (line.length === 0 || line.every((part) => !part.text)) {
    return `<hp:run charPrIDRef="${chars.id(defaultChar)}"><hp:t/></hp:run>`;
  }

  return line
    .map((part) => {
      const id = chars.id(part.char ?? defaultChar);
      const text = escapeXml(part.text);
      return `<hp:run charPrIDRef="${id}">${text ? `<hp:t>${text}</hp:t>` : "<hp:t/>"}</hp:run>`;
    })
    .join("");
}

function renderParagraph(ctx, { lines, align, char }, inner = "") {
  // 한 문단 안의 여러 줄은 각각 run 으로 넣습니다(강제 줄바꿈).
  const body = inner || lines.map((line) => renderRuns(line, char, ctx.chars)).join("");
  return (
    `<hp:p id="${ctx.nextId()}" paraPrIDRef="${align}" styleIDRef="0"` +
    ` pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>`
  );
}

function renderCell(ctx, cell, layout, block) {
  const align = cell.align ?? ALIGN.center;
  const char = cell.char ?? BODY_FONT;
  const borderId = ctx.borders.id(cellBorder(cell, layout, block));

  const paragraphs = toLines(cell.text)
    .map((line) => renderParagraph(ctx, { lines: [line], align, char }))
    .join("");

  return (
    `<hp:tc name="" header="${cell.header ? 1 : 0}" hasMargin="0" protect="0"` +
    ` editable="0" dirty="0" borderFillIDRef="${borderId}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"` +
    ` linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"` +
    ` hasTextRef="0" hasNumRef="0">${paragraphs}</hp:subList>` +
    `<hp:cellAddr colAddr="${cell.colIndex}" rowAddr="${cell.rowIndex}"/>` +
    `<hp:cellSpan colSpan="${cell.colSpan}" rowSpan="${cell.rowSpan}"/>` +
    `<hp:cellSz width="${cell.width}" height="${cell.height}"/>` +
    `<hp:cellMargin left="0" right="0" top="0" bottom="0"/>` +
    `</hp:tc>`
  );
}

function renderTable(ctx, block) {
  const layout = layoutTable(block);

  const rows = [];
  for (let rowIndex = 0; rowIndex < layout.rowCount; rowIndex += 1) {
    const cells = layout.placed
      .filter((cell) => cell.rowIndex === rowIndex)
      .sort((a, b) => a.colIndex - b.colIndex)
      .map((cell) => renderCell(ctx, cell, layout, block))
      .join("");
    rows.push(`<hp:tr>${cells}</hp:tr>`);
  }

  const outline = ctx.borders.id({
    left: { type: "SOLID", width: `${block.lines.outer} mm` },
    right: { type: "SOLID", width: `${block.lines.outer} mm` },
    top: { type: "SOLID", width: `${block.lines.outer} mm` },
    bottom: { type: "SOLID", width: `${block.lines.outer} mm` },
    slash: false,
    fill: null,
  });

  const tbl =
    `<hp:tbl id="${ctx.nextId()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM"` +
    ` textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1"` +
    ` rowCnt="${layout.rowCount}" colCnt="${layout.colCount}" cellSpacing="0"` +
    ` borderFillIDRef="${outline}" noAdjust="0">` +
    `<hp:sz width="${layout.width}" widthRelTo="ABSOLUTE" height="${layout.height}"` +
    ` heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"` +
    ` holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"` +
    ` horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:inMargin left="141" right="141" top="141" bottom="141"/>` +
    rows.join("") +
    `</hp:tbl>`;

  // 표는 글자처럼 취급되므로 문단 안의 run 에 담습니다.
  return renderParagraph(
    ctx,
    { lines: [], align: ALIGN.center, char: BODY_FONT },
    `<hp:run charPrIDRef="${ctx.chars.id(BODY_FONT)}">${tbl}</hp:run>`
  );
}

function buildSection(ctx, blocks, page) {
  const { margin } = page;
  const bodyChar = ctx.chars.id(BODY_FONT);

  const secPr =
    `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000"` +
    ` tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0"` +
    ` textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
    `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0"` +
    ` border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0"` +
    ` showLineNumber="0"/>` +
    `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
    `<hp:pagePr landscape="WIDELY" width="${page.width}" height="${page.height}"` +
    ` gutterType="LEFT_ONLY">` +
    `<hp:margin header="${margin.header}" footer="${margin.footer}" gutter="0"` +
    ` left="${margin.left}" right="${margin.right}" top="${margin.top}" bottom="${margin.bottom}"/>` +
    `</hp:pagePr>` +
    `<hp:footNotePr>` +
    `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
    `<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>` +
    `<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>` +
    `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hp:placement place="EACH_COLUMN" beneathText="0"/>` +
    `</hp:footNotePr>` +
    `<hp:endNotePr>` +
    `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
    `<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>` +
    `<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>` +
    `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>` +
    `</hp:endNotePr>` +
    ["BOTH", "EVEN", "ODD"]
      .map(
        (type) =>
          `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER"` +
          ` headerInside="0" footerInside="0" fillArea="PAPER">` +
          `<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>` +
          `</hp:pageBorderFill>`
      )
      .join("") +
    `</hp:secPr>`;

  // 첫 문단에는 구역 설정이 들어갑니다.
  const first =
    `<hp:p id="${ctx.nextId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${bodyChar}">${secPr}` +
    `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>` +
    `</hp:run>` +
    `<hp:run charPrIDRef="${bodyChar}"><hp:t/></hp:run>` +
    `</hp:p>`;

  const body = blocks
    .map((block) => (block.type === "table" ? renderTable(ctx, block) : renderParagraph(ctx, block)))
    .join("");

  return `${XML_DECL}<hs:sec ${NAMESPACES}>${first}${body}</hs:sec>`;
}

/* =========================================================
   문서 설정(header.xml)
   ========================================================= */
const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];
const LANG_ATTRS = "hangul latin hanja japanese other symbol user".split(" ");

const langAttrs = (value) => LANG_ATTRS.map((name) => `${name}="${value}"`).join(" ");

const FONT_TYPE_INFO =
  '<hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0"' +
  ' strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>';

function charPr(id, { size, bold, color }) {
  return (
    `<hh:charPr id="${id}" height="${Math.round(size * PT)}" textColor="${color}"` +
    ` shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">` +
    `<hh:fontRef ${langAttrs(1)}/>` +
    `<hh:ratio ${langAttrs(100)}/>` +
    `<hh:spacing ${langAttrs(0)}/>` +
    `<hh:relSz ${langAttrs(100)}/>` +
    `<hh:offset ${langAttrs(0)}/>` +
    (bold ? "<hh:bold/>" : "") +
    `<hh:underline type="NONE" shape="SOLID" color="#000000"/>` +
    `<hh:strikeout shape="NONE" color="#000000"/>` +
    `<hh:outline type="NONE"/>` +
    `<hh:shadow type="NONE" color="#C0C0C0" offsetX="10" offsetY="10"/>` +
    `</hh:charPr>`
  );
}

function paraPr(id, horizontal) {
  const margin =
    `<hh:margin>` +
    `<hc:intent value="0" unit="HWPUNIT"/>` +
    `<hc:left value="0" unit="HWPUNIT"/>` +
    `<hc:right value="0" unit="HWPUNIT"/>` +
    `<hc:prev value="0" unit="HWPUNIT"/>` +
    `<hc:next value="0" unit="HWPUNIT"/>` +
    `</hh:margin>` +
    `<hh:lineSpacing type="PERCENT" value="130" unit="HWPUNIT"/>`;

  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1"` +
    ` suppressLineNumbers="0" checked="0" textDir="LTR">` +
    `<hh:align horizontal="${horizontal}" vertical="BASELINE"/>` +
    `<hh:heading type="NONE" idRef="0" level="0"/>` +
    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0"` +
    ` keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
    `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
    `<hc:switch>` +
    `<hc:case hc:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hc:case>` +
    `<hc:default>${margin}</hc:default>` +
    `</hc:switch>` +
    `<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0"` +
    ` connect="0" ignoreMargin="0"/>` +
    `</hh:paraPr>`
  );
}

const NO_LINE = '<hh:%s type="NONE" width="0.1 mm" color="#000000"/>';

function borderFillXml(id, spec) {
  const side = (name, line) =>
    line
      ? `<hh:${name} type="${line.type}" width="${line.width}" color="#000000"/>`
      : NO_LINE.replace("%s", name);

  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    // 사선은 빈칸(해당 없음)을 나타낼 때 씁니다.
    `<hh:slash type="${spec.slash ? "CENTER" : "NONE"}" Crooked="0" isCounter="0"/>` +
    `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
    side("leftBorder", spec.left) +
    side("rightBorder", spec.right) +
    side("topBorder", spec.top) +
    side("bottomBorder", spec.bottom) +
    `<hh:diagonal type="SOLID" width="0.12 mm" color="#000000"/>` +
    (spec.fill
      ? `<hc:fillBrush><hc:winBrush faceColor="${spec.fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>`
      : "") +
    `</hh:borderFill>`
  );
}

function buildHeader(ctx, fontName) {
  const fonts =
    `<hh:font id="0" face="${escapeXml(fontName)}" type="TTF" isEmbedded="0">${FONT_TYPE_INFO}</hh:font>` +
    `<hh:font id="1" face="함초롬바탕" type="TTF" isEmbedded="0">${FONT_TYPE_INFO}</hh:font>`;

  const fontfaces =
    `<hh:fontfaces itemCnt="${LANGS.length}">` +
    LANGS.map((lang) => `<hh:fontface lang="${lang}" fontCnt="2">${fonts}</hh:fontface>`).join("") +
    `</hh:fontfaces>`;

  // 1번과 2번은 문단·글자 모양이 가리키는 고정 테두리입니다.
  const fixed =
    borderFillXml(1, { slash: false, fill: null }) +
    borderFillXml(2, { slash: false, fill: null }).replace(
      "</hh:borderFill>",
      '<hc:fillBrush><hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/></hc:fillBrush></hh:borderFill>'
    );

  const borderFills =
    `<hh:borderFills itemCnt="${ctx.borders.items.length + 2}">` +
    fixed +
    ctx.borders.items.map((spec, index) => borderFillXml(index + 3, spec)).join("") +
    `</hh:borderFills>`;

  const charProperties =
    `<hh:charProperties itemCnt="${ctx.chars.items.length}">` +
    ctx.chars.items.map((spec, index) => charPr(index, spec)).join("") +
    `</hh:charProperties>`;

  // ALIGN 상수와 순서를 맞춥니다.
  const aligns = ["JUSTIFY", "CENTER", "LEFT", "RIGHT"];
  const paraProperties =
    `<hh:paraProperties itemCnt="${aligns.length}">` +
    aligns.map((horizontal, index) => paraPr(index, horizontal)).join("") +
    `</hh:paraProperties>`;

  const numbering =
    `<hh:numberings itemCnt="1"><hh:numbering id="1" start="0">` +
    Array.from({ length: 7 }, (_, i) => i + 1)
      .map(
        (level) =>
          `<hh:paraHead start="1" level="${level}" align="LEFT" useInstWidth="1" autoIndent="1"` +
          ` widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT"` +
          ` charPrIDRef="4294967295" checkable="0">^${level}.</hh:paraHead>`
      )
      .join("") +
    `</hh:numbering></hh:numberings>`;

  return (
    `${XML_DECL}<hh:head ${NAMESPACES} version="1.5" secCnt="1">` +
    `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
    `<hh:refList>` +
    fontfaces +
    borderFills +
    charProperties +
    `<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>` +
    numbering +
    paraProperties +
    `<hh:styles itemCnt="1">` +
    `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0"` +
    ` nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
    `</hh:styles>` +
    `</hh:refList>` +
    `<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>` +
    `<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>` +
    `<hh:trackchageConfig flags="0"/>` +
    `</hh:head>`
  );
}

/* =========================================================
   포장(mimetype · META-INF · content.hpf)
   ========================================================= */
function buildContentHpf(title, now) {
  return (
    `${XML_DECL}<opf:package ${NAMESPACES} version="" unique-identifier="" id="">` +
    `<opf:metadata>` +
    `<opf:title>${escapeXml(title)}</opf:title>` +
    `<opf:language>ko</opf:language>` +
    `<opf:meta name="creator" content="text"/>` +
    `<opf:meta name="subject" content="text"/>` +
    `<opf:meta name="description" content="text"/>` +
    `<opf:meta name="lastsaveby" content="text"/>` +
    `<opf:meta name="CreatedDate" content="text">${now}</opf:meta>` +
    `<opf:meta name="ModifiedDate" content="text">${now}</opf:meta>` +
    `<opf:meta name="keyword" content="text"/>` +
    `</opf:metadata>` +
    `<opf:manifest>` +
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
    `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
    `</opf:manifest>` +
    `<opf:spine>` +
    `<opf:itemref idref="header" linear="yes"/>` +
    `<opf:itemref idref="section0" linear="yes"/>` +
    `</opf:spine>` +
    `</opf:package>`
  );
}

const CONTAINER_XML =
  `${XML_DECL}<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"` +
  ` xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>` +
  `<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
  `<ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/>` +
  `<ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/>` +
  `</ocf:rootfiles></ocf:container>`;

const CONTAINER_RDF =
  `${XML_DECL}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  ["Contents/header.xml", "Contents/section0.xml"]
    .map(
      (path) =>
        `<rdf:Description rdf:about=""><ns0:hasPart` +
        ` xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="${path}"/>` +
        `</rdf:Description>` +
        `<rdf:Description rdf:about="${path}"><rdf:type` +
        ` rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#${
          path.endsWith("header.xml") ? "HeaderFile" : "SectionFile"
        }"/></rdf:Description>`
    )
    .join("") +
  `<rdf:Description rdf:about=""><rdf:type` +
  ` rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description>` +
  `</rdf:RDF>`;

const MANIFEST_XML =
  `${XML_DECL}<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`;

const SETTINGS_XML =
  `${XML_DECL}<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"` +
  ` xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">` +
  `<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`;

const VERSION_XML =
  `${XML_DECL}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"` +
  ` tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1"` +
  ` xmlVersion="1.5" application="Career Manager" appVersion="1.0"/>`;

/** 미리보기 텍스트 — 문서를 열지 않고도 내용을 볼 수 있게 합니다. */
function buildPreviewText(blocks) {
  const flatten = (content) =>
    toLines(content)
      .map((line) => line.map((part) => part.text).join(""))
      .join(" ");

  const lines = [];

  for (const block of blocks) {
    if (block.type === "table") {
      for (const row of block.rows) lines.push(row.cells.map((cell) => flatten(cell.text)).join("\t"));
    } else {
      lines.push(...block.lines.map((line) => line.map((part) => part.text).join("")));
    }
    if (lines.length > 200) break;
  }

  return lines.slice(0, 200).join("\r\n");
}

/* =========================================================
   진입점
   ========================================================= */
/**
 * 한글 문서를 만듭니다.
 *
 * @param {object} options
 * @param {string} options.title  문서 제목(파일 속성에 들어갑니다)
 * @param {Array}  options.blocks paragraph() · table() 로 만든 내용
 * @param {object} [options.page] PAGE_B4 또는 PAGE_A4
 * @param {string} [options.font] 기본 글꼴
 * @returns {Promise<Blob>}
 */
export function buildHwpx({ title, blocks, page = PAGE_B4, font: fontName = "함초롬돋움" }) {
  let id = 1000;

  const ctx = {
    nextId: () => (id += 1),
    chars: createRegistry(0),
    borders: createRegistry(3),
  };

  // 기본 글자 모양이 0번이 되도록 먼저 등록합니다(문단 유형이 이 번호를 가리킵니다).
  ctx.chars.id(BODY_FONT);

  // 본문을 먼저 만들어야 어떤 글자 모양과 테두리가 쓰였는지 알 수 있습니다.
  const section = buildSection(ctx, blocks, page);
  const header = buildHeader(ctx, fontName);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  return writeZip(
    [
      // 규격상 mimetype 이 맨 앞에 압축 없이 들어가야 합니다.
      { name: "mimetype", data: "application/hwp+zip", store: true },
      { name: "version.xml", data: VERSION_XML },
      { name: "settings.xml", data: SETTINGS_XML },
      { name: "Contents/content.hpf", data: buildContentHpf(title, now) },
      { name: "Contents/header.xml", data: header },
      { name: "Contents/section0.xml", data: section },
      { name: "Preview/PrvText.txt", data: buildPreviewText(blocks) },
      { name: "META-INF/container.xml", data: CONTAINER_XML },
      { name: "META-INF/container.rdf", data: CONTAINER_RDF },
      { name: "META-INF/manifest.xml", data: MANIFEST_XML },
    ],
    "application/hwp+zip"
  );
}
