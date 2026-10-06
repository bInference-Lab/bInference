import { z } from "zod";

/** Whole epoch milliseconds in UTC, as every `_at` column holds them. */
export const epochMsSchema: z.ZodType<number, number> = z.int().nonnegative();

/** A row version: 0 when the row is written, one more with each change. */
export const rowVersionSchema: z.ZodType<number, number> = z.int().nonnegative();

/** The number SQLite gives a row that has no protocol id, counted from 1. */
export const rowNumberSchema: z.ZodType<number, number> = z.int().positive();

/** How many rows a list call returns at most: 1 to 1,000. */
export const pageLimitSchema: z.ZodType<number, number> = z.int().min(1).max(1_000);

/** A short name or key a person or a program chose: 1 to 200 characters. */
export const shortTextSchema: z.ZodType<string, string> = z.string().min(1).max(200);
