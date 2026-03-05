import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema.ts";

// For Cloudflare Workers, db will be initialized with the D1 binding
// This is a placeholder for type checking
export const db = drizzle({} as D1Database, { schema });
