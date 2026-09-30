const ESC = 0x1b;
const INITIALIZE = 0x40;
const SELECT_CODE_PAGE = 0x74;
const WINDOWS_1252_CODE_PAGE = 16;
const BINARY_COMMANDS = [
  [0x1b, 0x2a],
  [0x1d, 0x28, 0x6b],
  [0x1d, 0x6b],
  [0x1d, 0x76, 0x30],
];
const WINDOWS_1252_SPECIAL = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function codePageNumber(value) {
  if (value === undefined || value === null || value === "") {
    return WINDOWS_1252_CODE_PAGE;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
    throw new Error("Table de caracteres ESC/POS invalide");
  }
  return numeric;
}

function containsBinaryCommand(payload) {
  return BINARY_COMMANDS.some((command) => payload.indexOf(Buffer.from(command)) >= 0);
}

function encodeWindows1252(text) {
  const bytes = [];
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point <= 0x7f || (point >= 0xa0 && point <= 0xff)) {
      bytes.push(point);
    } else {
      bytes.push(WINDOWS_1252_SPECIAL.get(point) ?? 0x3f);
    }
  }
  return Buffer.from(bytes);
}

function transcodeTextPayload(payload, codePage) {
  if (codePage !== WINDOWS_1252_CODE_PAGE || containsBinaryCommand(payload)) {
    return payload;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    return encodeWindows1252(text);
  } catch {
    return payload;
  }
}

function prepareEscPosPayload(base64Data, codePage = WINDOWS_1252_CODE_PAGE) {
  const selectedCodePage = codePageNumber(codePage);
  const payload = transcodeTextPayload(
    Buffer.from(base64Data || "", "base64"),
    selectedCodePage,
  );
  const command = Buffer.from([ESC, SELECT_CODE_PAGE, selectedCodePage]);

  if (payload[0] === ESC && payload[1] === INITIALIZE) {
    return Buffer.concat([payload.subarray(0, 2), command, payload.subarray(2)]).toString(
      "base64",
    );
  }

  return Buffer.concat([command, payload]).toString("base64");
}

const applyUsbCodePage = prepareEscPosPayload;

module.exports = {
  WINDOWS_1252_CODE_PAGE,
  applyUsbCodePage,
  prepareEscPosPayload,
};
