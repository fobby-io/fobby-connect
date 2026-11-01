// ISO 6346 container numbers: 4 letters (owner + category), 6 digits, 1 check digit.

const letterValue = (c: string) => {
  // A=10, skipping multiples of 11 (11, 22, 33).
  let v = 10;
  for (let x = 65; x < c.charCodeAt(0); x++) {
    v++;
    if (v % 11 === 0) v++;
  }
  return v;
};

export function checkDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = first10[i]!;
    const v = /[A-Z]/.test(c) ? letterValue(c) : Number(c);
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function isValidContainerNo(s: string): boolean {
  const n = s.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{3}[UJZ]\d{7}$/.test(n) && checkDigit(n.slice(0, 10)) === Number(n[10]);
}
