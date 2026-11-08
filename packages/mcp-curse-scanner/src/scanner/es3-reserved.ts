import { Parser } from 'acorn';

export const ES3_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'abstract', 'boolean', 'byte', 'char', 'class', 'const', 'debugger', 'double', 'enum', 'export',
  'extends', 'final', 'float', 'goto', 'implements', 'import', 'int', 'interface', 'long', 'native',
  'package', 'private', 'protected', 'public', 'short', 'static', 'super', 'synchronized', 'throws',
  'transient', 'volatile',
]);

interface IdentifierRef {
  start: number;
  end: number;
  name: string;
}

// `checkUnreserved` and `raise` are not in acorn's published declarations.
interface ParserInternals {
  checkUnreserved(ref: IdentifierRef): void;
  raise(pos: number, message: string): never;
}

// acorn's own ES3 list omits `const` and skips the check for escaped identifiers. Checking the
// decoded name at the same hook closes both gaps and keeps the error at the first offending token.
export const Es3Parser = Parser.extend((Base) => {
  const baseCheck = (Base.prototype as unknown as Partial<ParserInternals>).checkUnreserved;
  class Es3 extends Base {
    checkUnreserved(ref: IdentifierRef): void {
      if (ES3_RESERVED_WORDS.has(ref.name)) {
        (this as unknown as ParserInternals).raise(ref.start, `The keyword '${ref.name}' is reserved`);
      }
      baseCheck?.call(this, ref);
    }
  }
  return Es3;
});
