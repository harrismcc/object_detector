/**
 * ESLint rule: no-hardcoded-colors
 *
 * Prevents using hardcoded Tailwind color classes (e.g. bg-red-500, text-blue-600,
 * border-[#ff0000], bg-black). Only theme colors (bg-primary, text-foreground, etc.)
 * are allowed.
 */

const TAILWIND_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink",
  "rose", "slate", "gray", "zinc", "neutral", "stone", "black", "white",
];

const COLOR_PREFIXES = [
  "bg", "text", "border", "ring", "outline", "shadow", "accent", "caret",
  "fill", "stroke", "decoration", "divide", "from", "via", "to", "placeholder",
];

// Matches: prefix-colorName (with optional -shade and /opacity)
// e.g. bg-red-500, text-blue-600/50, border-black
const hardcodedNamedPattern = new RegExp(
  `(?:^|\\s)(?:hover:|focus:|active:|disabled:|dark:|group-hover:|peer-hover:)*` +
  `(?:${COLOR_PREFIXES.join("|")})-` +
  `(?:${TAILWIND_COLORS.join("|")})` +
  `(?:-\\d+)?(?:/\\d+)?(?=\\s|$|")`,
);

// Matches arbitrary color values: prefix-[#...], prefix-[rgb(...)], prefix-[hsl(...)], prefix-[oklch(...)]
const hardcodedArbitraryPattern = new RegExp(
  `(?:^|\\s)(?:hover:|focus:|active:|disabled:|dark:|group-hover:|peer-hover:)*` +
  `(?:${COLOR_PREFIXES.join("|")})-` +
  `\\[(?:#|rgb|hsl|oklch|oklab|color\\()`,
);

function checkString(value) {
  const namedMatch = value.match(hardcodedNamedPattern);
  if (namedMatch) return namedMatch[0].trim();
  const arbMatch = value.match(hardcodedArbitraryPattern);
  if (arbMatch) return arbMatch[0].trim();
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded Tailwind color classes; use theme colors instead",
    },
    messages: {
      noHardcodedColor:
        "Hardcoded color '{{className}}' is not allowed. Use a theme color (e.g. bg-primary, text-foreground) instead.",
    },
    schema: [],
  },
  create(context) {
    function checkNode(node) {
      if (node.type === "Literal" && typeof node.value === "string") {
        const match = checkString(node.value);
        if (match) {
          context.report({ node, messageId: "noHardcodedColor", data: { className: match } });
        }
      }
      if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis) {
          const match = checkString(quasi.value.raw);
          if (match) {
            context.report({ node, messageId: "noHardcodedColor", data: { className: match } });
          }
        }
      }
    }

    return {
      // className="..." or className={`...`}
      JSXAttribute(node) {
        if (node.name.name !== "className") return;
        const value = node.value;
        if (!value) return;

        if (value.type === "Literal") {
          checkNode(value);
        } else if (value.type === "JSXExpressionContainer") {
          checkNode(value.expression);
        }
      },
      // Also catch cn(), clsx(), twMerge() and similar utility calls
      CallExpression(node) {
        const callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : null;
        if (name === "cn" || name === "clsx" || name === "twMerge" || name === "cva") {
          for (const arg of node.arguments) {
            checkNode(arg);
          }
        }
      },
    };
  },
};
