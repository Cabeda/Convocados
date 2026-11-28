/**
 * The CSS emotion generated for an element, as one string (its own rules, its
 * nested selectors and its media queries). jsdom does not evaluate media
 * queries or :focus-visible, so tests read the rules instead of the pixels.
 */
export function cssFor(el: Element): string {
  const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(list)) {
      const text = rule.cssText;
      if (classes.some((c) => text.includes(`.${c}`))) rules.push(text);
    }
  }
  // Emotion's non-speedy mode keeps the text in the <style> tags instead of the CSSOM.
  for (const tag of Array.from(document.querySelectorAll("style"))) {
    const text = tag.textContent ?? "";
    if (text && classes.some((c) => text.includes(`.${c}`))) rules.push(text);
  }
  return rules.join("\n");
}
