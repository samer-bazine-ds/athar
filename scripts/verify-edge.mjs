import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const functions = [
  "supabase/functions/create-checkout-session/index.ts",
  "supabase/functions/send-invitation-email/index.ts",
  "supabase/functions/start-client-access/index.ts",
  "supabase/functions/stripe-webhook/index.ts"
];

for (const file of functions) {
  const source = await readFile(file, "utf8");
  await transform(source, { loader: "ts", format: "esm", target: "es2022", sourcefile: file });
}

console.log(`Verified ${functions.length} Supabase Edge Functions.`);
