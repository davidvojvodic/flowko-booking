// Flowko U27: a sentence that ends with an interpolated name and its own full stop ("...: {{name}}.") must not end
// with ".." when the name already ends with one (a legal form such as "s.p." or "d.o.o."). Pure and client-safe.

/** `sentence` without its own final full stop when it ends with `value` + "." and `value` itself ends with ".". */
export function dropDoubledFullStop(sentence: string, value: string): string {
  return value.endsWith(".") && sentence.endsWith(`${value}.`) ? sentence.slice(0, -1) : sentence;
}
