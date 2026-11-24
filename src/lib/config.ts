import type { Limits } from "@/lib/engine";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function positiveInteger(value: string | undefined, fallback: number, cap: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}

export function configuredLimits(): Limits {
  return {
    maxFile: positiveInteger(process.env.MAX_SINGLE_FILE_BYTES, 10_485_760, 50_000_000),
    maxSource: positiveInteger(process.env.MAX_SOURCE_BYTES, 20_971_520, 80_000_000),
    maxArchive: positiveInteger(process.env.MAX_ARCHIVE_BYTES, 31_457_280, 50_000_000),
    maxFiles: positiveInteger(process.env.MAX_SOURCE_FILES, 100, 500),
  };
}
