import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const SRC_ROOT = new URL("../src/", import.meta.url);

/** Node's ESM resolver does not add extensions, while Next.js does. This hook
 * lets the test runner import the extensionless relative paths used by the
 * application without changing production imports.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(specifier + extension, context.parentURL ?? undefined);

        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(specifier + extension, context);
        }
      }
    }

    // Mirror the tsconfig `@/*` -> `./src/*` path alias so tests can import
    // application modules that use it.
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);

      for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
        const candidate = new URL(relative + suffix, SRC_ROOT);

        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
