import { rebuildUsageCostsFromJournal } from '../src/usageCosts.js';
const apply = process.argv.includes('--apply');
console.log(JSON.stringify(await rebuildUsageCostsFromJournal({ apply }), null, 2));
