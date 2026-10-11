import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  productSchema,
  threadSchema,
  type Product,
  type Thread,
} from "../contracts";
import { makeAnswer, seedProducts } from "./fixtures";

const databaseSchema = z.object({
  products: z.array(productSchema),
  threads: z.array(threadSchema),
});
type Database = z.infer<typeof databaseSchema>;
const directory =
  process.env.MOCK_DATA_DIR ?? path.join(process.cwd(), ".data");
const filename = path.join(directory, "mock.json");
const shared = globalThis as typeof globalThis & {
  falkonMockQueue?: Promise<unknown>;
};

function seed(): Database {
  const answer = makeAnswer(
    seedProducts[0],
    "What calls POST /v1/refunds, and what does it write to?",
    "g-0042",
  );
  return {
    products: structuredClone(seedProducts),
    threads: [
      {
        id: "refund-write-path",
        productId: "payments-platform",
        title: "Refund write path",
        updatedAt: Date.now(),
        answers: [answer],
      },
      {
        id: "settlement-batch-schedule",
        productId: "payments-platform",
        title: "Settlement batch schedule",
        updatedAt: Date.now() - 3600000,
        answers: [
          makeAnswer(
            seedProducts[0],
            "Which services retry failed settlement batches overnight?",
            "g-0042",
          ),
        ],
      },
      {
        id: "webhook-signature",
        productId: "payments-platform",
        title: "Webhook signature check",
        updatedAt: Date.now() - 86400000,
        answers: [],
      },
      {
        id: "currency-rounding",
        productId: "payments-platform",
        title: "CurrencyRounding dependents",
        updatedAt: Date.now() - 86400000,
        answers: [],
      },
      {
        id: "ledger-writes",
        productId: "payments-platform",
        title: "Ledger writes on refund",
        updatedAt: Date.now() - 172800000,
        answers: [],
      },
    ],
  };
}

async function read(): Promise<Database> {
  try {
    return databaseSchema.parse(JSON.parse(await readFile(filename, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const initial = seed();
      await mkdir(directory, { recursive: true });
      await writeFile(`${filename}.tmp`, JSON.stringify(initial), {
        mode: 0o600,
      });
      await rename(`${filename}.tmp`, filename);
      return initial;
    }
    throw error;
  }
}

// ponytail: serialization is process-local; use a transactional database before multi-process deployment.
export function transact<T>(
  operation: (db: Database) => T | Promise<T>,
  write = false,
): Promise<T> {
  const result = (shared.falkonMockQueue ?? Promise.resolve()).then(
    async () => {
      const db = await read();
      const value = await operation(db);
      if (write) {
        await mkdir(directory, { recursive: true });
        await writeFile(
          `${filename}.tmp`,
          JSON.stringify(databaseSchema.parse(db)),
          { mode: 0o600 },
        );
        await rename(`${filename}.tmp`, filename);
      }
      return value;
    },
  );
  shared.falkonMockQueue = result.catch(() => undefined);
  return result;
}

export class MockError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function findProduct(db: Database, id: string): Product {
  const product = db.products.find((item) => item.id === id);
  if (!product) throw new MockError("Product not found.", 404);
  return product;
}
export function findThread(
  db: Database,
  productId: string,
  id: string,
): Thread {
  findProduct(db, productId);
  const thread = db.threads.find(
    (item) => item.id === id && item.productId === productId,
  );
  if (!thread) throw new MockError("Thread not found in this Product.", 404);
  return thread;
}
