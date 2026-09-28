// Alphabet sans caractères ambigus à l'oral ou à l'écran (0/O, 1/I/L, U/V) :
// le code se lit et se retape à la main sur un autre appareil.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
export const CODE_LENGTH = 8;

// Échantillonnage par rejet : évite le biais d'un simple modulo (256 n'est
// pas un multiple de 29).
const REJECTION_THRESHOLD = 256 - (256 % ALPHABET.length);

/** Code de synchronisation aléatoire (8 caractères). C'est le seul secret
 * protégeant les données : on utilise donc crypto.getRandomValues. */
export function generateSyncCode() {
  let code = '';
  const byte = new Uint8Array(1);
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(byte);
    if (byte[0] >= REJECTION_THRESHOLD) continue;
    code += ALPHABET[byte[0] % ALPHABET.length];
  }
  return code;
}

/** Met un code saisi à la main (espaces, tirets, minuscules) au format canonique. */
export function normalizeSyncCode(raw) {
  return String(raw).toUpperCase().replace(/[\s-]/g, '');
}

export function isValidSyncCode(code) {
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(code);
}
