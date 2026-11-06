import { assertEquals } from 'jsr:@std/assert@1';
import { billTextIdentity } from './billIdentity.ts';

const bill = { number: '12', name: 'The River Navigation (Amendment) Bill, 2025' };

Deno.test('a bill showing both its title and number passes', () => {
  const text = 'Bill No. 12 of 2025\nTHE RIVER NAVIGATION (AMENDMENT) BILL, 2025\nA Bill further to amend';
  assertEquals(billTextIdentity(text, bill, 'as_introduced'), { applies: true, title: true, number: true, pass: true });
});
Deno.test('either the title or the number is enough', () => {
  assertEquals(billTextIdentity('THE RIVER NAVIGATION (AMENDMENT) BILL', bill, 'as_introduced').pass, true);
  assertEquals(billTextIdentity('BILL NO. 12 OF 2025', bill, 'as_passed_lok_sabha').pass, true);
});
Deno.test('text naming neither fails, and another number does not count', () => {
  assertEquals(billTextIdentity('Bill No. 120 of 2025\nA different measure', bill, 'as_introduced').pass, false);
});
Deno.test('a roman bill number matches', () => {
  const roman = { number: 'XLII', name: 'The Short Bill, 2000' };
  assertEquals(billTextIdentity('BILL No. XLII OF 2000', roman, 'as_introduced').number, true);
  assertEquals(billTextIdentity('BILL No. XLIII OF 2000', roman, 'as_introduced').number, false);
});
Deno.test('roles that cannot establish identity are not checked', () => {
  for (const role of ['gazette_notification', 'synopsis', 'errata', 'corrigendum']) {
    assertEquals(billTextIdentity('The River Navigation (Amendment) Act', bill, role).applies, false);
    assertEquals(billTextIdentity('nothing relevant', bill, role).pass, true);
  }
});
Deno.test('only the opening text counts', () => {
  assertEquals(billTextIdentity('x'.repeat(6000) + 'Bill No. 12', bill, 'as_introduced').pass, false);
});
Deno.test('a very short name cannot pass on the title alone', () => {
  const short = { number: '7', name: 'The Act' };
  assertEquals(billTextIdentity('the act of parliament', short, 'as_introduced').title, false);
});
