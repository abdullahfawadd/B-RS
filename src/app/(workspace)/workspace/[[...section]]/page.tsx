import { notFound } from "next/navigation";
import { sections } from "../../../../components/workspace/data";
import { Workspace } from "../../../../components/workspace/workspace";

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ source?: string }> }) {
  const { section = [] } = await params;
  const active = sections.find((value) => value === (section[0] ?? "overview"));
  if (section.length > 1 || !active) notFound();
  const { source } = await searchParams;
  return <Workspace section={active} sourceFilter={source} />;
}
