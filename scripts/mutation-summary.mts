import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const reportPath = "reports/mutation/mutation.json";
const reportSchema = z.looseObject({
  files: z.record(
    z.string(),
    z.looseObject({ mutants: z.array(z.looseObject({ status: z.string() })) }),
  ),
});

function countByStatus(report: z.infer<typeof reportSchema>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      counts.set(mutant.status, (counts.get(mutant.status) ?? 0) + 1);
    }
  }
  return counts;
}

// The score counts detected mutants over every mutant that could be detected, as Stryker does.
function summarize(counts: ReadonlyMap<string, number>): string {
  const count = (status: string): number => counts.get(status) ?? 0;
  const detected = count("Killed") + count("Timeout");
  const valid = detected + count("Survived") + count("NoCoverage");
  const score = valid === 0 ? "no mutants" : `${((detected / valid) * 100).toFixed(2)}%`;
  if (counts.size === 0) {
    return "## Mutation testing\n\nNo package marked for mutation testing exists yet.";
  }
  const rows = [...counts].map(([status, total]) => `| ${status} | ${String(total)} |`);
  return [
    "## Mutation testing",
    "",
    `Score: ${score}`,
    "",
    "| Status | Mutants |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

if (existsSync(reportPath)) {
  const report = reportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  console.log(summarize(countByStatus(report)));
} else {
  console.log("## Mutation testing\n\nStryker wrote no report; see the job log.");
}
