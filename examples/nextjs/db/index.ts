// For Node.js - make sure to install the 'ws' and 'bufferutil' packages
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

export const db = drizzle({
    connection: process.env.DATABASE_URL!,
    ws,
});
