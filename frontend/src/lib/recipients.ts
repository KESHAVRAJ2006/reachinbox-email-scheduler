// Reads recipient addresses out of CSV (or pasted) text.
//
// Deliberately forgiving: any cell on any line that looks like an email address
// counts, so "email", "name,email" and "email,name,company" layouts all work, and
// a header row is simply skipped (it contains no address).

const EMAIL_PATTERN = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']{2,}$/;

export type ParsedRecipients = {
  emails: string[]; // unique, lower-cased, in file order
  duplicates: number; // repeated addresses that were dropped
  skippedLines: number; // non-empty lines without any address (e.g. a header)
};

export function parseRecipients(text: string): ParsedRecipients {
  const seen = new Set<string>();
  let duplicates = 0;
  let skippedLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = line
      .split(/[,;\t]/) // comma, semicolon (Excel in some locales) or tab
      .map((cell) => cell.trim().replace(/^"|"$/g, '').trim().toLowerCase());
    const found = cells.filter((cell) => EMAIL_PATTERN.test(cell));

    if (found.length === 0) {
      skippedLines++;
      continue;
    }
    for (const email of found) {
      if (seen.has(email)) duplicates++;
      else seen.add(email);
    }
  }
  return { emails: [...seen], duplicates, skippedLines };
}
