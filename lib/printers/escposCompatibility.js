const ESC = 0x1b;
const INITIALIZE = 0x40;
const SELECT_CODE_PAGE = 0x74;
const WINDOWS_1252_CODE_PAGE = 16;

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

function applyUsbCodePage(base64Data, codePage = WINDOWS_1252_CODE_PAGE) {
  const payload = Buffer.from(base64Data || "", "base64");
  const command = Buffer.from([ESC, SELECT_CODE_PAGE, codePageNumber(codePage)]);

  if (payload[0] === ESC && payload[1] === INITIALIZE) {
    return Buffer.concat([payload.subarray(0, 2), command, payload.subarray(2)]).toString(
      "base64",
    );
  }

  return Buffer.concat([command, payload]).toString("base64");
}

module.exports = {
  WINDOWS_1252_CODE_PAGE,
  applyUsbCodePage,
};
