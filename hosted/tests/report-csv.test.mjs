import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('report export preserves displayed totals and escapes quotes, lines and spreadsheet formulas',()=>{
  const source=readFileSync('web/admin.js','utf8');
  const start=source.indexOf('function reportCsv('),end=source.indexOf("\nbyId('download-report')",start);
  assert(start>=0&&end>start);
  const csv=runInNewContext('('+source.slice(start,end)+')')([
    {name:'=HYPERLINK("untrusted")',deposits:2,received:4,available:1,pending:1,handed_over:2},
    {name:'Booth, "A"\nEntrance',deposits:0,received:0,available:0,pending:0,handed_over:0}
  ]);
  assert(csv.includes('"\'=HYPERLINK(""untrusted"")","2","4","1","1","2"'));
  assert(csv.includes('"Booth, ""A""\nEntrance","0","0","0","0","0"'));
  assert(csv.endsWith('\r\n'));
});
