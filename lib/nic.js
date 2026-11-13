// lib/nic.js
// Sri Lankan NIC helpers shared by membership applications and event
// registrations.

// "  855420159v " -> "855420159V"
function normaliseNic(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

// Old NIC: 9 digits + V or X. New NIC: 12 digits.
function isValidNic(value) {
  return /^(\d{9}[VX]|\d{12})$/.test(normaliseNic(value));
}

// Both forms of the same person's NIC. An old NIC (YYDDDSSSC + V/X, e.g.
// 855420159V) has a fixed 12-digit equivalent: 19 + YYDDD + 0 + SSSC
// (198554200159), so someone can type either and still match.
function nicVariants(value) {
  const nic = normaliseNic(value);
  const old = /^(\d{5})(\d{4})[VX]$/.exec(nic);

  if (old) {
    return [nic, `19${old[1]}0${old[2]}`];
  }

  const modern = /^(19\d{5})0(\d{4})$/.exec(nic);

  if (modern) {
    return [nic, `${modern[1].slice(2)}${modern[2]}V`, `${modern[1].slice(2)}${modern[2]}X`];
  }

  return [nic];
}

const INVALID_NIC_MESSAGE =
  'Please enter a valid NIC number (9 digits followed by V or X, or 12 digits).';

module.exports = { normaliseNic, isValidNic, nicVariants, INVALID_NIC_MESSAGE };
