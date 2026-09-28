/**
 * Regular expressions from rules (imported rulesets, custom rules) run inside the engine, where an elapsed-time
 * check can't interrupt a catastrophically backtracking pattern. Only a safe subset is accepted (feedback §4):
 * bounded length, no backreferences or lookaround, and no nested/adjacent unbounded quantifiers. Anything else
 * throws, so the rule reports `engineError` instead of silently passing or hanging.
 */
const cache = new Map<string, RegExp>();

export class UnsafeRegexError extends Error {}

export function safeRegExp(pattern: string, flags = ""): RegExp {
  const key = `${flags}/${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (pattern.length > 200) throw new UnsafeRegexError("Pattern longer than 200 characters");
  if (/\\[1-9]|\\k</.test(pattern)) throw new UnsafeRegexError("Backreferences aren't allowed");
  if (/\(\?<?[=!]/.test(pattern)) throw new UnsafeRegexError("Lookaround isn't allowed");
  // A quantified group that itself contains a quantifier: (a+)+, (a*)*, (a|b+)*, (x{1,})+ …
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{?]/.test(pattern)) throw new UnsafeRegexError("Nested quantifiers aren't allowed");
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    throw new UnsafeRegexError(`Invalid pattern: ${(e as Error).message}`);
  }
  cache.set(key, re);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return re;
}
