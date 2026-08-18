/**
 * UPC-A encoding. Single source of truth.
 *
 * This is shared by the on-screen label (CartonLabel.jsx) and the PDF/print
 * builder (cartonLabelPdf.js). Keeping one copy is not tidiness: a barcode
 * that differs between what you preview and what you print scans as the wrong
 * product at the receiving warehouse, and nobody finds out until a chargeback.
 */

/** Standard UPC-A check digit (mod-10, 3x weight on odd positions, 1-indexed). */
export function computeUpcCheckDigit(dataDigits) {
  let oddSum = 0;
  let evenSum = 0;
  dataDigits.forEach((d, i) => {
    if ((i + 1) % 2 === 1) oddSum += d;
    else evenSum += d;
  });
  return (10 - ((oddSum * 3 + evenSum) % 10)) % 10;
}

/**
 * Normalise a stored UPC into a correct 12-digit UPC-A code.
 *
 * The check digit is always recomputed rather than trusted, and a mismatch
 * against the stored value is reported so a bad product record is visible
 * before the carton ships.
 *
 * Note on padding: short codes are right-justified and the DATA portion is
 * zero-padded to 11 digits, then the check digit appended. Padding the
 * combined 12-digit string instead would shift every digit one place and
 * encode a different product entirely.
 */
export function normalizeUpc(rawUpc) {
  const digitsStr = String(rawUpc || '').replace(/\D/g, '');
  let dataStr;
  let providedCheck = null;

  if (digitsStr.length >= 12) {
    const last12 = digitsStr.slice(-12);
    dataStr = last12.slice(0, 11);
    providedCheck = parseInt(last12[11], 10);
  } else if (digitsStr.length === 11) {
    dataStr = digitsStr;
  } else {
    dataStr = digitsStr.padStart(11, '0');
  }

  const dataDigits = dataStr.split('').map(Number);
  const computedCheck = computeUpcCheckDigit(dataDigits);

  return {
    code: dataStr + String(computedCheck),
    checkMismatch: providedCheck !== null && providedCheck !== computedCheck,
    providedCheck,
    /** No digits at all means there is nothing to encode. */
    isEmpty: digitsStr.length === 0,
  };
}

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];

/** Quiet zone in modules. Scanners need ~9 blank modules each side. */
export const QUIET_MODULES = 9;

/** Turn a normalised 12-digit code into its bar pattern ("1" = bar). */
export function encodeUpcBars(code) {
  const digits = String(code).split('').map(Number);
  let bars = '101';
  digits.slice(0, 6).forEach((d) => { bars += L[d]; });
  bars += '01010';
  digits.slice(6, 12).forEach((d) => { bars += R[d]; });
  bars += '101';
  return bars;
}
