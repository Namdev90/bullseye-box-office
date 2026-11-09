import {readFileSync} from 'node:fs';

export function loadCodeCatalogue() {
  const source = process.env.SHAREPASS_CODE_MASTER_PATH || new URL('../worker/code-master.json', import.meta.url);
  const rows = JSON.parse(readFileSync(source, 'utf8'));
  const codes = new Set();
  if (!Array.isArray(rows) || !rows.length) throw Error('The code catalogue must be a nonempty JSON array.');
  for (const row of rows) {
    if (!Array.isArray(row)) throw Error('Invalid code catalogue row.');
    const [code, kind, rank, score, tier, tags, sensitive] = row;
    if (typeof code !== 'string' || !/^[A-Z0-9]{4}$/.test(code) || codes.has(code)
      || !['Word','Number','Mixed'].includes(kind) || !Number.isInteger(rank) || rank < 0
      || !Number.isInteger(score) || score < 1 || score > 100 || typeof tier !== 'string'
      || typeof tags !== 'string' || typeof sensitive !== 'boolean') throw Error('Invalid code catalogue row.');
    codes.add(code);
  }
  return rows;
}
