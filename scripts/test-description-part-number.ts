import assert from 'assert';
import {
  extractEndHashPartNumber,
  suggestPartFromDescription,
} from '../lib/vendorPriceImport/descriptionPartNumber';

assert.equal(
  extractEndHashPartNumber(
    'VIC 920N 21/2X11/2 E GASKET GROOVED PAINTED CC0392NPE1 Your # 2515VGRDMT',
  ),
  '2515VGRDMT',
);

assert.equal(extractEndHashPartNumber('NO HASH HERE'), null);
assert.equal(extractEndHashPartNumber('Middle # ABC123 more text'), null);

const candidates = [
  { id: 'a', pn: '25VIC15TMT', nomenclature: 'A', cost: 24.88 },
  { id: 'b', pn: '2515VGRDMT', nomenclature: 'B', cost: 24.88 },
];

const suggested = suggestPartFromDescription(
  'VIC 920N 21/2X11/2 E GASKET GROOVED PAINTED CC0392NPE1 Your # 2515VGRDMT',
  candidates,
);
assert.ok(suggested);
assert.equal(suggested!.partId, 'b');
assert.equal(suggested!.pn, '2515VGRDMT');

assert.equal(suggestPartFromDescription('ends with # NOTINLIST', candidates), null);

const twoWay = [
  { id: 'a', pn: '25VIC15TMT', nomenclature: 'A', cost: 1 },
  { id: 'b', pn: '2515VGRDMT', nomenclature: 'B', cost: 1 },
];
assert.equal(suggestPartFromDescription('Your # 2515VGRDMT', twoWay)?.partId, 'b');

console.log('description-part-number: all assertions passed');
